//! IM 会话记忆：把「微信 / 飞书对端」映射成 FLUX 会话，复用 messages 表做持久上下文。
//!
//! 为什么需要它：微信/飞书入口此前直接 `Supervisor::run(input, vec![])`，
//! 历史永远是空的——模型只能看到当前这一句，于是「刚才说啥了」「上一步操作到哪」
//! 全部丢失，用户第二天再聊更是从零开始。
//!
//! 这里做三件事：
//!   1. 对端 → 会话 id 的稳定映射（`im:<channel>:<peer>`），重启后仍指向同一会话；
//!   2. 每轮开始前从库里读回最近若干条问答作为 history 注入模型；
//!   3. 每轮结束后把用户消息与助手里落库，形成可持续的对话记忆。
//!
//! 顺带的好处：这些 IM 会话也会出现在桌面端会话列表里，可以回看、继续、删除。
//!
//! 另外负责「执行中补充」的状态：用户对同一件事没说完可以继续发消息，
//! 此时不排队新任务，而是把新内容记成该会话的待并入补充，
//! 由 AgentLoop 在下一轮取走并进当前任务（见 [`push_supplement`] / [`take_supplements`]）。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::memory::MemoryStore;
use crate::model::ChatMessage;

/// 读回的历史消息条数上限（用户 + 助手合计）
pub const HISTORY_LIMIT: usize = 24;

/// 单条历史消息注入模型时的字符上限：避免一条超长报告把上下文撑爆
const MAX_HISTORY_CHARS: usize = 6_000;

/// 单个会话允许堆积的补充条数上限（防止用户狂发消息把上下文顶爆）
const MAX_PENDING_SUPPLEMENTS: usize = 8;

/// 「执行中」标记的有效期。超过这个时间还没解除，说明上一轮任务已经异常终止
/// （崩溃、死锁、被系统挂起），此时必须允许新消息重新抢占，否则该会话会被
/// 永久锁死：用户发什么都只回「收到补充」，而那个任务早就不会再消费了。
/// 定得比最长任务（模型 300s × 多提供方 + 工具 600s × 多轮）宽裕，避免误抢。
const ACTIVE_TTL: Duration = Duration::from_secs(45 * 60);

/// 正在执行任务的会话 id → 占位时间。命中时新消息走「补充」而不是排队新任务。
fn active_set() -> &'static Mutex<HashMap<String, Instant>> {
    static ACTIVE: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 会话 id → 待并入的补充内容（由 AgentLoop 在下一轮取走）。
fn pending_map() -> &'static Mutex<HashMap<String, Vec<String>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, Vec<String>>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 该会话当前是否有任务在跑
pub fn is_active(conv_id: &str) -> bool {
    active_set()
        .lock()
        .map(|s| s.contains_key(conv_id))
        .unwrap_or(false)
}

/// 标记会话进入「执行中」；返回的 guard 在 Drop 时自动解除（panic 也不会漏）。
pub fn mark_active(conv_id: &str) -> ActiveGuard {
    let stamp = Instant::now();
    if let Ok(mut s) = active_set().lock() {
        s.insert(conv_id.to_string(), stamp);
    }
    ActiveGuard {
        key: conv_id.to_string(),
        stamp,
    }
}

/// 原子地「抢占」执行权：成功返回 guard，说明该会话当前没有任务；
/// 返回 None 说明已有任务在跑，调用方应把本条消息当作补充。
///
/// 判空与占位在同一把锁内完成，避免两条消息同时到达时都判定「空闲」而各起一个任务。
///
/// 占位超过 [`ACTIVE_TTL`] 视为僵尸占位（上一轮已异常终止），直接接管并留日志——
/// 宁可多起一次任务，也不能让会话永久卡在「补充」状态。
pub fn try_mark_active(conv_id: &str) -> Option<ActiveGuard> {
    let mut s = active_set().lock().ok()?;
    if let Some(since) = s.get(conv_id) {
        let held = since.elapsed();
        if held < ACTIVE_TTL {
            return None;
        }
        crate::windows::diag_log(&format!(
            "[IM·接管] 会话 {conv_id} 的执行占位已存在 {}s（超过上限 {}s），判定为僵尸占位，回收执行权",
            held.as_secs(),
            ACTIVE_TTL.as_secs()
        ));
    }
    let stamp = Instant::now();
    s.insert(conv_id.to_string(), stamp);
    Some(ActiveGuard {
        key: conv_id.to_string(),
        stamp,
    })
}

/// 强行解除该会话的「执行中」占位（不持 guard 时的补救路径）。
///
/// 只给「上一轮已确认停滞、需要立刻接管」的入口用：正常结束一律靠 ActiveGuard 的 Drop。
pub fn force_release(conv_id: &str) {
    if let Ok(mut s) = active_set().lock() {
        s.remove(conv_id);
    }
}

/// 执行中标记的 RAII 守卫：作用域结束即解除该会话的 active 状态。
///
/// 带时间戳比对：如果占位已被新的任务接管（僵尸回收），旧 guard 的 Drop
/// 不能把新任务的占位删掉。
pub struct ActiveGuard {
    key: String,
    stamp: Instant,
}

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        if let Ok(mut s) = active_set().lock() {
            if s.get(&self.key) == Some(&self.stamp) {
                s.remove(&self.key);
            }
        }
    }
}

/// 追加一条「执行中补充」，返回该会话当前待并入的条数。
///
/// 上限 [`MAX_PENDING_SUPPLEMENTS`] 条，超出丢弃最旧的（用户最后说的话最重要）。
pub fn push_supplement(conv_id: &str, text: &str) -> usize {
    let text = text.trim();
    if text.is_empty() {
        return 0;
    }
    let mut map = match pending_map().lock() {
        Ok(m) => m,
        Err(_) => return 0,
    };
    let list = map.entry(conv_id.to_string()).or_default();
    list.push(text.to_string());
    if list.len() > MAX_PENDING_SUPPLEMENTS {
        let overflow = list.len() - MAX_PENDING_SUPPLEMENTS;
        list.drain(0..overflow);
    }
    list.len()
}

/// 取走该会话全部待并入补充（取走后清空，避免重复注入）。
pub fn take_supplements(conv_id: &str) -> Vec<String> {
    let mut map = match pending_map().lock() {
        Ok(m) => m,
        Err(_) => return Vec::new(),
    };
    map.remove(conv_id).unwrap_or_default()
}

/// 是否存在未消费的补充（收尾判断用，不会取走）
pub fn has_pending_supplements(conv_id: &str) -> bool {
    pending_map()
        .lock()
        .map(|m| m.get(conv_id).map(|v| !v.is_empty()).unwrap_or(false))
        .unwrap_or(false)
}

/// 由渠道 + 对端 id 生成稳定的会话 id。
///
/// 微信 user id 可能是 `wxid_xxx`、也可能是带 `@` 的字符串；统一清洗成
/// `[A-Za-z0-9_-]`，清洗后为空（极端情况）则退化为对端原文的短哈希。
pub fn conversation_id(channel: &str, peer: &str) -> String {
    let mut safe: String = peer
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    // 连续分隔符收敛，避免 id 里出现 `---`
    while safe.contains("--") {
        safe = safe.replace("--", "-");
    }
    let safe = safe.trim_matches('-').to_string();
    let safe = if safe.is_empty() {
        // 兜底：非 ASCII 的对端标识用哈希占位，保证不同对端不串会话
        let mut h: u64 = 0xcbf29ce484222325;
        for b in peer.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        format!("{h:016x}")
    } else {
        safe
    };
    format!("im:{channel}:{safe}")
}

/// 会话标题：`微信 · wxid_ab12`（对端 id 太长时只取尾部，避免侧边栏被撑爆）
pub fn conversation_title(label: &str, peer: &str) -> String {
    let cleaned: String = peer.chars().filter(|c| !c.is_control()).collect();
    let tail: String = if cleaned.chars().count() > 16 {
        cleaned
            .chars()
            .rev()
            .take(10)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    } else {
        cleaned.clone()
    };
    if tail.trim().is_empty() {
        label.to_string()
    } else {
        format!("{label} · {tail}")
    }
}

/// 确保对端会话存在，返回会话 id。
///
/// 已存在则原样返回（首次创建时写入标题，之后不再覆盖——用户可能已在桌面端改名）。
pub fn ensure(store: &MemoryStore, channel: &str, label: &str, peer: &str) -> String {
    let conv_id = conversation_id(channel, peer);
    let title = conversation_title(label, peer);
    let _ = store.ensure_conversation(&conv_id, &title, None);
    conv_id
}

/// 读回该会话的最近历史，转换成模型消息。
///
/// - 只保留 user / assistant 两类（system、tool 结果不跨轮回放，避免工具调用链断裂）；
/// - 空消息（例如仅含附件、正文为空）跳过；
/// - 带附件的用户消息补一行「本轮附件：a.pdf」，让模型知道之前收到过什么；
/// - 单条过长时截断，尾部标注省略。
pub fn load_history(store: &MemoryStore, conv_id: &str) -> Vec<ChatMessage> {
    let rows = match store.messages(conv_id, HISTORY_LIMIT) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<ChatMessage> = Vec::with_capacity(rows.len());
    for row in rows {
        if row.role != "user" && row.role != "assistant" {
            continue;
        }
        // 审批回执（「已确认执行。」「已拒绝该操作。」）只是控制流噪音，不进历史
        let content = row.content.trim();
        if content == "已确认执行。" || content == "已拒绝该操作。" {
            continue;
        }
        let mut text = content.to_string();
        if let Some(note) = attachment_note(row.attachments.as_deref()) {
            text.push_str(&note);
        }
        // 纯附件消息正文为空，但附件提示让它仍是一条有意义的「用户发来了文件」
        if text.trim().is_empty() {
            continue;
        }
        if text.chars().count() > MAX_HISTORY_CHARS {
            let clipped: String = text.chars().take(MAX_HISTORY_CHARS).collect();
            text = format!("{clipped}\n…（该条过长，已截断）");
        }
        out.push(ChatMessage {
            role: row.role,
            content: text,
            tool_calls: None,
            tool_call_id: None,
        });
    }
    out
}

/// 追加一条消息到会话（role 通常为 "user" / "assistant"）。
///
/// `attachments` 为本地文件路径 JSON 数组（便于桌面端回看与历史提示）。
pub fn remember(
    store: &MemoryStore,
    conv_id: &str,
    role: &str,
    content: &str,
    attachments: Option<&str>,
) {
    let _ = store.add_message(conv_id, role, content, attachments);
}

/// 由 attachments 列（JSON 数组字符串）生成一行附件提示；无附件返回 None。
fn attachment_note(raw: Option<&str>) -> Option<String> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }
    let paths: Vec<String> = serde_json::from_str::<Vec<String>>(raw).unwrap_or_default();
    if paths.is_empty() {
        return None;
    }
    let names: Vec<String> = paths
        .iter()
        .map(|p| p.rsplit(['\\', '/']).next().unwrap_or(p).to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if names.is_empty() {
        return None;
    }
    Some(format!("\n〔本轮附件：{}〕", names.join("、")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversation_id_is_stable_and_safe() {
        let a = conversation_id("wechat", "wxid_abc@im.wechat");
        let b = conversation_id("wechat", "wxid_abc@im.wechat");
        assert_eq!(a, b);
        assert_eq!(a, "im:wechat:wxid_abc-im-wechat");
        assert!(a
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ':'));
    }

    #[test]
    fn non_ascii_peer_keeps_distinct_ids() {
        assert_ne!(conversation_id("wechat", "张三"), conversation_id("wechat", "李四"));
    }

    #[test]
    fn title_shortens_long_peer() {
        let t = conversation_title("微信", "wxid_1234567890abcdefg");
        assert!(t.starts_with("微信 · "));
        assert!(t.chars().count() <= 16);
    }

    #[test]
    fn history_roundtrip_keeps_roles_and_attachment_names() {
        let dir = std::env::temp_dir().join("flux-im-session-test");
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join(format!("roundtrip-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&db);
        let store = MemoryStore::open(db.to_str().unwrap()).expect("打开测试库失败");

        let conv = ensure(&store, "wechat", "微信", "wxid_test");
        assert_eq!(conv, "im:wechat:wxid_test");

        remember(
            &store,
            &conv,
            "user",
            "帮我看下这份报告",
            Some(r#"["C:\\tmp\\季度报告.pdf"]"#),
        );
        remember(&store, &conv, "assistant", "已读完，要点有三条。", None);
        // 审批回执属于控制流噪音，不应进入历史
        remember(&store, &conv, "user", "已确认执行。", None);

        let history = load_history(&store, &conv);
        assert_eq!(history.len(), 2, "应只剩一问一答: {history:?}");
        assert_eq!(history[0].role, "user");
        assert!(history[0].content.contains("帮我看下这份报告"));
        assert!(
            history[0].content.contains("季度报告.pdf"),
            "附件名应出现在历史里: {}",
            history[0].content
        );
        assert_eq!(history[1].role, "assistant");
        assert!(history[1].content.contains("要点有三条"));
    }

    #[test]
    fn supplements_are_scoped_and_drained_once() {
        let a = "im:wechat:supp-test-a";
        let b = "im:wechat:supp-test-b";
        assert!(!is_active(a));

        let guard = mark_active(a);
        assert!(is_active(a));
        assert!(!is_active(b));

        assert_eq!(push_supplement(a, "只要华东区"), 1);
        assert_eq!(push_supplement(a, "时间范围 2026Q3"), 2);
        assert_eq!(push_supplement(b, "另一个会话的补充"), 1);
        assert!(has_pending_supplements(a));

        let got = take_supplements(a);
        assert_eq!(got, vec!["只要华东区".to_string(), "时间范围 2026Q3".to_string()]);
        // 取走后清空，不会重复注入
        assert!(!has_pending_supplements(a));
        assert!(take_supplements(a).is_empty());
        // 其他会话互不影响
        assert_eq!(take_supplements(b).len(), 1);

        drop(guard);
        assert!(!is_active(a));
    }

    #[test]
    fn supplements_are_capped_to_newest() {
        let key = "im:wechat:supp-test-cap";
        for i in 0..(MAX_PENDING_SUPPLEMENTS + 3) {
            push_supplement(key, &format!("补充{i}"));
        }
        let got = take_supplements(key);
        assert_eq!(got.len(), MAX_PENDING_SUPPLEMENTS);
        // 丢最旧的，保留最新一条
        assert!(got.last().unwrap().contains(&format!("补充{}", MAX_PENDING_SUPPLEMENTS + 2)));
        assert!(!got.iter().any(|s| s == "补充0"));
    }

    #[test]
    fn stale_active_is_reclaimed_and_old_guard_does_not_clear_new_owner() {
        let key = "im:wechat:stale-test";
        // 模拟「上一轮任务异常终止、占位没被释放」：直接把时间戳改成很久以前
        {
            let mut set = active_set().lock().unwrap();
            set.insert(key.to_string(), Instant::now() - ACTIVE_TTL - Duration::from_secs(1));
        }
        assert!(is_active(key), "僵尸占位仍然显示为执行中");

        // 新消息应当能接管，而不是被判定为「补充」
        let fresh = try_mark_active(key).expect("僵尸占位应被回收");
        assert!(is_active(key));

        // 僵尸那轮的旧 guard 若此时才 drop，不能把新任务的占位删掉
        let stale_guard = ActiveGuard {
            key: key.to_string(),
            stamp: Instant::now() - ACTIVE_TTL - Duration::from_secs(1),
        };
        drop(stale_guard);
        assert!(is_active(key), "旧 guard 不得清掉新占位");

        drop(fresh);
        assert!(!is_active(key));
    }
}

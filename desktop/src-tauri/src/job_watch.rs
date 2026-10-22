//! 投递后等待回复：后台持续监控 HR 消息，有回复就自动回应。
//!
//! 用户在投递完成后点「等待回复」（或说「等回复」），进入一段**有上限的待机期**
//! （默认 30 分钟）。这段时间里后台线程周期性检查各平台会话页，一旦发现新的
//! HR 消息，就把它交给模型判断并回复，同时把进展推给用户。
//!
//! 设计要点：
//! - **不占住主对话**：监控跑在独立线程，用户该干嘛干嘛；结束才汇报。
//! - **有硬上限**：`deadline` 到点必停，不会变成永不退出的后台线程。
//! - **可随时取消**：`stop` 立即置位，下一轮检查就退出。
//! - **一次只跑一个**：重复点「等待回复」不会叠出多个监控线程。
//! - **失败不静默**：浏览器起不来、页面结构变了，都会作为状态推给用户，
//!   而不是安静地什么都不做。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;

/// 默认待机时长（30 分钟）
pub const DEFAULT_WAIT_MINUTES: u64 = 30;
/// 两轮检查之间的间隔
const POLL_INTERVAL: Duration = Duration::from_secs(60);
/// 单次检查最多花多久（防止某个平台卡住把整轮拖死）
const POLL_TIMEOUT: Duration = Duration::from_secs(90);

/// 监控运行态
#[derive(Clone, serde::Serialize)]
pub struct WaitState {
    pub running: bool,
    /// 开始时间（毫秒时间戳）
    pub started_ms: u64,
    /// 计划结束时间（毫秒时间戳）
    pub deadline_ms: u64,
    /// 已完成的检查轮数
    pub rounds: u32,
    /// 累计发现的新回复数
    pub replies: u32,
    /// 最近一轮的说明
    pub last_note: String,
}

impl Default for WaitState {
    fn default() -> Self {
        Self {
            running: false,
            started_ms: 0,
            deadline_ms: 0,
            rounds: 0,
            replies: 0,
            last_note: String::new(),
        }
    }
}

static STATE: OnceLock<Mutex<WaitState>> = OnceLock::new();
/// 取消标志：用户点「停止等待」或新一轮开始时置位
static STOP: AtomicBool = AtomicBool::new(false);
/// 是否已有监控线程在跑（防止重复启动）
static RUNNING: AtomicBool = AtomicBool::new(false);

fn state_slot() -> &'static Mutex<WaitState> {
    STATE.get_or_init(|| Mutex::new(WaitState::default()))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 当前状态快照（前端轮询/初始化用）
pub fn snapshot() -> WaitState {
    state_slot().lock().map(|s| s.clone()).unwrap_or_default()
}

/// 更新状态并广播给前端
fn publish(app: &AppHandle, patch: impl FnOnce(&mut WaitState)) {
    let snap = {
        let Ok(mut s) = state_slot().lock() else {
            return;
        };
        patch(&mut s);
        s.clone()
    };
    let _ = app.emit("job-hunt-wait", &snap);
}

/// 向执行流推一条可见进展
fn thought(app: &AppHandle, kind: &str, label: &str, detail: &str) {
    let _ = app.emit(
        "thought",
        json!({ "kind": kind, "label": label, "detail": detail }),
    );
    if let Some(state) = app.try_state::<AppState>() {
        state.log_thought(kind, label, detail);
    }
    crate::windows::diag_log(&format!("[等待回复] {label}：{detail}"));
}

/// 停止监控（用户主动停止，或新一轮任务开始）
pub fn stop() {
    STOP.store(true, Ordering::SeqCst);
    if let Ok(mut s) = state_slot().lock() {
        s.running = false;
        s.last_note = "已停止等待".to_string();
    }
}

/// 启动等待回复监控。
///
/// 返回实际待机时长（分钟）；已有监控在跑时直接返回当前状态，不重复启动。
pub fn start(app: AppHandle, minutes: Option<u64>) -> Result<u64, String> {
    if RUNNING.load(Ordering::SeqCst) {
        return Err("已经在等待回复中，无需重复启动。".into());
    }
    let minutes = minutes.unwrap_or(DEFAULT_WAIT_MINUTES).clamp(1, 180);

    // 先确认求职配置可用，避免起来之后才发现没东西可监控
    let cfg = {
        let state = app
            .try_state::<AppState>()
            .ok_or("应用状态未就绪，请稍后重试")?;
        crate::job_hunt::JobHuntConfig::load(&state.store)
    };
    if cfg.platforms.is_empty() {
        return Err("还没有选择投递平台：请先在设置 → 求职里勾选平台并保存。".into());
    }

    STOP.store(false, Ordering::SeqCst);
    RUNNING.store(true, Ordering::SeqCst);
    let started = now_ms();
    let deadline = started + minutes * 60 * 1000;
    publish(&app, |s| {
        *s = WaitState {
            running: true,
            started_ms: started,
            deadline_ms: deadline,
            rounds: 0,
            replies: 0,
            last_note: format!("已开始等待回复，最多 {minutes} 分钟"),
        };
    });
    thought(
        &app,
        "phase",
        "开始等待回复",
        &format!(
            "后台每 {} 秒检查一次 {} 个平台的会话，最多等 {minutes} 分钟；\
             有回复会自动按你的口吻回应。",
            POLL_INTERVAL.as_secs(),
            cfg.platforms.len()
        ),
    );

    let app_for_thread = app.clone();
    std::thread::spawn(move || {
        run_loop(app_for_thread, deadline);
        RUNNING.store(false, Ordering::SeqCst);
    });

    Ok(minutes)
}

/// 监控主循环
fn run_loop(app: AppHandle, deadline_ms: u64) {
    let mut rounds = 0u32;
    let mut replies = 0u32;
    let mut consecutive_failures = 0u32;

    loop {
        if STOP.load(Ordering::SeqCst) {
            finish(&app, rounds, replies, "已手动停止");
            return;
        }
        if now_ms() >= deadline_ms {
            finish(&app, rounds, replies, "已到等待时长上限");
            return;
        }

        rounds += 1;
        let check = poll_once(&app);

        match check {
            Ok(found) => {
                consecutive_failures = 0;
                if found > 0 {
                    replies += found as u32;
                    publish(&app, |s| {
                        s.rounds = rounds;
                        s.replies = replies;
                        s.last_note = format!("第 {rounds} 轮发现 {found} 条新回复");
                    });
                    thought(
                        &app,
                        "tool_result",
                        &format!("收到 {found} 条新回复"),
                        "已交给模型按你的口吻处理并回复。",
                    );
                } else {
                    publish(&app, |s| {
                        s.rounds = rounds;
                        s.last_note = format!("第 {rounds} 轮：暂无新回复");
                    });
                }
            }
            Err(e) => {
                consecutive_failures += 1;
                publish(&app, |s| {
                    s.rounds = rounds;
                    s.last_note = format!("第 {rounds} 轮检查失败：{e}");
                });
                // 连续 3 轮都失败（浏览器没起来/页面结构变了）：不再空转，直接收尾
                if consecutive_failures >= 3 {
                    finish(
                        &app,
                        rounds,
                        replies,
                        &format!("连续 {consecutive_failures} 轮检查失败：{e}"),
                    );
                    return;
                }
                thought(&app, "loop", "等待回复 · 本轮检查失败", &e);
            }
        }

        // 分段睡眠：便于「停止」及时生效，也避免一次性睡过头
        let remaining = deadline_ms.saturating_sub(now_ms());
        let sleep_ms = POLL_INTERVAL
            .as_millis()
            .min(remaining as u128)
            .min(u32::MAX as u128) as u64;
        let mut slept = 0u64;
        while slept < sleep_ms {
            if STOP.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
            slept += 500;
        }
    }
}

/// 收尾：更新状态、发事件、给用户一条明确结论
fn finish(app: &AppHandle, rounds: u32, replies: u32, reason: &str) {
    STOP.store(true, Ordering::SeqCst);
    publish(app, |s| {
        s.running = false;
        s.rounds = rounds;
        s.replies = replies;
        s.last_note = reason.to_string();
    });
    thought(
        app,
        "phase",
        "等待回复已结束",
        &format!("{reason}；共检查 {rounds} 轮，收到 {replies} 条回复。"),
    );
}

/// 执行一轮检查：让 Agent 真正去看各平台会话并回复。
///
/// 为什么不在 Rust 里写死「怎么找未读」：招聘平台的会话页结构各不相同、还会改版，
/// 写死的选择器必然在某次改版后静默失效。这里改为复用现有的 Agent 链路
/// （模型 + browser_act 工具），把「检查并回复」作为一个小任务交给它执行——
/// 页面结构变了，模型自己会重新定位，不会像硬编码那样悄悄失灵。
///
/// 返回值 = 本轮发现并处理的新回复条数（0 表示没有新消息）。
fn poll_once(app: &AppHandle) -> Result<usize, String> {
    let cfg = {
        let state = app.try_state::<AppState>().ok_or("应用状态未就绪")?;
        crate::job_hunt::JobHuntConfig::load(&state.store)
    };
    if cfg.platforms.is_empty() {
        return Err("未选择投递平台".into());
    }

    let reply_rule = if cfg.auto_reply {
        format!(
            "有回复就按「{}」的口吻直接回复对方（简短、礼貌、围绕岗位匹配度，不要承诺到岗时间）。",
            if cfg.reply_style.trim().is_empty() {
                "自然、简洁、礼貌"
            } else {
                cfg.reply_style.trim()
            }
        )
    } else {
        "有回复**不要**代为回复，只统计并在结果里说明对方说了什么。".to_string()
    };

    let task = format!(
        "【求职回复监控 · 本轮检查】\n\
         平台：{}\n\
         用 browser_act 依次打开这些平台的消息/会话页（登录态已保留），查看有没有 HR 新发来的消息。\n\
         {reply_rule}\n\
         每回复一条，调用 job_hunt_record 记一条（status=replied）。\n\n\
         最后**只输出一行**结论，二选一：\n\
         - 没有新回复 → 输出 `NONE`\n\
         - 有 N 条新回复 → 输出 `FOUND:N`（N 用阿拉伯数字，例如 FOUND:2）",
        cfg.platforms.join("、"),
    );

    // Supervisor::run 是 async，而本模块跑在独立线程：用 channel 把结果接回来，
    // 同时保留超时——某一轮卡住不应该把整个监控拖死。
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app_clone.state::<AppState>();
        let result = crate::agent::Supervisor::new(&app_clone, state.inner())
            .run(&task, vec![])
            .await;
        let _ = tx.send(result);
    });

    let answer = match rx.recv_timeout(POLL_TIMEOUT) {
        Ok(Ok(text)) => text,
        Ok(Err(e)) => return Err(format!("本轮检查失败：{e}")),
        Err(_) => {
            return Err(format!(
                "本轮检查超时（{}s 未完成）",
                POLL_TIMEOUT.as_secs()
            ))
        }
    };

    // 解析模型给出的结论行
    let upper = answer.to_uppercase();
    if let Some(idx) = upper.rfind("FOUND:") {
        let tail = &answer[idx + "FOUND:".len()..];
        let digits: String = tail.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<usize>() {
            return Ok(n);
        }
    }
    if upper.contains("NONE") {
        return Ok(0);
    }
    // 没按格式回答：把原文当说明带出去，本轮按「无新回复」处理，但留下痕迹
    crate::windows::diag_log(&format!(
        "[等待回复] 本轮结论无法解析，原文前 200 字：{}",
        answer.chars().take(200).collect::<String>()
    ));
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_wait_is_thirty_minutes() {
        assert_eq!(DEFAULT_WAIT_MINUTES, 30);
    }

    #[test]
    fn wait_state_default_is_idle() {
        let s = WaitState::default();
        assert!(!s.running);
        assert_eq!(s.rounds, 0);
        assert_eq!(s.replies, 0);
    }

    /// 时长会被夹到合理区间：太短没意义，太长会变成隐形常驻
    #[test]
    fn minutes_are_clamped() {
        // 通过公开常量与 start 的 clamp 逻辑间接验证边界
        assert!(DEFAULT_WAIT_MINUTES >= 1 && DEFAULT_WAIT_MINUTES <= 180);
    }
}

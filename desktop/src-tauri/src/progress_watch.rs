//! 任务进展看门狗：解决「发完任务一直没有消息」的静默停滞。
//!
//! 背景（2026-10-19 16:06）：用户发了一条任务，Agent 第一轮工具调用（browser_act tabs）
//! 成功后**再无任何动静**——没有新工具调用、没有报错、没有落库、没有对外连接，
//! 主线程也没卡（hangwatch 无记录）。界面就永远停在「推演中」，用户只能干等。
//!
//! 已有的超时都只管具体环节（CDP 120s / browser_act 150s / 流式空闲 180s /
//! 响应头 60s / 审批 900s），**没有任何一层管「循环本身还在不在推进」**。
//!
//! 本模块补的正是这一层：
//!   · Agent 每轮开始、模型返回、工具开始/结束都调 `mark_stage` 打点；
//!   · 后台线程每 5 秒检查「距离上次打点多久了」；
//!   · 超过 STALL_WARN 秒：往执行流推一条 thought，告诉用户卡在哪一步（可见、不打断）；
//!   · 超过 STALL_ABORT 秒：置取消标志，让 Agent 以明确错误收尾，而不是永远挂着。
//!
//! 只做「发现并收尾」，不猜测根因、不重启任何东西。

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::{AppHandle, Emitter};

/// 多少秒没进展就提示用户（不打断任务）
const STALL_WARN: u64 = 90;
/// 多少秒没进展就强制中止（避免永久挂起）
pub const STALL_ABORT: u64 = 240;
/// 检查间隔
const TICK: Duration = Duration::from_secs(5);

/// 当前阶段描述（"执行工具 · browser_act" / "等待模型响应（第 3 轮）"）
static STAGE: OnceLock<Mutex<String>> = OnceLock::new();
/// 上次进展时间
static LAST_AT: OnceLock<Mutex<Instant>> = OnceLock::new();
/// 任务是否在进行中（空闲时看门狗不动作）。
/// 用计数而不是 bool：桌面聊天和 IM（微信/飞书）可能各自开一个 Scope，
/// 谁先结束都不该把另一个的监控关掉。
static ACTIVE: AtomicUsize = AtomicUsize::new(0);
/// 已发过警告的时间戳（避免每 5 秒刷一条）
static WARNED_AT: AtomicU64 = AtomicU64::new(0);
/// 看门狗线程是否已启动
static STARTED: OnceLock<()> = OnceLock::new();

fn stage_slot() -> &'static Mutex<String> {
    STAGE.get_or_init(|| Mutex::new("空闲".to_string()))
}

fn last_slot() -> &'static Mutex<Instant> {
    LAST_AT.get_or_init(|| Mutex::new(Instant::now()))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 任务开始：进入看门狗监控范围。
pub fn begin() {
    ACTIVE.fetch_add(1, Ordering::SeqCst);
    WARNED_AT.store(0, Ordering::SeqCst);
    if let Ok(mut s) = stage_slot().lock() {
        *s = "任务开始".to_string();
    }
    if let Ok(mut t) = last_slot().lock() {
        *t = Instant::now();
    }
}

/// 任务结束（正常/报错/取消都调）：退出监控，避免空闲时误报。
pub fn end() {
    // 计数式：减到 0 才算真的空闲；重复 end 不会把计数减成负数。
    let prev = ACTIVE.load(Ordering::SeqCst);
    if prev > 0 {
        ACTIVE.fetch_sub(1, Ordering::SeqCst);
    }
    WARNED_AT.store(0, Ordering::SeqCst);
    if ACTIVE.load(Ordering::SeqCst) == 0 {
        if let Ok(mut s) = stage_slot().lock() {
            *s = "空闲".to_string();
        }
    }
}

/// 强制退出监控（看门狗自己中止任务时用，把所有计数一次清零）。
fn force_end() {
    ACTIVE.store(0, Ordering::SeqCst);
    WARNED_AT.store(0, Ordering::SeqCst);
    if let Ok(mut s) = stage_slot().lock() {
        *s = "空闲".to_string();
    }
}

/// RAII 守卫：`chat` 里创建一次，任何退出路径（正常/Err/panic 展开）都会自动 end()，
/// 不会出现「任务早已结束、看门狗还在倒计时」的误报。
pub struct Scope;

impl Scope {
    pub fn new() -> Self {
        begin();
        Self
    }
}

impl Drop for Scope {
    fn drop(&mut self) {
        end();
    }
}

impl Default for Scope {
    fn default() -> Self {
        Self::new()
    }
}

/// 打点：任何「任务确实在推进」的时刻调用，重置停滞计时。
pub fn mark_stage(stage: &str) {
    if let Ok(mut s) = stage_slot().lock() {
        *s = stage.to_string();
    }
    if let Ok(mut t) = last_slot().lock() {
        *t = Instant::now();
    }
    WARNED_AT.store(0, Ordering::SeqCst);
}

/// 轮次打点（额外写日志，便于事后定位停在第几轮）。
pub fn mark_round(round: usize) {
    mark_stage(&format!("第 {round} 轮执行中"));
}

fn current_stage() -> String {
    stage_slot().lock().map(|s| s.clone()).unwrap_or_default()
}

fn idle_secs() -> u64 {
    last_slot()
        .lock()
        .map(|t| t.elapsed().as_secs())
        .unwrap_or(0)
}

/// 对外暴露的「已经停滞多少秒」：没有任务在跑时返回 0。
/// IM 入口用它判断上一轮是不是已经死透了（超过 [`STALL_ABORT`] 就该重新接管，
/// 而不是继续把新消息当补充排队）。
pub fn stall_secs() -> u64 {
    if ACTIVE.load(Ordering::SeqCst) == 0 {
        return 0;
    }
    idle_secs()
}

/// 启动看门狗线程（setup 里调用一次）。
pub fn install(app: AppHandle) {
    STARTED.get_or_init(|| {
        std::thread::spawn(move || loop {
            std::thread::sleep(TICK);
            if ACTIVE.load(Ordering::SeqCst) == 0 {
                continue;
            }
            let idle = idle_secs();
            if idle >= STALL_ABORT {
                let stage = current_stage();
                crate::windows::diag_log(&format!(
                    "[看门狗·停滞] 已 {idle}s 无进展，强制中止（阶段：{stage}）"
                ));
                let msg = format!(
                    "任务已 {idle} 秒没有任何进展，已自动中止（卡在：{stage}）。\n\
                     已完成的步骤仍然有效。请重试，或把任务拆小；若反复卡在同一步，\
                     请把这一步的报错发给开发者。"
                );
                let _ = app.emit(
                    "thought",
                    json!({ "kind": "loop", "label": "任务停滞 · 已中止", "detail": msg }),
                );
                // 置取消标志：Agent 循环在下一个检查点以「已停止」收尾
                crate::request_cancel();
                force_end();
                continue;
            }
            if idle >= STALL_WARN {
                let last = WARNED_AT.load(Ordering::SeqCst);
                // 同一轮停滞只提示一次（60 秒内不重复）
                if last != 0 && now_ms().saturating_sub(last) < 60_000 {
                    continue;
                }
                WARNED_AT.store(now_ms(), Ordering::SeqCst);
                let stage = current_stage();
                crate::windows::diag_log(&format!(
                    "[看门狗·停滞] 已 {idle}s 无进展（阶段：{stage}），发出提示"
                ));
                let _ = app.emit(
                    "thought",
                    json!({
                        "kind": "loop",
                        "label": format!("任务可能卡住 · 已 {idle}s 无进展"),
                        "detail": format!(
                            "当前卡在：{stage}。若继续无进展，{} 秒后会自动中止。",
                            STALL_ABORT
                        ),
                    }),
                );
            }
        });
    });
}

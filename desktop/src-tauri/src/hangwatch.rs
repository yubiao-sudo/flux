//! 主线程卡顿看门狗：卡到「Windows 判定无响应并被关掉」时，事后必须有现场。
//!
//! 背景（2026-10-17）：安装版 0.8.8 在 17:15:33 被判 Application Hang（事件 1002）后关闭。
//! 因为既没有 panic（panic 钩子无记录）、也没有未处理异常（SEH 过滤器无记录）、WER 也没有
//! dump，事后只有一条 Windows 事件 —— 完全不知道卡在哪个函数，只能靠猜。
//!
//! 本模块的做法：后台线程每秒给主线程投递一个空任务并计时往返。主线程正常时 RTT < 5ms；
//! 一旦主线程被同步命令/锁/磁盘停顿拖住，RTT 直接涨到阈值以上，此时把「卡了多久 + 当时
//! 在跑什么」写进 exe 同目录的 baize-overlay.log。
//!
//! 只记录，不干预：不杀线程、不结束进程、不改任何业务行为。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::AppHandle;

/// 探针间隔（正常路径下主线程每秒多处理一个空任务，开销可忽略）
const PROBE_MS: u64 = 1000;
/// 单次等待上限：超过即认定主线程卡住
const WAIT_MS: u64 = 1200;
/// 未卡但明显慢（比如 300ms 起）：也记一条，便于看「越来越卡」的趋势
const WARN_MS: u128 = 300;
/// 持续卡住时，每秒补一条日志太吵；每多少秒补一条（避免刷屏又能看清卡了多久）
const REPEAT_SECS: u64 = 10;
/// 卡住超过 30 秒就自动抓一次 minidump，下次不用人工附加进程
const DUMP_AFTER_MS: u128 = 30_000;

/// 主动退出时置位：主线程忙着清理被杀前不写「卡顿」（否则每次退出都留一条假案）
static STOPPED: AtomicBool = AtomicBool::new(false);

/// 通知探针线程本次进程正在主动退出（`quit_hard` 里调用）
pub fn stop() {
    STOPPED.store(true, Ordering::SeqCst);
}

fn activity_slot() -> &'static Mutex<(String, Instant)> {
    static SLOT: OnceLock<Mutex<(String, Instant)>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(("启动 · 尚未进入对话".to_string(), Instant::now())))
}

/// 标记「当前在跑什么」（对话轮次 / 具体工具 / 收尾阶段）。
///
/// 由 agent 循环在派发工具前后调用；卡死日志里带上它，就能确定是哪个工具或哪一段。
pub fn mark(label: impl Into<String>) {
    if let Ok(mut g) = activity_slot().lock() {
        g.0 = label.into();
        g.1 = Instant::now();
    }
}

fn activity_text() -> String {
    match activity_slot().lock() {
        Ok(g) => format!("{}（{}s 前标记）", g.0, g.1.elapsed().as_secs()),
        Err(_) => "未知".to_string(),
    }
}

/// 主线程 id（`install` 时在主线程记录），用于把慢日志区分成「主线程」与普通线程
static MAIN_TID: OnceLock<std::thread::ThreadId> = OnceLock::new();

/// 在 setup 的主线程上调用一次
pub fn mark_main_thread() {
    let _ = MAIN_TID.set(std::thread::current().id());
}

/// 主线程闭包耗时超过这个值就记一条
const WATCH_SLOW_MS: u128 = 80;

/// 主线程工作耗时护栏（RAII）。
///
/// 用法：在 `run_on_main_thread` 的闭包里第一行写
/// `let _w = crate::hangwatch::watch("halo.create");`
/// 离开作用域时如果超过阈值就写日志。
pub struct Watch {
    label: &'static str,
    start: Instant,
}

pub fn watch(label: &'static str) -> Watch {
    Watch {
        label,
        start: Instant::now(),
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        let ms = self.start.elapsed().as_millis();
        if ms < WATCH_SLOW_MS {
            return;
        }
        let on_main = MAIN_TID
            .get()
            .map(|id| *id == std::thread::current().id())
            .unwrap_or(false);
        log(&format!(
            "{}[{}] 耗时 {}ms",
            if on_main { "主线程" } else { "线程" },
            self.label,
            ms
        ));
    }
}

fn log(line: &str) {
    crate::windows::diag_log(&format!("[卡顿] {line}"));
}

/// 启动探针线程（setup 里调用一次）
pub fn install(app: AppHandle) {
    mark_main_thread();
    std::thread::spawn(move || {
        // 已开始计时但还没恢复
        let mut stuck_since: Option<Instant> = None;
        let mut last_repeat = Instant::now();
        let mut dumped = false;
        loop {
            std::thread::sleep(Duration::from_millis(PROBE_MS));
            // 主动退出中：清理慢是正常的，别记成卡顿
            if STOPPED.load(Ordering::SeqCst) {
                return;
            }
            // 每次探针用独立通道：上一次超时后主线程仍会补跑那个闭包，
            // 复用通道会把「迟到的回执」误判成本次即时响应。
            let (tx, rx) = mpsc::channel::<()>();
            let t0 = Instant::now();
            if app
                .run_on_main_thread(move || {
                    let _ = tx.send(());
                })
                .is_err()
            {
                // 事件循环已退出（正常关机路径），探针自然结束
                return;
            }
            match rx.recv_timeout(Duration::from_millis(WAIT_MS)) {
                Ok(()) => {
                    let rtt = t0.elapsed().as_millis();
                    dumped = false;
                    if let Some(since) = stuck_since.take() {
                        let held = since.elapsed().as_millis();
                        if held >= 1000 {
                            log(&format!(
                                "主线程恢复：累计阻塞 {}ms（最后单次往返 {}ms）| 活动: {}",
                                held,
                                rtt,
                                activity_text()
                            ));
                        }
                    } else if rtt >= WARN_MS {
                        log(&format!(
                            "主线程响应慢 {}ms | 活动: {}",
                            rtt,
                            activity_text()
                        ));
                    }
                }
                Err(_) => match stuck_since {
                    None => {
                        stuck_since = Some(t0);
                        last_repeat = Instant::now();
                        log(&format!(
                            "主线程 ≥{}ms 无响应，开始计时 | 活动: {}",
                            WAIT_MS,
                            activity_text()
                        ));
                    }
                    Some(since) => {
                        if !dumped && since.elapsed().as_millis() >= DUMP_AFTER_MS {
                            dumped = true;
                            let activity = activity_text();
                            std::thread::spawn(move || {
                                match crate::crashlog::write_hang_dump() {
                                    Some(path) => log(&format!(
                                        "主线程卡死超过 {}s，已写入 minidump: {} | 活动: {}",
                                        DUMP_AFTER_MS / 1000,
                                        path.display(),
                                        activity
                                    )),
                                    None => log(&format!(
                                        "主线程卡死超过 {}s，minidump 写入失败 | 活动: {}",
                                        DUMP_AFTER_MS / 1000,
                                        activity
                                    )),
                                }
                            });
                        }
                        if last_repeat.elapsed() >= Duration::from_secs(REPEAT_SECS) {
                            last_repeat = Instant::now();
                            log(&format!(
                                "主线程仍无响应，已持续 {}ms | 活动: {}",
                                since.elapsed().as_millis(),
                                activity_text()
                            ));
                        }
                    }
                },
            }
        }
    });
}

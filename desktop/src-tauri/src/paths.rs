//! 数据目录绑定：所有运行时数据（数据库 / 浏览器登录态 / 截图缓存）统一落在
//! 「安装目录\data」下，安装/首次启动自动生成，不再散落在 C 盘工作目录或 AppData。
//!
//! 目录解析策略：
//!   1. 首选 `<exe 所在目录>\data` —— NSIS 默认按当前用户安装（%LOCALAPPDATA%\FLUX），
//!      该目录对普通用户可写；用户自定义安装到 D 盘等位置时同样可写。
//!   2. 兜底：目录不可写（如按机器级别装进 Program Files 且未提权）时回退
//!      `%LOCALAPPDATA%\FLUX\data`，并置 fallback 标记（设置页/引导层如实提示）。
//!
//! 数据隔离：FLUX 只读写自己的 `data\flux.db`。绝不导入 `%LOCALAPPDATA%\baize`
//! 下的数据库、浏览器登录态或 IM 凭据——白泽与 FLUX 可能同时运行，共用微信机器人
//! token 会让两个进程抢同一条消息流。
//!
//! 旧 FLUX 数据迁移（一次性，幂等）：
//!   - 早期 FLUX 构建曾把库命名为 `data\baize.db`；若 `flux.db` 不存在且
//!     `data\baize.db` 存在，只在本目录内改名复制，不读取任何外部白泽目录。
//!   - 迁移采用「复制不删除」：旧文件留在原地由用户自行清理，避免误删风险。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

static DATA_ROOT: OnceLock<PathBuf> = OnceLock::new();
static FALLBACK: AtomicBool = AtomicBool::new(false);

/// 已解析的数据根目录（init 之前调用返回 exe 旁临时推算值，正常流程 init 最早执行）
pub fn data_root() -> &'static std::path::Path {
    DATA_ROOT.get().map(|p| p.as_path()).unwrap_or_else(|| {
        // 未 init（理论不会发生）：返回 exe 旁 data，保证调用方拿到确定路径
        Box::leak(Box::new(default_root())) as &std::path::Path
    })
}

/// 是否处于兜底目录（安装目录不可写）
pub fn is_fallback() -> bool {
    FALLBACK.load(Ordering::Relaxed)
}

pub fn db_path() -> PathBuf {
    data_root().join("flux.db")
}

pub fn screens_dir() -> PathBuf {
    data_root().join("screens")
}

pub fn browser_profile_dir() -> PathBuf {
    data_root().join("browser-profile")
}

fn default_root() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("data")
}

fn localappdata_flux() -> Option<PathBuf> {
    std::env::var("LocalAppData")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(|lad| PathBuf::from(lad).join("FLUX"))
}

/// 启动最早时机调用：解析 + 创建 + 迁移 + 缓存清理。幂等，可安全重复调用。
pub fn init() {
    let candidate = default_root();
    let root = match std::fs::create_dir_all(&candidate) {
        Ok(()) => {
            // 试写验证：目录存在 ≠ 可写（Program Files 场景）
            let probe = candidate.join(".write-test");
            match std::fs::write(&probe, b"ok").and_then(|_| std::fs::remove_file(&probe)) {
                Ok(()) => candidate,
                Err(_) => fallback_root(),
            }
        }
        Err(_) => fallback_root(),
    };
    let _ = DATA_ROOT.set(root);
    migrate_legacy();
    cleanup_screens();
}

/// 启动清理：screens 截图缓存只保留最近 7 天。
/// GUI 自动化每次任务都会产生数张 PNG（截图/关键帧/SOM 标注/diff 高亮图），
/// 不清理会在长期使用后堆积上 GB。仅限 data\screens 目录内、修改时间超 7 天的
/// .png 缓存文件，其他数据（数据库/浏览器登录态）不受影响。
fn cleanup_screens() {
    const KEEP_SECS: u64 = 7 * 24 * 3600;
    let dir = screens_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut removed = 0usize;
    for e in entries.flatten() {
        let path = e.path();
        let is_png = path
            .extension()
            .map(|x| x.eq_ignore_ascii_case("png"))
            .unwrap_or(false);
        if !is_png {
            continue;
        }
        let modified_secs = e
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(now);
        if now.saturating_sub(modified_secs) > KEEP_SECS {
            if std::fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }
    if removed > 0 {
        println!("[清理] 已清理 {removed} 张 7 天前的截图缓存（{dir:?}）");
    }
}

fn fallback_root() -> PathBuf {
    FALLBACK.store(true, Ordering::Relaxed);
    let lad = localappdata_flux()
        .unwrap_or_else(|| std::env::temp_dir().join("flux"));
    let root = lad.join("data");
    let _ = std::fs::create_dir_all(&root);
    root
}

/// 升级前把整个数据目录备份到 %LocalAppData%\FLUX\update-backup。
/// NSIS 升级会先运行旧版卸载器清空 $INSTDIR（含 data），此备份是升级链路的数据保险。
/// 返回是否备份成功（尚无数据 / 备份失败均返回 false，不阻断升级）。
pub fn backup_to_appdata() -> bool {
    let root = data_root().to_path_buf();
    if !root.join("flux.db").exists() {
        return false; // 还没有任何用户数据，无需备份
    }
    let Some(lad) = localappdata_flux() else {
        return false;
    };
    let backup = lad.join("update-backup");
    let _ = std::fs::remove_dir_all(&backup);
    let _ = std::fs::create_dir_all(&backup);
    copy_dir_recursive(&root, &backup)
}

/// 一次性迁移：只处理 FLUX 自己 data 目录里的旧命名（baize.db → flux.db）。
/// 目标已存在则跳过，幂等；不读取白泽的 AppData / 浏览器 profile / IM 凭据。
fn migrate_legacy() {
    let root = data_root().to_path_buf();
    let new_db = root.join("flux.db");

    // ── 1) 早期 FLUX 构建的 data\baize.db：仅本目录内迁移 ──
    if !new_db.exists() {
        let old_db = root.join("baize.db");
        if old_db.exists() && copy_db_trio(&old_db, &new_db) {
            println!(
                "[数据迁移] 已将 FLUX 旧库 {} 迁移为 {}",
                old_db.display(),
                new_db.display()
            );
        }
    }

    // ── 1.5) 升级备份回填：只读 FLUX 自己的 %LOCALAPPDATA%\FLUX\update-backup ──
    if !new_db.exists() {
        if let Some(lad) = localappdata_flux() {
            let backup = lad.join("update-backup");
            if backup.join("flux.db").exists() && copy_dir_recursive(&backup, &root) {
                println!(
                    "[数据恢复] 已从升级备份 {} 回填数据目录 {}",
                    backup.display(),
                    root.display()
                );
            }
        }
    }
}

/// 复制数据库三件套（db + wal + shm；wal/shm 缺失忽略）
fn copy_db_trio(src: &std::path::Path, dst: &std::path::Path) -> bool {
    if std::fs::copy(src, dst).is_err() {
        return false;
    }
    for ext in ["-wal", "-shm"] {
        let s = src.with_extension(format!("db{ext}"));
        if s.exists() {
            let _ = std::fs::copy(&s, dst.with_extension(format!("db{ext}")));
        }
    }
    true
}

/// 递归复制目录（浏览器 profile 可能上千个小文件，同步复制一次性成本可接受）
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> bool {
    if std::fs::create_dir_all(dst).is_err() {
        return false;
    }
    let Ok(entries) = std::fs::read_dir(src) else {
        return false;
    };
    for entry in entries.flatten() {
        let ty = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        let target = dst.join(entry.file_name());
        if ty.is_dir() {
            if !copy_dir_recursive(&entry.path(), &target) {
                return false;
            }
        } else if std::fs::copy(entry.path(), &target).is_err() {
            // 单个文件失败不中断（Cookie 库文件被占用时跳过，登录态部分保留也强于全丢）
            continue;
        }
    }
    true
}

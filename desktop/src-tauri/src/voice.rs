//! 语音输入：点一下开始录、再点一下结束 → 本地 Whisper 转写。
//!
//! 为什么需要它：打包后的 WebView2 不提供 Web Speech 的语音识别
//! （`SpeechRecognition` 依赖 Google 的语音服务，WebView2 没有内置凭据），
//! 前端那条 `recognition.start()` 在桌面端会直接报 network 错误。
//! 所以「语音聊天」的输入侧必须自己实现：ffmpeg 录默认麦克风 → 本地 Whisper 转写。
//!
//! 转写用**常驻 worker**：Python 进程只加载一次模型（约 8 秒），之后每句话
//! 只花推理时间（约 3-5 秒）。若每次现起进程，光 `import ctranslate2` + 模型加载
//! 就要 10 秒以上，语音聊天会慢到没法用。
//!
//! 录音结束用向 ffmpeg 的 stdin 写 `q` 的方式优雅退出（而不是 kill），
//! 这样 WAV 头会被正常回填，后面解码不会拿到半个文件。

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};

/// 正在进行的录音（全局单例：同一时刻只允许一路）
struct Recorder {
    child: Child,
    path: PathBuf,
}

fn recorder() -> &'static Mutex<Option<Recorder>> {
    static REC: OnceLock<Mutex<Option<Recorder>>> = OnceLock::new();
    REC.get_or_init(|| Mutex::new(None))
}

/// 常驻转写 worker
struct AsrWorker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

fn worker() -> &'static Mutex<Option<AsrWorker>> {
    static W: OnceLock<Mutex<Option<AsrWorker>>> = OnceLock::new();
    W.get_or_init(|| Mutex::new(None))
}

/// worker 脚本：加载一次模型，之后按行读取 WAV 路径、输出 JSON 文本。
const ASR_WORKER_SCRIPT: &str = r#"
import json
import os
import sys

# Windows 下管道 stdout 默认走 ANSI 代码页（GBK），中文会变成非法 UTF-8，
# 必须显式切到 UTF-8，Rust 侧才能按行解析 JSON。
sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")

# 模型已经在本地缓存：禁止再联网校验，否则每次加载会多等 20 秒以上
os.environ.setdefault("HF_HUB_OFFLINE", "1")

from faster_whisper import WhisperModel

model = WhisperModel(
    "small",
    device="cpu",
    compute_type="int8",
    local_files_only=True,
    cpu_threads=4,
)
print(json.dumps({"ready": True}), flush=True)

for line in sys.stdin:
    path = line.strip()
    if not path:
        continue
    try:
        segments, _info = model.transcribe(
            path,
            language="zh",
            vad_filter=True,
            beam_size=1,
            initial_prompt="以下是普通话对话，请用简体中文输出。",
            # 常用自称/唤醒词：显著降低「流形」被听成别的名字的概率
            hotwords="流形 FLUX 白泽",
            condition_on_previous_text=False,
        )
        text = "".join(segment.text for segment in segments).strip()
        print(json.dumps({"text": text}, ensure_ascii=False), flush=True)
    except Exception as exc:  # 单句失败不应该让 worker 退出
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), flush=True)
"#;

/// 探测系统默认麦克风（ffmpeg dshow 设备列表里的第一个音频输入）
fn discover_mic() -> Option<String> {
    let out = crate::tools::silent_command("ffmpeg")
        .args(["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stderr).to_string();
    let mut in_audio = false;
    for line in text.lines() {
        if line.contains("DirectShow audio devices") {
            in_audio = true;
            continue;
        }
        if !in_audio {
            continue;
        }
        if line.contains("DirectShow video devices") || line.contains("Alternative name") {
            break;
        }
        if let (Some(a), Some(b)) = (line.find('"'), line.rfind('"')) {
            if b > a {
                return Some(line[a + 1..b].to_string());
            }
        }
    }
    None
}

fn python_exe() -> Option<String> {
    if let Ok(p) = std::env::var("FLUX_ASR_PYTHON") {
        if !p.trim().is_empty() && std::path::Path::new(&p).is_file() {
            return Some(p);
        }
    }
    for candidate in [r"D:\python311\python.exe", r"C:\Python311\python.exe"] {
        if std::path::Path::new(candidate).is_file() {
            return Some(candidate.to_string());
        }
    }
    let ok = crate::tools::silent_command("python")
        .args(["--version"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    ok.then(|| "python".to_string())
}

/// 启动（或复用）常驻 worker；返回是否就绪。
fn ensure_worker() -> Result<(), String> {
    let mut guard = worker().lock().map_err(|_| "ASR 状态锁异常".to_string())?;
    if let Some(w) = guard.as_mut() {
        if w.child.try_wait().ok().flatten().is_none() {
            return Ok(());
        }
        // 进程已退出：清掉后重建
        *guard = None;
    }
    let py = python_exe()
        .ok_or_else(|| "未找到 Python（语音转写需要 faster-whisper）".to_string())?;
    let dir = crate::paths::data_root().join("asr");
    let _ = std::fs::create_dir_all(&dir);
    let script = dir.join("asr_worker.py");
    std::fs::write(&script, ASR_WORKER_SCRIPT)
        .map_err(|e| format!("写入语音转写脚本失败: {e}"))?;

    let mut child = crate::tools::silent_command(&py)
        .arg(&script)
        .env("HF_ENDPOINT", "https://hf-mirror.com")
        .env("HF_HUB_OFFLINE", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动语音转写进程失败: {e}"))?;
    let stdin = child.stdin.take().ok_or_else(|| "无法写入转写进程".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "无法读取转写进程".to_string())?;
    let mut reader = BufReader::new(stdout);

    // 等 model ready；首次会下载/加载模型，给足 180 秒
    let deadline = std::time::Instant::now() + Duration::from_secs(180);
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            return Err("语音转写进程启动失败（模型未就绪）".to_string());
        }
        if line.contains("\"ready\"") {
            break;
        }
        if std::time::Instant::now() > deadline {
            let _ = child.kill();
            return Err("语音转写模型加载超时".to_string());
        }
    }
    *guard = Some(AsrWorker { child, stdin, stdout: reader });
    Ok(())
}

/// 把 WAV 路径交给常驻 worker，读回 JSON 文本
fn transcribe_with_worker(path: &std::path::Path) -> Result<String, String> {
    ensure_worker()?;
    let mut guard = worker().lock().map_err(|_| "ASR 状态锁异常".to_string())?;
    let Some(w) = guard.as_mut() else {
        return Err("语音转写进程未就绪".to_string());
    };
    let line = format!("{}\n", path.to_string_lossy());
    w.stdin
        .write_all(line.as_bytes())
        .and_then(|_| w.stdin.flush())
        .map_err(|e| format!("写入转写请求失败: {e}"))?;
    let mut out = String::new();
    if w.stdout.read_line(&mut out).unwrap_or(0) == 0 {
        *guard = None;
        return Err("语音转写进程已退出".to_string());
    }
    let v: Value = serde_json::from_str(out.trim())
        .map_err(|e| format!("解析转写结果失败: {e}"))?;
    if let Some(err) = v.get("error").and_then(|x| x.as_str()) {
        return Err(format!("转写失败: {err}"));
    }
    Ok(v
        .get("text")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .trim()
        .to_string())
}

/// 回退：openai-whisper CLI（模型缓存在 ~/.cache/whisper，冷启动较慢）
fn transcribe_with_cli(path: &std::path::Path) -> Result<String, String> {
    let dir = std::env::temp_dir().join(format!("flux-asr-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建转写目录失败: {e}"))?;
    let out = crate::tools::silent_command("whisper")
        .arg(path)
        .args(["--model", "small", "--language", "zh", "--task", "transcribe"])
        .args(["--output_format", "txt", "--fp16", "False"])
        .arg("--output_dir")
        .arg(&dir)
        .output();
    let result = (|| -> Result<String, String> {
        let o = out.map_err(|e| {
            format!("未找到本地 Whisper（pip install faster-whisper 或 openai-whisper）: {e}")
        })?;
        if !o.status.success() {
            let err = String::from_utf8_lossy(&o.stderr);
            return Err(format!(
                "Whisper 转写失败: {}",
                err.chars().take(200).collect::<String>()
            ));
        }
        let entry = std::fs::read_dir(&dir)
            .map_err(|e| e.to_string())?
            .flatten()
            .find(|e| {
                e.path()
                    .extension()
                    .map(|x| x.to_string_lossy().eq_ignore_ascii_case("txt"))
                    .unwrap_or(false)
            });
        let Some(entry) = entry else {
            return Ok(String::new());
        };
        let text = std::fs::read_to_string(entry.path()).unwrap_or_default();
        Ok(text.trim().to_string())
    })();
    let _ = std::fs::remove_dir_all(&dir);
    result
}

fn transcribe(path: &std::path::Path) -> Result<String, String> {
    match transcribe_with_worker(path) {
        Ok(t) => Ok(t),
        Err(e) => {
            println!("[语音] worker 转写失败，回退 CLI: {e}");
            transcribe_with_cli(path)
        }
    }
}

/// 开始录音。重复调用是幂等的（已在录则直接返回）。
fn start_recording() -> Result<(), String> {
    let mut guard = recorder().lock().map_err(|_| "录音状态锁异常".to_string())?;
    if guard.is_some() {
        return Ok(());
    }
    let mic = discover_mic()
        .ok_or_else(|| "没有找到可用的麦克风（ffmpeg dshow 未列出音频设备）".to_string())?;
    let path = std::env::temp_dir().join(format!(
        "flux-voice-{}.wav",
        uuid::Uuid::new_v4().simple()
    ));
    let child = crate::tools::silent_command("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "dshow",
            "-i",
            &format!("audio={mic}"),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-y",
        ])
        .arg(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动 ffmpeg 录音失败（是否安装 ffmpeg 并在 PATH？）: {e}"))?;
    *guard = Some(Recorder { child, path });
    Ok(())
}

/// 结束录音并转写
fn stop_and_transcribe() -> Result<String, String> {
    let rec = {
        let mut guard = recorder().lock().map_err(|_| "录音状态锁异常".to_string())?;
        guard.take()
    };
    let Some(mut rec) = rec else {
        return Err("当前没有在录音".to_string());
    };
    if let Some(stdin) = rec.child.stdin.as_mut() {
        let _ = stdin.write_all(b"q\n");
        let _ = stdin.flush();
    }
    let deadline = std::time::Instant::now() + Duration::from_secs(6);
    loop {
        match rec.child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(80));
            }
            _ => {
                let _ = rec.child.kill();
                let _ = rec.child.wait();
                break;
            }
        }
    }
    let meta = std::fs::metadata(&rec.path)
        .map_err(|e| format!("录音文件不存在（麦克风被占用或未授权？）: {e}"))?;
    // 16k/16bit/单声道 ≈ 32KB/s；低于 8KB 基本是空录
    if meta.len() < 8_000 {
        let _ = std::fs::remove_file(&rec.path);
        return Ok(String::new());
    }
    let text = transcribe(&rec.path);
    let _ = std::fs::remove_file(&rec.path);
    text
}

/// 预热：应用启动后后台加载 ASR 模型，第一次点麦克风不用等模型
pub fn warm() {
    std::thread::spawn(|| {
        if python_exe().is_none() {
            return;
        }
        if let Err(e) = ensure_worker() {
            println!("[语音] ASR 预热失败: {e}");
        }
    });
}

/// Tauri 命令：开始录音
#[tauri::command]
pub fn voice_start() -> Result<Value, String> {
    start_recording()?;
    Ok(json!({ "ok": true, "recording": true }))
}

/// Tauri 命令：结束录音并返回识别文本
#[tauri::command]
pub async fn voice_stop() -> Result<Value, String> {
    let text = tauri::async_runtime::spawn_blocking(stop_and_transcribe)
        .await
        .map_err(|e| format!("转写任务异常: {e}"))??;
    Ok(json!({ "ok": true, "text": text }))
}

/// Tauri 命令：查询语音输入链路是否可用
#[tauri::command]
pub fn voice_status() -> Value {
    let has_python = python_exe().is_some();
    let has_whisper = crate::tools::silent_command("whisper")
        .args(["--help"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    json!({
        "mic": discover_mic().is_some(),
        "faster_whisper": has_python,
        "whisper_cli": has_whisper,
        "ready": has_python || has_whisper,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_without_start_is_an_error() {
        assert!(stop_and_transcribe().is_err());
    }

    #[test]
    fn worker_script_mentions_offline_and_simplified_prompt() {
        assert!(ASR_WORKER_SCRIPT.contains("HF_HUB_OFFLINE"));
        assert!(ASR_WORKER_SCRIPT.contains("简体中文"));
    }
}

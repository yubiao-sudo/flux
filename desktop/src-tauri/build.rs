fn main() {
    // The desktop app uses a separate binary name and a shared Cargo target,
    // so it must not kill another app's debug process during a build.
    #[cfg(windows)]
    delayload_comctl32();
    tauri_build::build()
}

/// 把 comctl32 改成**延迟加载**，修掉 `cargo test` 启动即 `0xC0000139` 的问题。
///
/// 背景（2026-10-17 定位，PE 导入表逐符号核对）：
/// 依赖树（`tauri-runtime-wry` / `muda` / `rfd`）会从 comctl32 导入
/// `TaskDialogIndirect`，这个符号只存在于 comctl32 **v6**（WinSxS 重定向）；
/// `C:\Windows\System32\comctl32.dll` 是 5.82，没有该导出。
/// Tauri 只给**主 bin** 嵌带 Common-Controls v6 的清单，所以：
///   - `cargo build` 出的 baize.exe 正常；
///   - lib 的单元测试二进制、examples 没有清单 → 加载器绑定 5.82 →
///     启动即 `STATUS_ENTRYPOINT_NOT_FOUND (0xC0000139)`。
/// 这就是「`cargo test` 一直跑不起来」的真正原因，不是代码错、不是环境缺 DLL。
///
/// 为什么不用「给测试目标补清单」：cargo 的 `rustc-link-arg-tests` 只作用于
/// `tests/` 目录（本项目没有），而无作用域的 `rustc-link-arg` 会连主 bin 一起加，
/// 与 tauri 已嵌入的 RT_MANIFEST 冲突（实测 `CVT1100: 资源重复, 类型: MANIFEST`）。
/// 延迟加载没有这个问题：导入不再在加载期解析，进程能正常起来；
/// 真正调用该符号时才解析（单元测试不会调用对话框，主 bin 有清单照常解析到 v6）。
#[cfg(windows)]
fn delayload_comctl32() {
    println!("cargo:rustc-link-arg=/DELAYLOAD:comctl32.dll");
    println!("cargo:rustc-link-lib=delayimp");
}

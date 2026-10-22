"""一条命令跑完项目所有验收。

## 为什么需要

改动前只有零散脚本：UI 验收、透明浮层验收、cargo 编译，各跑各的，
很容易漏。CI 也需要一个入口，而不是在 YAML 里堆命令。

## 用法

    python desktop/scripts/check_all.py            # 前端构建 + 两组浏览器验收
    python desktop/scripts/check_all.py --with-rust # 再加 cargo check --tests
    python desktop/scripts/check_all.py --fast      # 跳过构建（dist 已是最新时）

退出码非 0 表示有失败项。
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DESKTOP = os.path.dirname(HERE)          # …/desktop
ROOT = os.path.dirname(DESKTOP)          # 仓库根


def resolve(cmd: list[str]) -> list[str]:
    """把命令名解析成可执行文件。

    Windows 上 pnpm 常常只有 .ps1 / .cmd 垫片，subprocess 直接调 "pnpm" 会
    FileNotFoundError。优先找 .cmd/.exe/.bat（powershell 垫片不能被 CreateProcess 直接执行）。
    """
    exe = cmd[0]
    if os.name == "nt":
        for ext in (".cmd", ".exe", ".bat"):
            found = shutil.which(exe + ext)
            if found:
                return [found] + cmd[1:]
    found = shutil.which(exe)
    return [found or exe] + cmd[1:]


def run(name: str, cmd: list[str], cwd: str) -> tuple[str, int]:
    print(f"\n{'=' * 60}\n▶ {name}\n{'=' * 60}")
    proc = subprocess.run(resolve(cmd), cwd=cwd)
    status = "通过" if proc.returncode == 0 else f"失败（退出码 {proc.returncode}）"
    print(f"\n◀ {name}: {status}")
    return name, proc.returncode


def main() -> int:
    ap = argparse.ArgumentParser(description="项目全量验收")
    ap.add_argument("--with-rust", action="store_true", help="额外编译检查 Rust")
    ap.add_argument("--fast", action="store_true", help="跳过前端构建")
    args = ap.parse_args()

    python = sys.executable
    results: list[tuple[str, int]] = []

    if not args.fast:
        results.append(run("前端构建（tsc + vite）", ["pnpm", "build"], DESKTOP))

    # 两组浏览器验收依赖 dist，构建之后才跑
    results.append(
        run("界面验收（布局 / 启动动画 / 着色器）",
            [python, os.path.join(HERE, "check_ui_layout.py")], DESKTOP)
    )
    results.append(
        run("界面验收 · 减少动态效果（应跳过启动动画、流体静态）",
            [python, os.path.join(HERE, "check_ui_layout.py"), "--reduced-motion"], DESKTOP)
    )
    results.append(
        run("透明浮层验收（光圈 / 弹幕 / 悬浮球）",
            [python, os.path.join(HERE, "check_overlay_transparency.py")], DESKTOP)
    )
    results.append(
        run("版本号一致性",
            [python, os.path.join(HERE, "bump_version.py"), "--check"], DESKTOP)
    )

    if args.with_rust:
        results.append(
            run("Rust 编译检查", ["cargo", "check", "--offline", "--tests"], os.path.join(DESKTOP, "src-tauri"))
        )

    print("\n" + "=" * 60)
    failed = [name for name, code in results if code != 0]
    for name, code in results:
        print(f"  {'✅' if code == 0 else '❌'} {name}")
    print("=" * 60)
    if failed:
        print(f"\n结果：{len(failed)} 项失败")
        return 1
    print("\n结果：全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""P0-3：一处改版本号，三处同步。

## 为什么要它

版本号散在 `package.json` / `tauri.conf.json` / `Cargo.toml`（还有 `Cargo.lock`
里的本 crate 条目）。发版时手改三处必漏一处 —— 一旦漏了，安装包名按 A 版本，
`tauri.conf` 里显示 B 版本，排查时会对不上。

Tauri 的安装包文件名取自 `tauri.conf.json` 的 version（`FLUX_<ver>_x64-setup.exe`），
所以三处对齐后，产物名天然带版本，不会再互相覆盖。

用法：

    python desktop/scripts/bump_version.py 1.0.1        # 写入
    python desktop/scripts/bump_version.py --check      # 只检查是否一致（CI 用）
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DESKTOP = os.path.dirname(HERE)
PKG = os.path.join(DESKTOP, "package.json")
CONF = os.path.join(DESKTOP, "src-tauri", "tauri.conf.json")
CARGO = os.path.join(DESKTOP, "src-tauri", "Cargo.toml")
LOCK = os.path.join(DESKTOP, "src-tauri", "Cargo.lock")

SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def read_versions() -> dict[str, str]:
    out: dict[str, str] = {}
    with io.open(PKG, encoding="utf-8") as fh:
        out["package.json"] = json.load(fh)["version"]
    with io.open(CONF, encoding="utf-8") as fh:
        out["tauri.conf.json"] = json.load(fh)["version"]
    with io.open(CARGO, encoding="utf-8") as fh:
        m = re.search(r'^version\s*=\s*"([^"]+)"', fh.read(), re.M)
        out["Cargo.toml"] = m.group(1) if m else "?"
    with io.open(LOCK, encoding="utf-8") as fh:
        lock = fh.read()
    m = re.search(r'name = "flux"\nversion = "([^"]+)"', lock)
    out["Cargo.lock(flux)"] = m.group(1) if m else "(未找到)"
    return out


def write_version(new: str) -> None:
    # package.json：只替换顶层 version 字段（保留原有格式缩进）
    for path, pattern in (
        (PKG, r'("version"\s*:\s*")[^"]+(")'),
        (CONF, r'("version"\s*:\s*")[^"]+(")'),
    ):
        text = io.open(path, encoding="utf-8").read()
        text, n = re.subn(pattern, lambda m: m.group(1) + new + m.group(2), text, count=1)
        if n != 1:
            raise SystemExit(f"{os.path.basename(path)} 里没找到 version 字段")
        io.open(path, "w", encoding="utf-8").write(text)

    text = io.open(CARGO, encoding="utf-8").read()
    text, n = re.subn(r'^version\s*=\s*"[^"]+"', f'version = "{new}"', text, count=1, flags=re.M)
    if n != 1:
        raise SystemExit("Cargo.toml 里没找到 version")
    io.open(CARGO, "w", encoding="utf-8").write(text)

    text = io.open(LOCK, encoding="utf-8").read()
    text, n = re.subn(
        r'(name = "flux"\nversion = ")[^"]+(")',
        lambda m: m.group(1) + new + m.group(2),
        text,
        count=1,
    )
    io.open(LOCK, "w", encoding="utf-8").write(text)
    print(f"Cargo.lock flux 条目: {'已同步' if n else '未找到（首次构建会自动写入）'}")


def main() -> int:
    ap = argparse.ArgumentParser(description="统一版本号")
    ap.add_argument("version", nargs="?", help="新版本号，如 1.0.1")
    ap.add_argument("--check", action="store_true", help="只检查一致性")
    args = ap.parse_args()

    if args.check:
        versions = read_versions()
        distinct = set(v for v in versions.values() if v != "(未找到)")
        print("当前版本：")
        for k, v in versions.items():
            print(f"  {k:<20} {v}")
        if len(distinct) == 1:
            print("\n✅ 版本一致")
            return 0
        print("\n❌ 版本不一致（先跑 bump_version.py 统一）")
        return 1

    if not args.version:
        ap.error("需要版本号，或用 --check")
    if not SEMVER.match(args.version):
        ap.error(f"版本号格式应为 X.Y.Z：{args.version}")

    write_version(args.version)
    print(f"\n✅ 已统一到 {args.version}")
    for k, v in read_versions().items():
        print(f"  {k:<20} {v}")
    print("\n提示：安装包名由 tauri.conf.json 的 version 决定，"
          f"下一次构建产物会叫 FLUX_{args.version}_x64-setup.exe")
    return 0


if __name__ == "__main__":
    sys.exit(main())

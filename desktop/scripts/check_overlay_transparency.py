"""验收：透明浮层窗口真的透明（否则会盖住整屏 → GUI 自动化黑屏）。

## 背景（真机事故）

光圈覆盖层 / 步进横幅 / 悬浮球这三个窗口由 Rust 侧用 `transparent(true)` 全屏创建，
但 `surface.html` 里 `html, body, #root { background: #050607 }` 让它们变成一块
**不透明黑板**。现象是：一进入 GUI 自动化，屏幕、截图、视觉验证全是纯 #050607；
而它看起来又"像正常的深色界面"，很难第一时间判断是被自己的浮层盖住了。

根因细节：`HaloOverlay.tsx` 原来只在 JS 里把 `html` 和 `body` 的背景置透明，
**漏了 `#root`**；而 `#root` 是 100%×100% 的元素，它不透明就等于整屏一块板。

## 本脚本检查什么

必须在浏览器里量 `getComputedStyle().backgroundColor`，因为真实级联有两处来源：
  1. `surface.html` 的内联 `<style>`
  2. `flux-surface.css` 的 `body.flux-aux #root { background:#050607 }`
     —— 而 `aux-main.jsx` 给所有 aux 窗口都加了 `flux-aux` 类

只看源码判断不了谁赢，所以这里把两份样式按真实顺序合并，再按 hash 路由实测：
  · `#/halo` `#/step` `#/orb`          → 必须是 rgba(0, 0, 0, 0)
  · `#/terminal` `#/markdown` `#/browser` → 必须保持 rgb(5, 6, 7)（不能被误伤）

用法：

    python desktop/scripts/check_overlay_transparency.py

找不到 Edge/Chrome 时跳过并返回 0（无 GUI 环境不假报警）。
"""

from __future__ import annotations

import argparse
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
DESKTOP = os.path.dirname(HERE)
SURFACE = os.path.join(DESKTOP, "surface.html")
FLUX_CSS = os.path.join(DESKTOP, "src", "auxiliary", "flux-surface.css")

BROWSER_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]

TRANSPARENT_ROUTES = ["halo", "step", "orb"]
OPAQUE_ROUTES = ["terminal", "markdown", "browser"]

PROBE = """
<script>
(function () {
  // 模拟 aux-main.jsx：所有 aux 窗口都会加这个类（正是它带来了会打架的背景规则）
  document.documentElement.classList.add('flux-aux');
  document.body.classList.add('flux-aux');
  function bg(el) { return el ? getComputedStyle(el).backgroundColor : 'MISSING'; }
  setTimeout(function () {
    document.title = 'PROBE:' + [
      bg(document.documentElement),
      bg(document.body),
      bg(document.getElementById('root')),
    ].join('|');
  }, 60);
})();
</script>
"""


def find_browser() -> str | None:
    for path in BROWSER_CANDIDATES:
        if os.path.isfile(path):
            return path
    for name in ("msedge", "chrome"):
        found = shutil.which(name)
        if found:
            return found
    return None


def build_probe_page() -> str:
    with io.open(SURFACE, "r", encoding="utf-8") as fh:
        html = fh.read()
    with io.open(FLUX_CSS, "r", encoding="utf-8") as fh:
        css = fh.read()
    # 真实顺序：surface.html 内联样式在前，模块 CSS（Vite 注入）在后
    html = html.replace("</head>", "<style>\n" + css + "\n</style>\n</head>", 1)
    html = html.replace("</body>", PROBE + "\n</body>", 1)
    path = os.path.join(tempfile.gettempdir(), "flux_overlay_probe.html")
    with io.open(path, "w", encoding="utf-8") as fh:
        fh.write(html)
    return path


def run(browser: str, page: str, route: str) -> list[str] | None:
    url = "file:///" + page.replace("\\", "/") + "#/" + route
    profile = tempfile.mkdtemp(prefix="flux_probe_")
    dump = os.path.join(tempfile.gettempdir(), f"flux_probe_{route}.html")
    try:
        with open(dump, "w", encoding="utf-8") as fh:
            subprocess.run(
                [
                    browser, "--headless=new", "--disable-gpu", "--no-sandbox",
                    f"--user-data-dir={profile}",
                    "--virtual-time-budget=3500", "--dump-dom", url,
                ],
                stdout=fh, stderr=subprocess.DEVNULL, timeout=120,
            )
        with io.open(dump, "r", encoding="utf-8", errors="replace") as fh:
            dom = fh.read()
        m = re.search(r"PROBE:([^<]*)<", dom)
        return m.group(1).split("|") if m else None
    finally:
        shutil.rmtree(profile, ignore_errors=True)
        try:
            os.remove(dump)
        except OSError:
            pass


def main() -> int:
    ap = argparse.ArgumentParser(description="验收透明浮层窗口的背景")
    ap.add_argument("--skip", action="store_true", help="跳过（无浏览器环境）")
    args = ap.parse_args()

    if args.skip:
        print("已按 --skip 跳过")
        return 0
    browser = find_browser()
    if not browser:
        print("未找到 Edge/Chrome，跳过（不算失败）")
        return 0

    page = build_probe_page()
    print("透明浮层验收 ·", SURFACE)
    fails = 0

    print("\n--- 透明浮层（三层都必须 rgba(0, 0, 0, 0)）")
    for route in TRANSPARENT_ROUTES:
        vals = run(browser, page, route)
        if not vals:
            print(f"  FAIL #/{route}: 拿不到测量结果")
            fails += 1
            continue
        bad = [v for v in vals if v != "rgba(0, 0, 0, 0)"]
        ok = not bad
        fails += 0 if ok else 1
        print(f"  {'OK  ' if ok else 'FAIL'} #/{route}: {', '.join(vals)}")

    print("\n--- 普通辅助窗口（必须保持不透明 rgb(5, 6, 7)，不能被误伤）")
    for route in OPAQUE_ROUTES:
        vals = run(browser, page, route)
        if not vals:
            print(f"  FAIL #/{route}: 拿不到测量结果")
            fails += 1
            continue
        bad = [v for v in vals if v != "rgb(5, 6, 7)"]
        ok = not bad
        fails += 0 if ok else 1
        print(f"  {'OK  ' if ok else 'FAIL'} #/{route}: {', '.join(vals)}")

    print("\n" + "=" * 56)
    if fails:
        print(f"结果：{fails} 项失败")
        print("提示：透明浮层不透明会让整屏变成 #050607 —— GUI 自动化截图全黑。")
        return 1
    print("结果：全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())

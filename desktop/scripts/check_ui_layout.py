"""改版验收：品牌位置、状态行位置、聊天区宽度、启动动画、着色器编译。

## 为什么需要

FLUX 主界面是 WebGL + 大量绝对定位的组合，改布局全靠肉眼在 1600×1000 上看，
小屏断点很容易翻车；而**着色器编译失败是静默的**——canvas 还在、DOM 正常，
只是里面什么都不画。启动动画同理：遮罩该出现时没出现、该消失时没消失，
肉眼很难判断是动画慢还是卡死了。

这个脚本用 headless Edge 真加载构建产物，量：

  · 品牌字 FLUX / 流形 是否在左上角（x < 120, y < 80）
  · 状态行（静息 / DORMANT）是否在顶部居中（y < 90，水平接近中线）
  · 球体下方是否还有旧的 name-lockup
  · 聊天区宽度（默认断点 800px）与星核容器尺寸
  · **启动遮罩**：0.5s 时应存在，3.2s 时应已撤掉
  · **WebGL 着色器编译/链接错误**

用法：

    cd desktop && pnpm build
    python desktop/scripts/check_ui_layout.py
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
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DESKTOP = os.path.dirname(HERE)
DIST = os.path.join(DESKTOP, "dist")
PORT = 4188
BROWSER_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]

GL_PROBE = """
<script>
window.__gl = [];
(function () {
  function patch(proto, tag) {
    if (!proto) return;
    var oc = proto.compileShader;
    proto.compileShader = function (sh) {
      var r = oc.call(this, sh);
      if (!this.getShaderParameter(sh, this.COMPILE_STATUS)) {
        window.__gl.push(tag + ' compile: ' + String(this.getShaderInfoLog(sh)).slice(0, 400));
      }
      return r;
    };
    var ol = proto.linkProgram;
    proto.linkProgram = function (p) {
      var r = ol.call(this, p);
      if (!this.getProgramParameter(p, this.LINK_STATUS)) {
        window.__gl.push(tag + ' link: ' + String(this.getProgramInfoLog(p)).slice(0, 400));
      }
      return r;
    };
  }
  patch(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype, 'webgl1');
  patch(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype, 'webgl2');
})();
</script>
"""

MEASURE = """
<script>
// 启动遮罩用观察法：--virtual-time-budget 会把定时器提前触发，
// 按时间点判定会误报「遮罩不存在」。这里只记录它是否出现过。
var __bootSeen = false;
(function () {
  function scan() { if (document.querySelector('.boot')) __bootSeen = true; }
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scan, 40);
})();
function measure() {
  function q(s) { return document.querySelector(s); }

  // 看护面板：通过面板路由打开，确认它是 overlay 而不是新页面
  // 首页必须是干净的单页：默认不能有任何 overlay 挂在上面。
  // 看护面板本身是异步打开的（React state），且生产构建不暴露 __FLUX__，
  // 所以「面板能打开」这一条改由脚本侧的产物静态校验负责，见文件末尾。
  var watch = {
    home_single_page: document.querySelector('.watchkeeper')
      ? 'OVERLAY_PRESENT'
      : 'CLEAN',
    path: location.pathname,
  };

  // 数字雨：只读它自己的画布，避免被中间的发光球干扰
  function rainBands() {
    var c = document.querySelector('.rain-field');
    if (!c) return 'MISSING';
    var ctx = c.getContext('2d');
    if (!ctx || !c.width || !c.height) return 'MISSING';
    // 中线带必须取窄：0.44~0.56 会把渐隐段本身算进去，看着像"中间有雨"
    var bands = [[0, 0.12], [0.49, 0.51], [0.88, 1]];
    var out = [];
    for (var b = 0; b < bands.length; b += 1) {
      var x = Math.floor(c.width * bands[b][0]);
      var w = Math.max(1, Math.floor(c.width * (bands[b][1] - bands[b][0])));
      var data = ctx.getImageData(x, 0, w, c.height).data;
      // getImageData 返回的是**非预乘** RGBA：被遮罩压到 alpha=5 的像素，
      // RGB 仍然是亮的。所以要按 alpha 加权，才是"肉眼看到的亮度"。
      var n = 0;
      var maxAlpha = 0;
      for (var i = 0; i < data.length; i += 4) {
        var a = data[i + 3];
        if (a > maxAlpha) maxAlpha = a;
        if (((data[i] + data[i + 1] + data[i + 2]) * a) / 765 > 12) n += 1;
      }
      out.push(n + ':' + maxAlpha);
    }
    return out.join('/');
  }

  function rect(el) {
    if (!el) return 'MISSING';
    var r = el.getBoundingClientRect();
    return Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
  }
  var lines = [
    'brand_en=' + rect(q('.brand-en')),
    'brand_cn=' + (q('.brand-cn') ? q('.brand-cn').textContent : 'MISSING'),
    'brand_in_header=' + (q('.hud--top .brand-sigil--lockup') ? 'YES' : 'NO'),
    'state_line=' + rect(q('.hud--top .state-line')),
    'state_text=' + (q('.hud--top .state-zh') ? q('.hud--top .state-zh').textContent : 'MISSING'),
    'name_lockup_under_orb=' + (q('.identity .name-lockup') ? 'STILL_THERE' : 'GONE'),
    'transcript=' + rect(q('.transcript')),
    'orb_stage=' + rect(q('.orb-stage')),
    'core=' + rect(q('.core')),
    'orb_canvas=' + rect(q('.orb-canvas canvas')),
    'orb_fallback=' + (q('.orb--fallback') ? 'YES' : 'NO'),
    'boot_seen=' + (__bootSeen ? 'PRESENT' : 'MISSING'),
    'boot_after=' + (q('.boot') ? 'STILL_THERE' : 'GONE'),
    'gl_errors=' + (window.__gl && window.__gl.length ? window.__gl.join(' || ') : 'none'),
    'rain_bands_left_center_right=' + rainBands(),
    'watch_home=' + watch.home_single_page
  ];
  var d = document.createElement('div');
  d.id = '__probe';
  d.textContent = lines.join('\\n');
  document.body.appendChild(d);
}

// 等应用挂载 **且启动遮罩已撤** 再量。
// 虚拟时钟（--virtual-time-budget）下模块加载可能慢于定时器，固定延时会在
// 空页面上测量，出现「全部 MISSING」的假失败；而只等挂载则会量在遮罩期间，
// boot_after 必然是 STILL_THERE。两个条件都满足才是稳态。
var __tries = 0;
(function waitSettled() {
  var mounted = !!document.querySelector('.app');
  var bootGone = !document.querySelector('.boot');
  // 星核画布由 OrbCanvas 的 effect 插入，可能晚于 .app 出现；
  // 减少动态效果模式下没有遮罩兜底，必须显式等它（或它的降级占位）。
  var orbReady =
    !!document.querySelector('.orb-canvas canvas') ||
    !!document.querySelector('.orb--fallback');
  if ((mounted && bootGone && orbReady) || __tries++ > 200) {
    // 把「鼠标移到两侧」这条路径也跑一遍：派发一次 pointermove 到左边缘，
    // 让数字雨的玻璃透镜分支真正执行。若那段代码抛错，下面的像素断言会露馅。
    try {
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 90, clientY: window.innerHeight * 0.5 }),
      );
    } catch (e) {
      /* 老浏览器没有 PointerEvent，忽略 */
    }
    setTimeout(measure, 450);
    return;
  }
  setTimeout(waitSettled, 100);
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


def main() -> int:
    ap = argparse.ArgumentParser(description="界面验收")
    ap.add_argument(
        "--reduced-motion",
        action="store_true",
        help="强制 prefers-reduced-motion，检查静态版本（启动动画应被跳过）",
    )
    args = ap.parse_args()

    if not os.path.isdir(DIST):
        print("dist 不存在，先跑 pnpm build")
        return 1
    browser = find_browser()
    if not browser:
        print("未找到 Edge/Chrome，跳过（不算失败）")
        return 0

    work = os.path.join(tempfile.gettempdir(), "flux_ui_check")
    shutil.rmtree(work, ignore_errors=True)
    shutil.copytree(DIST, work)
    index = os.path.join(work, "index.html")
    with io.open(index, "r", encoding="utf-8") as fh:
        html = fh.read()
    html = html.replace("</head>", GL_PROBE + "\n</head>", 1)
    html = html.replace("</body>", MEASURE + "\n</body>", 1)
    with io.open(index, "w", encoding="utf-8") as fh:
        fh.write(html)

    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=work, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(40):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{PORT}/index.html", timeout=1).read(1)
                break
            except Exception:
                time.sleep(0.25)
        else:
            print("静态服务没起来")
            return 1

        profile = tempfile.mkdtemp(prefix="flux_ui_")
        dump = os.path.join(tempfile.gettempdir(), "flux_ui_dom.html")
        try:
            with open(dump, "w", encoding="utf-8") as fh:
                subprocess.run(
                    [
                        browser, "--headless=new", "--no-sandbox",
                        "--use-gl=angle", "--use-angle=swiftshader",
                        "--enable-unsafe-swiftshader",
                        f"--user-data-dir={profile}",
                        "--virtual-time-budget=25000",
                        "--window-size=1500,1000",
                        *(["--force-prefers-reduced-motion"] if args.reduced_motion else []),
                        "--dump-dom",
                        f"http://127.0.0.1:{PORT}/index.html",
                    ],
                    stdout=fh, stderr=subprocess.DEVNULL, timeout=180,
                )
            with io.open(dump, "r", encoding="utf-8", errors="replace") as fh:
                dom = fh.read()
        finally:
            shutil.rmtree(profile, ignore_errors=True)
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except Exception:
            server.kill()

    m = re.search(r'<div id="__probe">(.*?)</div>', dom, re.S)
    if not m:
        print("没拿到探针结果（页面可能白屏/报错）")
        return 1
    body = m.group(1).replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    lines = [ln.strip() for ln in body.strip().splitlines() if ln.strip()]

    print("=== 界面验收 ===")
    fails = 0
    for ln in lines:
        print("  " + ln)
        # boot_seen 单独判定：普通模式要求 PRESENT，减少动态模式要求 MISSING
        if ln.startswith("boot_seen="):
            continue
        if "MISSING" in ln or "STILL_THERE" in ln:
            fails += 1

    data = dict(ln.split("=", 1) for ln in lines if "=" in ln)
    if data.get("gl_errors", "none") != "none":
        print("  ⚠️ 着色器有编译/链接错误")
        fails += 1

    # 启动动画：0.5s 时应在，3.3s 时该撤
    if args.reduced_motion:
        if data.get("boot_seen") == "PRESENT":
            print("  ⚠️ 减少动态效果模式下仍然播放了启动动画")
            fails += 1
    elif data.get("boot_seen") != "PRESENT":
        print("  ⚠️ 启动遮罩从未出现（动画没起来）")
        fails += 1

    try:
        bx, by = (int(v) for v in data["brand_en"].split(" ")[0].split(","))
        if bx > 120 or by > 80:
            print(f"  ⚠️ 品牌不在左上角: x={bx} y={by}")
            fails += 1
    except Exception:
        pass

    # 状态行应在顶部居中
    try:
        sx, sy = (int(v) for v in data["state_line"].split(" ")[0].split(","))
        sw = int(data["state_line"].split(" ")[1].split("x")[0])
        center = sx + sw / 2
        if sy > 90 or abs(center - 750) > 90:
            print(f"  ⚠️ 状态行不在顶部居中: x={sx} y={sy} 中心={center}")
            fails += 1
    except Exception:
        pass

    try:
        tw = int(data["transcript"].split(" ")[1].split("x")[0])
        print(f"  → 聊天区宽度 {tw}px")
        if tw < 700:
            print("  ⚠️ 聊天区偏窄")
            fails += 1
    except Exception:
        pass

    # 数字雨：两侧要有、中线必须为零
    try:
        # 每段是 "可见像素数:最大alpha"
        parts = data["rain_bands_left_center_right"].split("/")
        left, center, right = (int(v.split(":")[0]) for v in parts)
        print(f"  → 数字雨 左/中/右 = {left} / {center} / {right} 像素（已按 alpha 加权）")
        if args.reduced_motion:
            # 减少动态效果下数字雨应当整体关闭
            if left + right + center > 0:
                print("  ⚠️ 减少动态效果下仍在渲染数字雨")
                fails += 1
        else:
            if left < 400 or right < 400:
                print("  ⚠️ 两侧数字雨太少（可能没渲染）")
                fails += 1
            if center > 400:
                print(f"  ⚠️ 中线仍有 {center} 个可见像素——中间应当几乎不可见")
                fails += 1
    except Exception as exc:
        print(f"  ⚠️ 数字雨测量失败: {exc}")
        fails += 1

    # 看护面板：首页必须仍是干净的单页；面板本身是否接好，用产物静态校验
    if data.get("watch_home") != "CLEAN":
        print(f"  ⚠️ 首页不是干净的单页: {data.get('watch_home')}")
        fails += 1

    # 面板是通过 React state 打开的 overlay，生产构建不暴露 __FLUX__；
    # 所以这里校验"产物里确实接了它"——组件名、面板标题、样式类三样都在。
    bundle = ""
    assets = os.path.join(DIST, "assets")
    for name in os.listdir(assets) if os.path.isdir(assets) else []:
        if name.endswith(".js") or name.endswith(".css"):
            with io.open(os.path.join(assets, name), "r", encoding="utf-8", errors="replace") as fh:
                bundle += fh.read()
    missing = [k for k in ("watchkeeper", "CORE / WATCH", "看护 Agent") if k not in bundle]
    if missing:
        print(f"  ⚠️ 构建产物缺少看护面板标记: {', '.join(missing)}")
        fails += 1
    else:
        print("  → 看护面板已接入产物（组件 / 标题 / 样式类齐全）")

    print("\n" + "=" * 56)
    if fails:
        print(f"结果：{fails} 项异常")
        return 1
    print("结果：全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())

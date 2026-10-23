#!/usr/bin/env node
// browser.rs 三段定位脚本的穿透回归检查（Shadow DOM / 同源 iframe）。
//
// 从 src-tauri/src/browser.rs 提取 FIND_BY_TEXT_JS / SCAN_JS / MARK_SELECTOR_JS
// 与 PIERCE_HELPERS_JS 的原文，按 Rust 侧相同的占位符规则拼装，注入一台临时启动的
// 无头 Chrome/Edge（CDP），对含 shadow DOM 与同源 iframe 的夹具页做真实断言——
// 包括用 CDP 输入事件真正点一下 iframe 内的按钮，验证换算出的顶层坐标确实可点。
//
// 用法：node check_browser_pierce.mjs [--browser "C:\path\to\chrome.exe"]
// 退出码 0 = 全部通过；1 = 有失败（会逐条打印 ✓/✗）。

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BROWSER_RS = join(here, '..', 'src-tauri', 'src', 'browser.rs');

// ── 1. 从 Rust 源码提取脚本原文 ────────────────────────────────────────────
const src = readFileSync(BROWSER_RS, 'utf8');
function extract(name) {
  const m = src.match(new RegExp(`const ${name}: &str = r#"([\\s\\S]*?)"#;`));
  if (!m) throw new Error(`browser.rs 里找不到 ${name}`);
  return m[1];
}
const FIND = extract('FIND_BY_TEXT_JS');
const SCAN = extract('SCAN_JS');
const MARK = extract('MARK_SELECTOR_JS');
const STYLE_FN = extract('MARK_STYLE_FN');
const CSS_PATH = extract('CSS_PATH_FN');
const PIERCE = extract('PIERCE_HELPERS_JS');

const replaceAll = (s, a, b) => s.split(a).join(b);
function findScript(target) {
  let js = FIND;
  js = replaceAll(js, '__BAIZE_STYLE__', '');
  js = replaceAll(js, '__BAIZE_MARK__', 'false');
  js = replaceAll(js, '__BAIZE_HOLD__', '0');
  js = replaceAll(js, '__BAIZE_CSSPATH__', CSS_PATH);
  js = replaceAll(js, '__BAIZE_DEEP__', PIERCE);
  js = replaceAll(js, '__BAIZE_TARGET__', JSON.stringify(target));
  return js;
}
const scanScript = () => replaceAll(
  replaceAll(replaceAll(replaceAll(SCAN, '__BAIZE_SCOPE__', 'null'),
    '__BAIZE_LIMIT__', '60'), '__BAIZE_HOLD__', '8000'), '__BAIZE_DEEP__', PIERCE);
function markScript(sel) {
  let js = MARK;
  js = replaceAll(js, '__BAIZE_STYLE__', replaceAll(STYLE_FN, '__BAIZE_ID__', '__baize_mark__'));
  js = replaceAll(js, '__BAIZE_SEL__', JSON.stringify(sel));
  js = replaceAll(js, '__BAIZE_HOLD__', '1200');
  js = replaceAll(js, '__BAIZE_DEEP__', PIERCE);
  return js;
}

// ── 2. 夹具：shadow DOM + 同源 iframe（iframe 里再套一层 shadow DOM） ─────
const MAIN_HTML = `<!doctype html><meta charset="utf-8">
<style>body{margin:0}#frame{width:420px;height:300px;border:4px solid #333;padding:8px;margin-top:10px}</style>
<button id="plain" onclick="window.__clickedPlain=true">普通按钮</button>
<div id="host"></div>
<script>
  document.getElementById('host').attachShadow({mode:'open'}).innerHTML='<button id="sb">影子按钮</button>';
  document.getElementById('host').shadowRoot.getElementById('sb').onclick=function(){window.parent.__clickedShadow=true;};
</script>
<iframe id="frame" src="/inner"></iframe>`;
const INNER_HTML = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:0}</style>
<button id="fb" style="margin-top:20px">框架按钮</button>
<div id="host2"></div>
<script>
  document.getElementById('host2').attachShadow({mode:'open'}).innerHTML='<button id="nb">嵌套按钮</button>';
  document.getElementById('fb').onclick=function(){window.parent.__frameClicked=true;};
</script>`;

// ── 3. 迷你 HTTP 服务（file:// 下 iframe 是跨源的，必须走 http 同源） ──────
async function serve() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.url.startsWith('/inner') ? INNER_HTML : MAIN_HTML);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

// ── 4. 无头浏览器 + CDP ──────────────────────────────────────────────────
function findBrowser() {
  const argIdx = process.argv.indexOf('--browser');
  if (argIdx > 0) return process.argv[argIdx + 1];
  const cands = [
    process.env.FLUX_PIERCE_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  for (const c of cands) if (existsSync(c)) return c;
  throw new Error('找不到 Chrome/Edge，可用 --browser 指定路径');
}

async function launchBrowser() {
  const exe = findBrowser();
  const profile = mkdtempSync(join(tmpdir(), 'baize-pierce-'));
  const child = spawn(exe, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--window-size=1280,900',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let acc = '';
    const timer = setTimeout(() => reject(new Error('30s 内没等到 DevTools 端口')), 30000);
    const onData = (d) => {
      acc += d.toString();
      const m = acc.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    };
    child.stderr.on('data', onData);
    child.on('exit', (c) => { clearTimeout(timer); reject(new Error(`浏览器提前退出(${c})：${acc.slice(-400)}`)); });
  });
  // browser WS → 找 page target（Node 24 内置 WebSocket）
  const pageId = await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Target.getTargets', params: {} }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) {
        const page = msg.result.targetInfos.find((t) => t.type === 'page');
        ws.close();
        page ? resolve(page.targetId) : reject(new Error('没有 page target'));
      }
    };
    ws.onerror = (e) => reject(new Error('browser WS 失败: ' + e.message));
  });
  const targets = await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/list`).then((r) => r.json());
  const page = targets.find((t) => t.type === 'page' && t.id === pageId) ?? targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('page WS 失败')); });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页面脚本异常: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  };
  return { child, profile, ws, send, evaluate };
}

// ── 5. 断言执行 ──────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail && !ok ? ` —— ${detail}` : ''}`);
  ok ? pass++ : fail++;
}
const parse = (s) => (s === 'null' || s == null ? null : JSON.parse(s));

async function main() {
  const { server, url } = await serve();
  const B = await launchBrowser();
  try {
    await B.send('Page.enable');
    await B.send('Runtime.enable');
    await B.send('Page.navigate', { url });
    // 等主文档 + iframe 都就绪
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const ready = await B.evaluate(`(function(){try{return document.readyState==='complete'&&!!document.getElementById('frame').contentDocument.getElementById('fb');}catch(e){return false;}})()`);
      if (ready) break;
    }

    // ── FIND_BY_TEXT ──
    const plain = parse(await B.evaluate(findScript('普通按钮')));
    check('普通按钮：顶层 DOM 命中', plain && plain.tag === 'button' && plain.sel.length > 0, JSON.stringify(plain));
    const shadow = parse(await B.evaluate(findScript('影子按钮')));
    check('影子按钮：shadow DOM 命中', shadow && shadow.tag === 'button', JSON.stringify(shadow));
    check('影子按钮：穿透元素返回空 sel（跳过定位缓存）', shadow && shadow.sel === '', `sel=${shadow && shadow.sel}`);
    const frame = parse(await B.evaluate(findScript('框架按钮')));
    check('框架按钮：同源 iframe 命中', frame && frame.tag === 'button', JSON.stringify(frame));
    const iframeTop = await B.evaluate(`document.getElementById('frame').getBoundingClientRect().top + 4 + 8 + 20`);
    check('框架按钮：坐标换算到顶层视口（含边框/内边距偏移）', frame && Math.abs(frame.y - iframeTop) < 3, `y=${frame && frame.y}, 期望≈${iframeTop}`);
    const nested = parse(await B.evaluate(findScript('嵌套按钮')));
    check('嵌套按钮：iframe 内 shadow DOM 命中', nested && nested.tag === 'button', JSON.stringify(nested));
    const miss = await B.evaluate(findScript('不存在的按钮'));
    check('不存在的目标：返回 null', miss === 'null', String(miss));

    // ── SCAN + click_mark ──
    const scan = parse(await B.evaluate(scanScript()));
    const texts = (scan?.items ?? []).map((i) => i.text);
    check('scan：三种位置的可交互元素全部枚举', ['普通按钮', '影子按钮', '框架按钮', '嵌套按钮'].every((t) => texts.includes(t)), JSON.stringify(texts));
    const frameItem = scan?.items.find((i) => i.text === '框架按钮');
    check('scan：iframe 元素坐标已换算', frameItem && Math.abs(frameItem.y - iframeTop) < 3, JSON.stringify(frameItem));
    const markedDeep = await B.evaluate(`(function(){
      var probe=function(root){var e=root.querySelector('[data-baize-mark]');if(e)return e;var all=root.querySelectorAll('*');for(var i=0;i<all.length;i++){var sr=all[i].shadowRoot;if(sr){var r=probe(sr);if(r)return r;}}return null;};
      var d=document.getElementById('frame').contentDocument;
      return !!(probe(document)||probe(d));})()`);
    check('scan：data-baize-mark 写进了内层元素（含 shadow）', !!markedDeep);

    const rect = parse(await B.evaluate(markScript(`[data-baize-mark="${frameItem?.n}"]`)));
    check('click_mark：按编号从 iframe 里找回元素并返回顶层矩形', rect && Math.abs(rect[1] - iframeTop) < 3, JSON.stringify(rect));
    const bogus = await B.evaluate(markScript('[data-baize-mark="999"]'));
    check('click_mark：失效编号返回 null', bogus === 'null', String(bogus));

    // ── 真实点击（CDP 输入事件，落在换算后的顶层坐标） ──
    async function realClick(rectArr) {
      const [x, y, w, h] = rectArr, cx = x + w / 2, cy = y + h / 2;
      const ev = (type) => ({ type, x: cx, y: cy, button: 'left', clickCount: 1 });
      await B.send('Input.dispatchMouseEvent', { ...ev('mouseMoved') });
      await B.send('Input.dispatchMouseEvent', { ...ev('mousePressed'), buttons: 1 });
      await B.send('Input.dispatchMouseEvent', { ...ev('mouseReleased'), buttons: 1 });
    }
    await realClick(rect);
    await new Promise((r) => setTimeout(r, 300));
    check('真实点击：iframe 内按钮收到事件（坐标换算正确）',
      await B.evaluate('window.__frameClicked===true'));
    const srect = parse(await B.evaluate(markScript('#sb'))); // shadow 元素用普通选择器也能穿透找到
    if (srect) { await realClick(srect); await new Promise((r) => setTimeout(r, 300)); }
    check('真实点击：shadow DOM 内按钮收到事件',
      await B.evaluate('window.__clickedShadow===true'));
  } finally {
    try { B.ws.close(); } catch {}
    try { B.child.kill(); } catch {}
    try { rmSync(B.profile, { recursive: true, force: true }); } catch {}
    server.close();
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('检查脚本失败:', e.message); process.exit(1); });

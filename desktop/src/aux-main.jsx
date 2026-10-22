import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/fraunces';
import './auxiliary/baize.css';
import './auxiliary/flux-surface.css';
import { installAudioUnlock } from './engine/utils/sound';
import { installUiFeedback } from './uiFeedback';

document.documentElement.classList.add('flux-aux');
document.body.classList.add('flux-aux');

// 辅助窗口也是独立 WebView：同样要在用户第一次点/按键时解锁 AudioContext，
// 否则任务完成、卡片到达这些异步音效会被自动播放策略静默拦掉。
installAudioUnlock();
installUiFeedback();

const BrowserWindow = lazy(() => import('./auxiliary/components/BrowserWindow'));
const MarkdownWindow = lazy(() => import('./auxiliary/components/MarkdownWindow'));
const TerminalWindow = lazy(() => import('./auxiliary/components/TerminalWindow'));
const StepBarrage = lazy(() => import('./auxiliary/components/StepBarrage'));
const HaloOverlay = lazy(() => import('./auxiliary/components/HaloOverlay'));
const OrbFloat = lazy(() => import('./auxiliary/components/OrbFloat'));

const hash = window.location.hash;
let Surface = BrowserWindow;

if (hash.startsWith('#/browser')) Surface = BrowserWindow;
else if (hash.startsWith('#/markdown')) Surface = MarkdownWindow;
else if (hash.startsWith('#/terminal')) Surface = TerminalWindow;
else if (hash.startsWith('#/step')) Surface = StepBarrage;
else if (hash.startsWith('#/halo')) Surface = HaloOverlay;
else if (hash.startsWith('#/orb')) Surface = OrbFloat;

// The Baize tool windows run on the same Rust engine. They keep their native
// tool chrome (browser / document / terminal / desktop takeover) while the
// primary FLUX surface stays single-page.
ReactDOM.createRoot(document.getElementById('root')).render(
  <Suspense
    fallback={
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          color: '#747f86',
          fontFamily: 'JetBrains Mono, Consolas, monospace',
          fontSize: 11,
          letterSpacing: '0.16em',
        }}
      >
        FLUX / LINKING TOOL SURFACE…
      </div>
    }
  >
    <Surface />
  </Suspense>,
);

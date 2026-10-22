import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/fraunces';
import './styles.css';
import { App } from './App';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { installUiFeedback } from './uiFeedback';

installUiFeedback();

const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

/**
 * Last line of defence for the single-window shell. A render exception used to
 * leave an unresponsive black WebView; here the user gets the core identity and
 * a reload action instead of a silent disappearance.
 */
class CoreBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[FLUX core] render fault', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#050607',
          color: '#d8e0db',
          fontFamily: 'Manrope, sans-serif',
          padding: '48px',
        }}
      >
        <div style={{ maxWidth: '520px' }}>
          <div
            style={{
              color: '#7f9394',
              fontSize: '10px',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
            }}
          >
            FLUX / CORE RECOVERY
          </div>
          <h1
            style={{
              margin: '18px 0 12px',
              fontFamily: 'Fraunces, serif',
              fontSize: '40px',
              fontWeight: 300,
              lineHeight: 1.05,
            }}
          >
            Core interrupted.
          </h1>
          <p style={{ color: '#9aa8a4', fontSize: '14px', lineHeight: 1.7 }}>
            界面遇到未处理的异常，引擎数据没有被删除。重新载入即可回到核心。
          </p>
          <pre
            style={{
              margin: '18px 0 22px',
              padding: '12px',
              maxHeight: '160px',
              overflow: 'auto',
              border: '1px solid rgba(190,216,216,.14)',
              color: '#8b9b98',
              fontSize: '11px',
              whiteSpace: 'pre-wrap',
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '11px 18px',
              border: '1px solid rgba(210,230,226,.26)',
              background: 'rgba(210,230,226,.06)',
              color: '#e2e4db',
              letterSpacing: '0.08em',
              cursor: 'pointer',
            }}
          >
            重新载入 / RELOAD
          </button>
        </div>
      </div>
    );
  }
}

// Baize's capability engine opens dedicated tool windows for the controlled
// browser, documents, terminal and desktop takeover. Route those windows to
// their functional surfaces; the primary window remains the single FLUX page.
const hash = window.location.hash;
const isAuxWindow = /^#\/(browser|markdown|terminal|step|halo|orb)/.test(hash);

function showDesktopWindow() {
  if (!isTauri) return;
  const win = getCurrentWindow();
  // Wait for two frames so the first WebView paint is already dark before the
  // undecorated window becomes visible.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void win.show().catch(() => undefined);
      void win.setFocus().catch(() => undefined);
    });
  });
}

if (isAuxWindow) {
  window.location.replace(`/surface.html${hash}`);
} else {
  showDesktopWindow();
  // This desktop shell owns side-effectful engine listeners (Tauri events,
  // microphone, SQLite conversation). StrictMode's development double-mount
  // would attach and detach the engine bridge twice, so keep a single mount.
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <CoreBoundary>
      <App />
    </CoreBoundary>,
  );
}

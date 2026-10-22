import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

export function WindowChrome() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    document.documentElement.dataset.tauri = 'true';
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized).catch(() => undefined);
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized).catch(() => undefined);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, []);

  if (!isTauri) return null;

  const win = getCurrentWindow();

  return (
    <>
      <div className="titlebar-drag" data-tauri-drag-region aria-hidden="true" />
      <div className="window-chrome">
        <button
          className="window-control"
          type="button"
          aria-label="最小化"
          onClick={(event) => {
            event.stopPropagation();
            void win.minimize();
          }}
        >
          <span className="window-glyph window-glyph--min" />
        </button>
        <button
          className="window-control"
          type="button"
          aria-label={maximized ? '还原' : '最大化'}
          onClick={(event) => {
            event.stopPropagation();
            void win.toggleMaximize();
          }}
        >
          <span className={`window-glyph ${maximized ? 'window-glyph--restore' : 'window-glyph--max'}`} />
        </button>
        <button
          className="window-control window-control--close"
          type="button"
          aria-label="关闭"
          onClick={(event) => {
            event.stopPropagation();
            void win.close();
          }}
        >
          <span className="window-glyph window-glyph--close" />
        </button>
      </div>
    </>
  );
}

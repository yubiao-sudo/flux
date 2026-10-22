import { RotateCcw, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { restartFlux } from '../../engine/api';
import './lenses.css';

type Props = {
  id: 'chronicle' | 'atlas' | 'dossier';
  mark: string;
  title: string;
  sub: string;
  meta?: ReactNode;
  onClose: () => void;
  children: ReactNode;
};

/**
 * FLUX 的大面板公共外壳：一条发丝顶栏 + 全屏内容面。
 * 三个新面板共享它，但各自在 `.lens-body` 里保留自己的视觉语言。
 */
export function SurfaceFrame({ id, mark, title, sub, meta, onClose, children }: Props) {
  return (
    <section className={`lens-shell lens-shell--${id}`} aria-label={title}>
      <header className="lens-topbar">
        <div className="lens-brand">
          <span className="lens-mark">{mark}</span>
          <div>
            <strong>{title}</strong>
            <small>{sub}</small>
          </div>
        </div>
        <div className="lens-meta">
          {meta}
          <button
            type="button"
            className="lens-close"
            onClick={() => {
              void restartFlux().catch(() => undefined);
            }}
            title="重启 FLUX"
          >
            <RotateCcw size={14} />
          </button>
          <button type="button" className="lens-close" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="lens-body">{children}</div>
    </section>
  );
}

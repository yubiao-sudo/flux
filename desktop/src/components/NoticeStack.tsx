import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { FluxNotice } from '../engine/useFluxEngine';
import { playSfx } from '../engine/utils/sound';

/**
 * 通知音用 FLUX 自己那套 signal 玻璃音（与右侧 SIGNAL rail 配套），
 * 不是白泽旧音色。
 *
 * 早期 fluxSignal 自己 new 了一个 AudioContext：它在通知到达的异步回调里
 * 才第一次创建，错过了用户手势，WebView2 会把它一直挂在 suspended，音符全部静音。
 * 现在音色搬进 sound.ts 的共享音频链，借用同一套 gesture unlock / 队列 / 音量，
 * 通知到达时就能正常出声。
 */
const TONE_SFX: Record<
  FluxNotice['tone'],
  'signal-info' | 'signal-attention' | 'signal-critical'
> = {
  info: 'signal-info',
  attention: 'signal-attention',
  critical: 'signal-critical',
};

type Props = {
  notices: FluxNotice[];
  onDismiss: (id: string) => void;
};

const LEVEL_LABEL: Record<FluxNotice['tone'], string> = {
  info: 'SIGNAL / INFO',
  attention: 'SIGNAL / ATTENTION',
  critical: 'SIGNAL / CRITICAL',
};

export function NoticeStack({ notices, onDismiss }: Props) {
  const heard = useRef(new Set<string>());

  useEffect(() => {
    for (const notice of notices) {
      if (heard.current.has(notice.id)) continue;
      heard.current.add(notice.id);
      playSfx(TONE_SFX[notice.tone]);
    }
  }, [notices]);

  useEffect(() => {
    const timers = notices
      .filter((notice) => !notice.persistent)
      .map((notice) =>
        window.setTimeout(
          () => onDismiss(notice.id),
          notice.tone === 'info' ? 5200 : 7600,
        ),
      );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [notices, onDismiss]);

  return (
    <div className="notices" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {notices.slice(-3).map((notice) => (
          <motion.article
            key={notice.id}
            className={`notice notice--${notice.tone}`}
            role={notice.tone === 'critical' ? 'alert' : 'status'}
            initial={{ opacity: 0, y: -12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="notice-rail" aria-hidden="true" />
            <div className="notice-body">
              <header>
                <span>{LEVEL_LABEL[notice.tone]}</span>
                <span className="notice-time">
                  {new Date(notice.at).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                </span>
              </header>
              <strong>{notice.title}</strong>
              {notice.body && <p>{notice.body}</p>}
              {notice.detail && notice.detail !== notice.body && (
                <p className="notice-detail">{notice.detail}</p>
              )}
              {notice.persistent && <span className="notice-mark">等待回应</span>}
            </div>
            <button type="button" onClick={() => onDismiss(notice.id)} aria-label="关闭通知">
              ×
            </button>
          </motion.article>
        ))}
      </AnimatePresence>
    </div>
  );
}

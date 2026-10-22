import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Turn } from '../types';
import { Markdown } from './Markdown';

type Props = {
  turns: Turn[];
  thinking: boolean;
  docked: boolean;
  streaming?: string;
  thinkingText?: string;
  /**
   * 让某条**已落地**的消息只显示前 chars 个字。
   *
   * 为什么不在 streaming 里做就行：回复生成完就会从流式缓冲落进 turns，
   * 而语音往往还要读十几秒。只切 streaming 的话，落地那一刻整段文字就
   * 一次出现了 —— 看起来就是"字先说完了，声音才来"。
   */
  revealTurn?: { id: string; chars: number } | null;
};

export function Transcript({
  turns,
  thinking,
  docked,
  streaming = '',
  thinkingText,
  revealTurn = null,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [fades, setFades] = useState({ top: 0, bottom: 0 });
  const [hasOverflow, setHasOverflow] = useState(false);

  const measure = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const overflow = el.scrollHeight > el.clientHeight + 3;
    setHasOverflow(overflow);
    const atTop = el.scrollTop <= 3;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 5;
    setFades({
      top: overflow && !atTop ? (docked ? 18 : 28) : 0,
      bottom: overflow && !atBottom ? (docked ? 22 : 34) : 0,
    });
  }, [docked]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    // Keep the newest line glued to the bottom while the dock transition
    // reflows the column. Without this, a width/height transition can leave
    // the final reply under the bottom fade.
    el.scrollTop = el.scrollHeight;
    const started = performance.now();
    let frame = 0;

    const follow = (now: number) => {
      if (!viewportRef.current) return;
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
      if (now - started < 1350) {
        frame = requestAnimationFrame(follow);
      } else {
        measure();
      }
    };

    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [turns.length, thinking, streaming.length, revealTurn?.chars, docked, measure]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const maskStyle = {
    '--fade-top': `${fades.top}px`,
    '--fade-bottom': `${fades.bottom}px`,
  } as React.CSSProperties;

  return (
    <div
      className={`transcript ${hasOverflow ? 'transcript--overflow' : ''}`}
      style={maskStyle}
      aria-live="polite"
      aria-label="对话记录"
    >
      <div className="transcript-viewport" ref={viewportRef} onScroll={measure}>
        <div className="transcript-inner">
          <div className="transcript-index">
            <span>TRANSCRIPT</span>
            <i />
            <span>LIVE SESSION</span>
          </div>
          {turns.map((turn, index) => {
            // 正在「跟读」的那条：只放出前 chars 个字
            const revealing = revealTurn?.id === turn.id;
            const text = revealing ? turn.text.slice(0, revealTurn!.chars) : turn.text;
            return (
              <article
                className={`turn turn--${turn.role}${revealing ? ' is-revealing' : ''}`}
                key={turn.id}
                style={{ '--turn-index': Math.min(index, 6) } as React.CSSProperties}
              >
                <div className="turn-meta">
                  <span className="turn-role">{turn.role === 'agent' ? 'FLUX' : 'YOU'}</span>
                  <span className="turn-time">
                    {new Date(turn.at).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </span>
                </div>
                {turn.role === 'agent' ? <Markdown text={text} /> : <p>{text}</p>}
              </article>
            );
          })}
          {streaming && (
            <article className="turn turn--agent turn--streaming" aria-live="polite">
              <div className="turn-meta">
                <span className="turn-role">FLUX</span>
                <span className="turn-time">STREAM</span>
              </div>
              <Markdown text={streaming} cursor />
            </article>
          )}
          <AnimatePresence>
            {thinking && !streaming && (
              <motion.div
                className="thought-line"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <span className="thought-glyph">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="thought-text">
                  {thinkingText ? thinkingText : '正在把信息折叠成答案'}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

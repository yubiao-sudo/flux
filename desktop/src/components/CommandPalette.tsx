import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';

export type PaletteAction = {
  id: string;
  label: string;
  detail: string;
  run: () => void;
};

type Props = {
  actions: PaletteAction[];
  onClose: () => void;
};

export function CommandPalette({ actions, onClose }: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter(
      (action) =>
        action.label.toLowerCase().includes(needle) ||
        action.detail.toLowerCase().includes(needle),
    );
  }, [actions, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.section
        className="command-palette"
        role="dialog"
        aria-label="Command palette"
        initial={{ opacity: 0, y: -12, scale: 0.97, filter: 'blur(12px)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: -8, scale: 0.98, filter: 'blur(10px)' }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        <header>
          <span>FLUX / COMMAND</span>
          <span>ESC TO CLOSE</span>
        </header>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索一个能力或动作…"
          aria-label="搜索命令"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="palette-list">
          {filtered.map((action) => (
            <button
              type="button"
              key={action.id}
              onClick={() => {
                action.run();
                onClose();
              }}
            >
              <span>
                <strong>{action.label}</strong>
                <small>{action.detail}</small>
              </span>
              <i>ENTER</i>
            </button>
          ))}
          {filtered.length === 0 && <div className="palette-empty">没有匹配的动作</div>}
        </div>
      </motion.section>
    </div>
  );
}

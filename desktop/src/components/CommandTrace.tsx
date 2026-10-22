import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

type Props = {
  onSubmit: (text: string) => void;
  onClose: () => void;
};

/**
 * A hidden, on-demand command trace. The primary interface remains voice-first
 * and the resting page has no input field; pressing "/" reveals this single
 * line for precise keyboard input and accessibility.
 */
export function CommandTrace({ onSubmit, onClose }: Props) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <motion.form
      className="command-trace"
      initial={{ opacity: 0, y: 12, filter: 'blur(7px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: 8, filter: 'blur(5px)' }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      onSubmit={(event) => {
        event.preventDefault();
        const text = value.trim();
        if (!text) {
          onClose();
          return;
        }
        onSubmit(text);
        setValue('');
        onClose();
      }}
    >
      <span className="command-trace-label">FLUX / INPUT</span>
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="输入指令，或对星核说话…"
        aria-label="输入指令"
        autoComplete="off"
        spellCheck={false}
      />
      <span className="command-trace-hint">ENTER · ESC</span>
    </motion.form>
  );
}

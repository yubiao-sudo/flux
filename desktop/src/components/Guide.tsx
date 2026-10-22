import { motion } from 'framer-motion';

const STEPS = [
  {
    index: '01',
    title: 'Speak to the core',
    body: 'Touch the sphere or press Space. Speak naturally. Touch it again to interrupt FLUX while it is thinking.',
  },
  {
    index: '02',
    title: 'Open what you need',
    body: 'S settings · G capability · M memory · H sessions · E engine · L esports · P PLAY · C timeline · A atlas · I dossier. The core docks, never disappears.',
  },
  {
    index: '03',
    title: 'Use the whole engine',
    body: 'Every action is the real agent: files, commands, browser, computer use, documents, schedules, software, meetings and more.',
  },
  {
    index: '04',
    title: 'Stay in control',
    body: 'Writes and high-risk actions stop at the consent lens. Ctrl / Cmd + K opens the command palette; / opens keyboard input.',
  },
];

export function Guide({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="guide-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.section
        className="guide"
        role="dialog"
        aria-label="FLUX quick guide"
        initial={{ opacity: 0, y: 18, scale: 0.975, filter: 'blur(16px)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: 10, scale: 0.985, filter: 'blur(12px)' }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        <header>
          <span>FLUX / QUICK GUIDE</span>
          <button type="button" onClick={onClose}>CLOSE · ESC</button>
        </header>
        <div className="guide-hero">
          <span>FIRST CONTACT</span>
          <h2>
            One core.
            <br />
            Every ability.
          </h2>
          <p>
            FLUX is a single-page agent. There is no navigation and no chat window to manage.
            You speak; the core brings the right instrument forward.
          </p>
        </div>
        <div className="guide-steps">
          {STEPS.map((step) => (
            <article key={step.index}>
              <span>{step.index}</span>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
        <footer>
          <span>ESC TO RETURN TO THE CORE</span>
          <span>FLUX / 流形</span>
        </footer>
      </motion.section>
    </div>
  );
}

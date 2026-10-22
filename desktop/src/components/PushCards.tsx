import { AnimatePresence, motion } from 'framer-motion';
import DOMPurify from 'dompurify';
import { X } from 'lucide-react';
import type { ChatCardData } from '../engine/useFluxEngine';

type Props = {
  cards: ChatCardData[];
  onDismiss: (id: string) => void;
};

/**
 * chat_card 是引擎的「推送」而不是聊天正文：
 * 卡片浮在右侧边缘，独立关闭，不进入 transcript。
 */
export function PushCards({ cards, onDismiss }: Props) {
  return (
    <div className="push-cards" aria-live="polite">
      <AnimatePresence initial={false}>
        {cards.slice(-3).map((card) => (
          <motion.article
            className="push-card"
            key={card.id}
            initial={{ opacity: 0, x: 28, scale: 0.96, filter: 'blur(10px)' }}
            animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: 20, scale: 0.97, filter: 'blur(8px)' }}
            transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          >
            <header>
              <span>FLUX / 推送</span>
              <button type="button" onClick={() => onDismiss(card.id)} aria-label="关闭卡片">
                <X size={12} />
              </button>
            </header>
            {card.title && <strong>{card.title}</strong>}
            <div
              className="push-card-html"
              // Card HTML is model-authored; drop embedded themes so FLUX owns
              // the palette, then sanitize before injecting.
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(card.html.replace(/<style[\s\S]*?<\/style>/gi, ''), {
                  USE_PROFILES: { html: true },
                }),
              }}
            />
          </motion.article>
        ))}
      </AnimatePresence>
    </div>
  );
}

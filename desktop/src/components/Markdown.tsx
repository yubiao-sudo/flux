import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Agent replies arrive as Markdown. Render them as quiet editorial prose inside
 * the transcript: no bubbles, no chrome, no injected handlers.
 */
export function Markdown({ text, cursor = false }: { text: string; cursor?: boolean }) {
  // FLUX/engine replies use ==highlight== for the few facts that matter.
  // chat_card blocks are pushed separately; never leak them into the transcript.
  const source = text
    .replace(/```chat_card\s*\n?[\s\S]*?```/g, '')
    .replace(/==([^=\n]+)==/g, '<mark class="hl">$1</mark>');
  let html = DOMPurify.sanitize(
    marked.parse(source, { async: false, breaks: true, gfm: true }) as string,
    {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['target', 'rel'],
    },
  );

  if (cursor) {
    const marker = '<span class="stream-cursor" aria-hidden="true"></span>';
    // Keep the caret inside the final paragraph so it sits after the last
    // character, instead of jumping to a new line on every re-render.
    html = /<\/p>\s*$/.test(html)
      ? html.replace(/<\/p>\s*$/, `${marker}</p>`)
      : `${html}${marker}`;
  }

  return (
    <div
      className="turn-prose"
      // Sanitised above with DOMPurify's HTML profile.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

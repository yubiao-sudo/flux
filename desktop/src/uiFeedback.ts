/**
 * Global button feedback.
 *
 * Two problems this solves without touching every component:
 *   1. `:active` is easy to miss on a dark UI, so a click needs a visible
 *      press pulse immediately (not after the async handler resolves).
 *   2. Many settings actions flip their button to `disabled={busy}` while the
 *      IPC call is in flight, but the disabled style alone looks identical to
 *      "this button is unavailable". A spinner is added when a recently
 *      clicked button becomes disabled, and removed when it is re-enabled.
 */
export function installUiFeedback() {
  if (typeof document === 'undefined') return;
  const w = window as unknown as { __fluxUiFeedback?: boolean };
  if (w.__fluxUiFeedback) return;
  w.__fluxUiFeedback = true;

  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target as Element | null;
      const button = target?.closest?.('button') as HTMLButtonElement | null;
      if (!button || button.disabled) return;
      button.dataset.clickedAt = String(Date.now());
      button.classList.remove('is-pressing');
      // Restart the animation even when the same button is clicked repeatedly.
      void button.offsetWidth;
      button.classList.add('is-pressing');
      window.setTimeout(() => button.classList.remove('is-pressing'), 180);
    },
    true,
  );

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'attributes' || mutation.attributeName !== 'disabled') continue;
      const button = mutation.target as HTMLButtonElement;
      if (!(button instanceof HTMLButtonElement)) continue;
      const clickedAt = Number(button.dataset.clickedAt || 0);
      if (button.disabled && Date.now() - clickedAt < 2500) {
        button.classList.add('is-loading');
        button.setAttribute('aria-busy', 'true');
      } else if (!button.disabled) {
        button.classList.remove('is-loading');
        button.removeAttribute('aria-busy');
      }
    }
  });
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled'],
  });
}

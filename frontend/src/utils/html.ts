const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Trap Tab/Arrow focus within a modal element. Returns a cleanup function. */
export function trapFocus(modal: HTMLElement): () => void {
  const handler = (e: KeyboardEvent) => {
    const focusable = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    } else if (
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight'
    ) {
      const idx = focusable.indexOf(document.activeElement as HTMLElement);
      if (idx < 0) return;
      e.preventDefault();
      const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      const next = (idx + dir + focusable.length) % focusable.length;
      focusable[next].focus();
    }
  };
  modal.addEventListener('keydown', handler);
  // Auto-focus first focusable element
  const first = modal.querySelector<HTMLElement>(FOCUSABLE);
  if (first && !modal.querySelector(':focus')) first.focus();
  return () => modal.removeEventListener('keydown', handler);
}

/**
 * Enable keyboard activation (Enter/Space) for [data-action] elements
 * within a container using event delegation.
 */
export function enableKeyboardActions(container: HTMLElement): void {
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target as HTMLElement;
    const actionEl = target.closest('[data-action]') as HTMLElement | null;
    if (!actionEl) return;
    e.preventDefault();
    actionEl.click();
  });
}

export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function escapeAttr(text: string): string {
  return text
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Make `parent`'s children exactly `order`, in that order, reusing the elements already there.
 *
 * The alternative — reassigning `innerHTML` — throws away and rebuilds every node, which restarts
 * CSS transitions, drops inline styles written by event handlers, and clears focus and selection.
 * That is fine for a list rendered once, and wrong for one rendered at the game tick rate.
 *
 * Elements already in the right place are left untouched; elements that moved are re-inserted;
 * anything not in `order` ends up in the trailing region and is removed. (audit HUD-PLAYERLIST-1)
 */
export function reconcileChildren(parent: Node, order: readonly Node[]): void {
  let ref: ChildNode | null = parent.firstChild;
  for (const node of order) {
    if (ref === node) {
      ref = node.nextSibling;
    } else {
      parent.insertBefore(node, ref);
    }
  }
  while (ref) {
    const next: ChildNode | null = ref.nextSibling;
    parent.removeChild(ref);
    ref = next;
  }
}

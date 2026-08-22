import DOMPurify, { type Config } from 'dompurify';

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

/**
 * The single HTML sink for the frontend.
 *
 * Every `innerHTML` assignment outside this file is banned by an ESLint rule, because the CSP
 * sets `require-trusted-types-for 'script'`: assigning a plain string to `innerHTML` throws a
 * TypeError in browsers that implement Trusted Types.
 *
 * Rather than mint a TrustedHTML and keep using `innerHTML`, this sanitises to *nodes* and
 * inserts them with `replaceChildren`. Node insertion is not a Trusted Types sink at all, so
 * there is nothing left to bypass — and it removes the whole class of "someone adds one more
 * innerHTML and enforcement breaks in production only".
 *
 * This does not replace `escapeHtml` on interpolated values — that is what actually keeps a
 * username from becoming markup. Sanitising is the second layer, and the one that holds if an
 * escape is ever forgotten. Both layers are checked by tests/utils/sanitizerFidelity.test.ts.
 * (audit CSP-1)
 */

const SANITIZE_CONFIG: Config = {
  // DOMPurify drops `target` by default, as reverse-tabnabbing protection. Every `target="_blank"`
  // in this app is a hard-coded external link that already carries `rel="noopener"`, which is the
  // actual mitigation — so allow the attribute rather than silently making those links open in
  // the current tab.
  ADD_ATTR: ['target'],
};

/** The sanitiser configuration, exported so tests can check it against the real markup. */
export const SANITIZER_OPTIONS = SANITIZE_CONFIG;

/**
 * Table internals have to be parsed inside a table.
 *
 * DOMPurify parses its input in a `<body>` context, where the HTML parser discards `<tr>`, `<td>`
 * and friends and keeps only their text — `<tr><td>a</td><td>b</td></tr>` sanitises to `"ab"`.
 * The `innerHTML` setter does not have this problem because it parses in the *target's* context,
 * so every admin table in this app would have silently rendered as a run of unformatted text.
 *
 * So: wrap the markup in the context its target implies, sanitise, then descend back out.
 */
const TABLE_CONTEXTS: Record<string, { open: string; close: string; depth: number }> = {
  TABLE: { open: '<table>', close: '</table>', depth: 1 },
  THEAD: { open: '<table><thead>', close: '</thead></table>', depth: 2 },
  TBODY: { open: '<table><tbody>', close: '</tbody></table>', depth: 2 },
  TFOOT: { open: '<table><tfoot>', close: '</tfoot></table>', depth: 2 },
  TR: { open: '<table><tbody><tr>', close: '</tr></tbody></table>', depth: 3 },
};

/** Sanitise `html` as if it were being parsed inside `context`, and return the resulting nodes. */
function sanitizeToNodes(context: Element | null, html: string): Node[] {
  if (html === '') return [];

  const wrapper = context ? TABLE_CONTEXTS[context.tagName] : undefined;
  const source = wrapper ? wrapper.open + html + wrapper.close : html;

  const fragment = DOMPurify.sanitize(source, {
    ...SANITIZE_CONFIG,
    RETURN_DOM_FRAGMENT: true,
  }) as unknown as DocumentFragment;

  let container: ParentNode = fragment;
  if (wrapper) {
    for (let i = 0; i < wrapper.depth; i++) {
      const next = container.firstElementChild;
      // Only reachable if the sanitiser dropped the wrapper itself, which would mean the payload
      // was empty or entirely rejected. Either way there is nothing to insert.
      if (!next) return [];
      container = next;
    }
  }
  return Array.from(container.childNodes);
}

/** Replace an element's content with sanitised HTML. */
export function setHtml(el: Element, html: string): void {
  el.replaceChildren(...sanitizeToNodes(el, html));
}

/** Insert sanitised HTML relative to an element, leaving its existing children in place. */
export function insertHtml(el: Element, position: InsertPosition, html: string): void {
  // beforebegin/afterend land among the element's siblings, so the parsing context is the parent.
  const outside = position === 'beforebegin' || position === 'afterend';
  const nodes = sanitizeToNodes(outside ? el.parentElement : el, html);
  if (nodes.length === 0) return;

  switch (position) {
    case 'beforebegin':
      el.before(...nodes);
      break;
    case 'afterbegin':
      el.prepend(...nodes);
      break;
    case 'beforeend':
      el.append(...nodes);
      break;
    case 'afterend':
      el.after(...nodes);
      break;
  }
}

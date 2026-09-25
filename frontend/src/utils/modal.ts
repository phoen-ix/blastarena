import { trapFocus, escapeHtml, setHtml } from './html';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';
import { t } from '../i18n';

interface ModalOptions {
  ariaLabel: string;
  className?: string;
  style?: string;
  parent?: HTMLElement;
  /** Runs once when the modal closes, however it was closed (button, Escape, backdrop, gamepad). */
  onClose?: () => void;
}

interface ModalResult {
  overlay: HTMLElement;
  content: HTMLElement;
  close: () => void;
}

/** Elements a gamepad can reach inside a modal. */
const MODAL_GAMEPAD_TARGETS =
  'input, select, textarea, button, .btn, [tabindex]:not([tabindex="-1"])';

let modalSeq = 0;

/**
 * Create an accessible modal with overlay, focus trap, and Escape-to-close.
 * Returns the overlay element, the inner content div, and a close function.
 */
export function createModal(options: ModalOptions): ModalResult {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', options.ariaLabel);

  const content = document.createElement('div');
  content.className = options.className ?? 'modal';
  if (options.style) {
    content.style.cssText = options.style;
  }
  overlay.appendChild(content);

  let cleanupFocus: (() => void) | null = null;
  let closed = false;
  // Without its own gamepad context the modal was unreachable by pad, and the page underneath
  // kept receiving D-pad and A presses while it was open.
  const gamepadContextId = `modal-${++modalSeq}`;

  const close = () => {
    if (closed) return;
    closed = true;
    if (cleanupFocus) {
      cleanupFocus();
      cleanupFocus = null;
    }
    UIGamepadNavigator.getInstance().popContext(gamepadContextId);
    overlay.remove();
    options.onClose?.();
  };

  // Close on Escape
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  overlay.addEventListener('keydown', onKeyDown);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const parent = options.parent ?? document.body;
  parent.appendChild(overlay);

  UIGamepadNavigator.getInstance().pushContext({
    id: gamepadContextId,
    elements: () => [...overlay.querySelectorAll<HTMLElement>(MODAL_GAMEPAD_TARGETS)],
    onBack: close,
  });

  // Defer focus trap to after caller sets innerHTML
  requestAnimationFrame(() => {
    if (!closed) cleanupFocus = trapFocus(overlay);
  });

  return { overlay, content, close };
}

interface ConfirmOptions {
  title: string;
  /** Plain text; escaped here. */
  message: string;
  confirmLabel: string;
  danger?: boolean;
}

/**
 * In-app replacement for window.confirm(): resolves true when confirmed, false when cancelled or
 * dismissed (Escape, backdrop, gamepad Back).
 */
export function confirmModal(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false;
    const { overlay, content, close } = createModal({
      ariaLabel: options.title,
      style: 'max-width:420px;',
      parent: document.getElementById('ui-overlay') ?? document.body,
      onClose: () => resolve(confirmed),
    });
    setHtml(
      content,
      `
      <h2 class="${options.danger ? 'text-danger' : ''}">${escapeHtml(options.title)}</h2>
      <p class="modal-desc">${escapeHtml(options.message)}</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" data-confirm="cancel">${escapeHtml(t('common:actions.cancel'))}</button>
        <button class="btn ${options.danger ? 'btn-danger' : 'btn-primary'}" data-confirm="ok">${escapeHtml(options.confirmLabel)}</button>
      </div>
    `,
    );
    overlay.querySelector('[data-confirm="cancel"]')!.addEventListener('click', close);
    overlay.querySelector('[data-confirm="ok"]')!.addEventListener('click', () => {
      confirmed = true;
      close();
    });
  });
}

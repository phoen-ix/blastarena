import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Keyboard and gamepad handling in modals (item 12).
 *
 * - trapFocus moved focus on every arrow key, including inside a text field, a select or a
 *   radio group — the caret could not move and a select could not change value by keyboard.
 * - createModal pushed no gamepad context: the pad kept driving the page underneath.
 */

vi.mock('../../src/i18n', () => ({ t: (key: string) => key, i18n: { language: 'en' } }));

const gamepad = { pushContext: vi.fn(), popContext: vi.fn() };
vi.mock('../../src/game/UIGamepadNavigator', () => ({
  UIGamepadNavigator: { getInstance: () => gamepad },
}));

import { trapFocus } from '../../src/utils/html';
import { createModal, confirmModal } from '../../src/utils/modal';

function press(target: HTMLElement, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

let modal: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  gamepad.pushContext.mockClear();
  gamepad.popContext.mockClear();
  modal = document.createElement('div');
  modal.innerHTML = `
    <button id="a">A</button>
    <input id="name" type="text" value="hello">
    <select id="pick"><option>1</option><option>2</option></select>
    <textarea id="notes"></textarea>
    <div role="radiogroup"><span role="radio" tabindex="0" id="r1">x</span></div>
    <button id="b">B</button>`;
  document.body.appendChild(modal);
  // happy-dom has no layout: give everything an offsetParent so trapFocus counts it as visible
  for (const el of modal.querySelectorAll<HTMLElement>('*')) {
    Object.defineProperty(el, 'offsetParent', { get: () => modal, configurable: true });
  }
});

describe('trapFocus', () => {
  it('moves focus with the arrow keys between buttons', () => {
    trapFocus(modal);
    const a = modal.querySelector<HTMLElement>('#a')!;
    a.focus();
    const e = press(a, 'ArrowDown');
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('name');
  });

  it.each(['#name', '#pick', '#notes', '#r1'])(
    'leaves arrow keys to %s (caret, value, radio choice)',
    (selector) => {
      trapFocus(modal);
      const el = modal.querySelector<HTMLElement>(selector)!;
      el.focus();
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
        const e = press(el, key);
        expect(e.defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(el);
      }
    },
  );

  it('still wraps Tab from the last element to the first, even from a text field', () => {
    trapFocus(modal);
    const b = modal.querySelector<HTMLElement>('#b')!;
    b.focus();
    const e = press(b, 'Tab');
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
  });

  it('stops handling keys after cleanup', () => {
    const cleanup = trapFocus(modal);
    cleanup();
    const a = modal.querySelector<HTMLElement>('#a')!;
    a.focus();
    expect(press(a, 'ArrowDown').defaultPrevented).toBe(false);
  });
});

describe('createModal gamepad context', () => {
  it('pushes one context on open, pops that same one on close (once)', () => {
    const onClose = vi.fn();
    const { overlay, close } = createModal({ ariaLabel: 'Test', onClose });
    expect(gamepad.pushContext).toHaveBeenCalledTimes(1);
    const ctx = gamepad.pushContext.mock.calls[0][0];
    expect(ctx.id).toMatch(/^modal-\d+$/);

    overlay.firstElementChild!.innerHTML = '<button class="btn">OK</button>';
    expect(ctx.elements()).toHaveLength(1);

    close();
    close();
    expect(gamepad.popContext).toHaveBeenCalledTimes(1);
    expect(gamepad.popContext).toHaveBeenCalledWith(ctx.id);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('gamepad Back closes the modal', () => {
    createModal({ ariaLabel: 'Test' });
    const ctx = gamepad.pushContext.mock.calls[0][0];
    ctx.onBack();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(gamepad.popContext).toHaveBeenCalledWith(ctx.id);
  });

  it('confirmModal resolves true on confirm and false on Escape', async () => {
    const yes = confirmModal({ title: 'T', message: '<b>x</b>', confirmLabel: 'Go' });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    // The message is text, not markup
    expect(dialog.querySelector('.modal-desc b')).toBeNull();
    expect(dialog.querySelector('.modal-desc')!.textContent).toBe('<b>x</b>');
    dialog.querySelector<HTMLElement>('[data-confirm="ok"]')!.click();
    await expect(yes).resolves.toBe(true);

    const no = confirmModal({ title: 'T', message: 'm', confirmLabel: 'Go', danger: true });
    const dialog2 = document.querySelector<HTMLElement>('[role="dialog"]')!;
    dialog2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(no).resolves.toBe(false);
  });
});

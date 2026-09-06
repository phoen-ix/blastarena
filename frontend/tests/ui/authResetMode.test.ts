import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthManager } from '../../src/network/AuthManager';
import type { NotificationUI } from '../../src/ui/NotificationUI';

/**
 * The forgot-password email links to `/reset-password?token=…`. MenuScene opens AuthUI in the
 * new 'reset' mode with that token; the form must submit it together with the new password to
 * `POST /auth/reset-password` (skipAuthRetry — there is no session to refresh) and drop back to
 * the login form on success. (audit B1)
 */

vi.mock('../../src/i18n', () => ({
  t: (key: string, opts?: Record<string, unknown>) =>
    opts && 'min' in opts ? `${key}:${opts.min}` : key,
  i18n: { language: 'en', changeLanguage: vi.fn() },
}));
vi.mock('../../src/game/UIGamepadNavigator', () => ({
  UIGamepadNavigator: {
    getInstance: () => ({ pushContext() {}, popContext() {}, clearAll() {}, setActive() {} }),
  },
}));

const apiPost = vi.fn();
vi.mock('../../src/network/ApiClient', () => ({
  ApiClient: {
    get: vi.fn(async () => ({ registrationEnabled: true, imprint: false, displayGithub: false })),
    post: (...args: unknown[]) => apiPost(...args),
    setAuthManager: vi.fn(),
  },
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

let AuthUI: typeof import('../../src/ui/AuthUI').AuthUI;
let notifications: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

function openReset(token?: string) {
  const ui = new AuthUI(
    {} as unknown as AuthManager,
    notifications as unknown as NotificationUI,
    () => {},
  );
  ui.show('reset', token);
  return ui;
}

function fill(password: string, confirm = password) {
  (document.getElementById('reset-password') as HTMLInputElement).value = password;
  (document.getElementById('reset-confirm') as HTMLInputElement).value = confirm;
}

const errorText = () => document.getElementById('reset-error')!.textContent;

beforeEach(async () => {
  document.body.replaceChildren();
  const overlay = document.createElement('div');
  overlay.id = 'ui-overlay';
  document.body.appendChild(overlay);
  apiPost.mockReset();
  notifications = { success: vi.fn(), error: vi.fn() };
  ({ AuthUI } = await import('../../src/ui/AuthUI'));
});

describe('AuthUI reset mode', () => {
  it('renders the new-password form with the reset token', () => {
    openReset('tok-123');
    expect(document.getElementById('reset-password')).not.toBeNull();
    expect(document.getElementById('reset-confirm')).not.toBeNull();
    expect(document.getElementById('reset-btn')).not.toBeNull();
    // Not a login form
    expect(document.getElementById('login-btn')).toBeNull();
  });

  it('posts token + password with skipAuthRetry and returns to the login form', async () => {
    apiPost.mockResolvedValue({ message: 'ok' });
    openReset('tok-123');
    fill('correct-horse-battery');
    document.getElementById('reset-btn')!.click();
    await flush();

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith(
      '/auth/reset-password',
      { token: 'tok-123', password: 'correct-horse-battery' },
      true,
    );
    expect(notifications.success).toHaveBeenCalledWith('auth:resetPassword.success');
    expect(document.getElementById('login-btn')).not.toBeNull();
    expect(document.getElementById('reset-btn')).toBeNull();
  });

  it('submits on Enter in the confirm field', async () => {
    apiPost.mockResolvedValue({ message: 'ok' });
    openReset('tok-123');
    fill('correct-horse-battery');
    document
      .getElementById('reset-confirm')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it('validates locally before the round trip', async () => {
    openReset('tok-123');

    fill('', '');
    document.getElementById('reset-btn')!.click();
    expect(errorText()).toBe('auth:resetPassword.fillAllFields');

    fill('short');
    document.getElementById('reset-btn')!.click();
    expect(errorText()).toBe('common:validation.passwordMinLength:8');

    fill('correct-horse-battery', 'correct-horse-staple');
    document.getElementById('reset-btn')!.click();
    expect(errorText()).toBe('auth:resetPassword.mismatch');

    await flush();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('shows the server error and a way to request a new link when the token is rejected', async () => {
    apiPost.mockRejectedValue(new Error('Invalid or expired reset token'));
    openReset('stale');
    fill('correct-horse-battery');
    document.getElementById('reset-btn')!.click();
    await flush();

    expect(errorText()).toBe('Invalid or expired reset token');
    expect(document.getElementById('reset-btn')).not.toBeNull(); // still on the form
    const again = document.getElementById('switch-forgot')!;
    expect(again).not.toBeNull();

    again.click();
    expect(document.getElementById('forgot-email')).not.toBeNull();
  });

  it('refuses to submit without a token and offers a new link instead', async () => {
    openReset(undefined);
    fill('correct-horse-battery');
    document.getElementById('reset-btn')!.click();
    await flush();
    expect(apiPost).not.toHaveBeenCalled();
    expect(errorText()).toBe('auth:resetPassword.missingToken');
    expect(document.getElementById('switch-forgot')).not.toBeNull();
  });
});

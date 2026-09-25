import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import i18next, { type i18n as I18n } from 'i18next';
import type { AuthManager } from '../../src/network/AuthManager';
import type { NotificationUI } from '../../src/ui/NotificationUI';

/**
 * i18n fixes (item 13).
 *
 * - `nBots_plural` is the pre-v21 suffix, which i18next 25 ignores: every count used the singular
 *   ("2 Bot"). The keys are `_one`/`_other` now, and Polish adds `_few` (2-4) and `_many` (5+).
 * - ApiClient errors carry the server `code`; AuthUI.translateError maps it through `errors:`.
 */

const LOCALES = join(__dirname, '../../src/i18n/locales');
const load = (lng: string, ns: string) =>
  JSON.parse(readFileSync(join(LOCALES, lng, `${ns}.json`), 'utf-8'));

describe('plural keys resolve with the real i18next', () => {
  let i18n: I18n;

  beforeAll(async () => {
    i18n = i18next.createInstance();
    await i18n.init({
      lng: 'en',
      fallbackLng: 'en',
      ns: ['ui', 'admin'],
      defaultNS: 'ui',
      resources: {
        en: { ui: load('en', 'ui'), admin: load('en', 'admin') },
        de: { ui: load('de', 'ui'), admin: load('de', 'admin') },
        pl: { ui: load('pl', 'ui'), admin: load('pl', 'admin') },
      },
      interpolation: { escapeValue: false },
      showSupportNotice: false,
    });
  });

  it('English and German bot counts use the plural form', () => {
    const en = i18n.getFixedT('en');
    expect(en('ui:createRoom.nBots', { count: 1 })).toBe('1 Bot');
    expect(en('ui:createRoom.nBots', { count: 2 })).toBe('2 Bots');
    expect(en('ui:createRoom.nBots', { count: 7 })).toBe('7 Bots');
    const de = i18n.getFixedT('de');
    expect(de('ui:createRoom.nBots', { count: 3 })).toBe('3 Bots');
  });

  it('Polish uses its few (2-4) and many (5+) forms', () => {
    const pl = i18n.getFixedT('pl');
    expect(pl('ui:createRoom.nBots', { count: 1 })).toBe('1 Bot');
    expect(pl('ui:createRoom.nBots', { count: 3 })).toBe('3 Boty');
    expect(pl('ui:createRoom.nBots', { count: 5 })).toBe('5 Botów');
    expect(pl('ui:party.memberCount', { count: 2 })).toBe('2 członkowie');
    expect(pl('ui:party.memberCount', { count: 12 })).toBe('12 członków');
    expect(pl('admin:achievements.achievementCount', { count: 4 })).toBe('4 osiągnięcia');
    expect(pl('admin:achievements.achievementCount', { count: 1 })).toBe('1 osiągnięcie');
  });

  it('the 61x61 map size is gone (the server accepts at most 51)', () => {
    for (const lng of ['en', 'de', 'pl']) {
      expect(i18n.exists('ui:createRoom.mapSizes.61', { lng })).toBe(false);
      expect(i18n.exists('ui:createRoom.mapSizes.51', { lng })).toBe(true);
    }
  });
});

vi.mock('../../src/i18n', () => ({
  t: (key: string, opts?: { defaultValue?: string }) =>
    key === 'errors:INVALID_CREDENTIALS'
      ? 'Falscher Benutzername oder Passwort'
      : (opts?.defaultValue ?? key),
  i18n: { language: 'en', changeLanguage: vi.fn() },
}));
vi.mock('../../src/game/UIGamepadNavigator', () => ({
  UIGamepadNavigator: {
    getInstance: () => ({ pushContext() {}, popContext() {}, clearAll() {}, setActive() {} }),
  },
}));
vi.mock('../../src/network/ApiClient', async () => {
  const actual = await vi.importActual<typeof import('../../src/network/ApiClient')>(
    '../../src/network/ApiClient',
  );
  return {
    ApiError: actual.ApiError,
    ApiClient: {
      get: vi.fn(async () => ({ registrationEnabled: true, imprint: false, displayGithub: false })),
      post: vi.fn(),
    },
  };
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('AuthUI translates the server error code', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    const overlay = document.createElement('div');
    overlay.id = 'ui-overlay';
    document.body.appendChild(overlay);
  });

  async function loginWith(error: unknown) {
    document.getElementById('ui-overlay')!.replaceChildren();
    const { AuthUI } = await import('../../src/ui/AuthUI');
    const authManager = { login: vi.fn(async () => Promise.reject(error)) };
    const ui = new AuthUI(
      authManager as unknown as AuthManager,
      { success: vi.fn(), error: vi.fn() } as unknown as NotificationUI,
      () => {},
    );
    ui.show('login');
    (document.getElementById('login-username') as HTMLInputElement).value = 'me';
    (document.getElementById('login-password') as HTMLInputElement).value = 'wrong-password';
    document.getElementById('login-btn')!.click();
    await flush();
    return document.getElementById('login-error')!.textContent;
  }

  it('shows the translation for an ApiError code', async () => {
    const { ApiError } = await import('../../src/network/ApiClient');
    const text = await loginWith(
      new ApiError('Invalid username or password', 401, 'INVALID_CREDENTIALS'),
    );
    expect(text).toBe('Falscher Benutzername oder Passwort');
  });

  it('falls back to the message when the code has no translation', async () => {
    const { ApiError } = await import('../../src/network/ApiClient');
    expect(await loginWith(new ApiError('Rate limited', 429, 'SOMETHING_NEW'))).toBe(
      'Rate limited',
    );
    expect(await loginWith(new Error('Network down'))).toBe('Network down');
  });

  it('keyboard-reachable form links are buttons, not <a> without href (item 12)', async () => {
    const { AuthUI } = await import('../../src/ui/AuthUI');
    new AuthUI({} as unknown as AuthManager, {} as unknown as NotificationUI, () => {}).show(
      'login',
    );
    for (const id of ['switch-register', 'switch-forgot']) {
      const el = document.getElementById(id)!;
      expect(el.tagName).toBe('BUTTON');
      expect(el.getAttribute('type')).toBe('button');
    }
  });
});

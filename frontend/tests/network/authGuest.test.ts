import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * An open-world guest can sign in from the HUD's login bar without leaving the arena. The guest
 * flag used to survive that sign-in, so the lobby showed guest-only navigation and its logout
 * button called clearGuest() instead of /auth/logout: the account's session was never revoked.
 */

vi.mock('../../src/i18n', () => ({
  i18n: { language: 'en', changeLanguage: vi.fn() },
  t: (key: string) => key,
}));

let AuthManager: typeof import('../../src/network/AuthManager').AuthManager;

const authResponse = {
  accessToken: 'access',
  user: { id: 7, username: 'me', role: 'user', language: 'en' },
};

/** fetch double: answers by path; anything unlisted is a plain 200 with an empty body. */
function stubFetch(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    const path = url.replace(/^\/api/, '');
    return {
      ok: true,
      status: 200,
      json: async () => (path === '/auth/csrf' ? { csrfToken: 'tok' } : (routes[path] ?? {})),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  ({ AuthManager } = await import('../../src/network/AuthManager'));
});

describe('AuthManager guest state', () => {
  it('a guest who logs in is no longer a guest', async () => {
    stubFetch({ '/auth/login': authResponse });
    const auth = new AuthManager();
    auth.setGuestIdentity(-3001, 'Guest 1');
    expect(auth.isGuest).toBe(true);

    expect(await auth.login('me', 'pw')).toBe('success');
    expect(auth.isGuest).toBe(false);
    expect(auth.getUser()?.id).toBe(7);
  });

  it('a guest who passes the TOTP step is no longer a guest', async () => {
    stubFetch({
      '/auth/login': { totpRequired: true, totpToken: 'pending' },
      '/auth/verify-totp': authResponse,
    });
    const auth = new AuthManager();
    auth.setGuestIdentity(-3001, 'Guest 1');

    expect(await auth.login('me', 'pw')).toBe('totp-required');
    expect(auth.isGuest).toBe(true);
    await auth.verifyTotp('123456');
    expect(auth.isGuest).toBe(false);
  });

  it('a guest whose session is restored by refresh is no longer a guest', async () => {
    stubFetch({ '/auth/refresh': authResponse });
    const auth = new AuthManager();
    auth.setGuestIdentity(-3001, 'Guest 1');

    expect(await auth.refresh()).toBe(true);
    expect(auth.isGuest).toBe(false);
  });

  it('logout clears the guest flag and a pending TOTP challenge', async () => {
    stubFetch({ '/auth/login': { totpRequired: true, totpToken: 'pending' } });
    const auth = new AuthManager();
    auth.setGuestIdentity(-3001, 'Guest 1');
    await auth.login('me', 'pw');

    await auth.logout();
    expect(auth.isGuest).toBe(false);
    expect(auth.getUser()).toBeNull();
    await expect(auth.verifyTotp('123456')).rejects.toThrow('No pending TOTP challenge');
  });
});

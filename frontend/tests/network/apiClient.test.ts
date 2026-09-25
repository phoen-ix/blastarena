import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AuthManager } from '../../src/network/AuthManager';

/**
 * ApiClient error and session handling.
 *
 * - Errors carry the server's `code` and the HTTP status (ApiError): a plain Error dropped the
 *   code, so AuthUI.translateError never found a translation.
 * - A 401 on a request that carried no token (a guest, or before login) must not log anyone out:
 *   it used to end in authManager.logout(), which threw open-world guests out of the lobby.
 * - download() sends the Bearer token: the admin AI downloads used a bare fetch without one.
 */

vi.mock('../../src/i18n', () => ({ t: (key: string) => key, i18n: { language: 'en' } }));

let ApiClient: typeof import('../../src/network/ApiClient').ApiClient;
let ApiError: typeof import('../../src/network/ApiClient').ApiError;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeAuth(token: string | null, refreshResult = false) {
  return {
    getAccessToken: vi.fn(() => token),
    refresh: vi.fn(async () => refreshResult),
    logout: vi.fn(async () => {}),
  };
}

const fetchMock = vi.fn();

beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  ({ ApiClient, ApiError } = await import('../../src/network/ApiClient'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApiClient errors', () => {
  it('throws an ApiError carrying the server code and HTTP status', async () => {
    ApiClient.setAuthManager(fakeAuth('tok') as unknown as AuthManager);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { error: 'Invalid username or password', code: 'INVALID_CREDENTIALS' }),
    );

    const err = await ApiClient.post('/auth/login', { username: 'a' }, true).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('INVALID_CREDENTIALS');
    expect(err.status).toBe(400);
    expect(err.message).toBe('Invalid username or password');
  });

  it('keeps field-level validation details in the message', async () => {
    ApiClient.setAuthManager(fakeAuth('tok') as unknown as AuthManager);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        error: 'Validation failed',
        code: 'VALIDATION_FAILED',
        details: [{ field: 'name', message: 'Required' }],
      }),
    );
    const err = await ApiClient.get('/x').catch((e) => e);
    expect(err.message).toBe('Validation failed (name: Required)');
    expect(err.code).toBe('VALIDATION_FAILED');
  });
});

describe('ApiClient 401 handling', () => {
  it('does not log out when the failed request carried no token (guest)', async () => {
    const auth = fakeAuth(null, false);
    ApiClient.setAuthManager(auth as unknown as AuthManager);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: 'Authentication required', code: 'UNAUTHORIZED' }),
    );

    const err = await ApiClient.get('/user/rank').catch((e) => e);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(auth.logout).not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
    // No Authorization header was invented for the guest
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('logs out when a token-bearing request fails and the refresh fails', async () => {
    const auth = fakeAuth('expired', false);
    ApiClient.setAuthManager(auth as unknown as AuthManager);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: 'Invalid or expired token', code: 'INVALID_TOKEN' }),
    );

    const err = await ApiClient.get('/user/profile').catch((e) => e);
    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('TOKEN_EXPIRED');
  });

  it('retries once with the refreshed token', async () => {
    let token = 'old';
    const auth = {
      getAccessToken: vi.fn(() => token),
      refresh: vi.fn(async () => {
        token = 'new';
        return true;
      }),
      logout: vi.fn(),
    };
    ApiClient.setAuthManager(auth as unknown as AuthManager);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(401, { error: 'Invalid or expired token', code: 'INVALID_TOKEN' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await expect(ApiClient.get('/user/profile')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
    expect(auth.logout).not.toHaveBeenCalled();
  });
});

describe('ApiClient non-token 401', () => {
  it('returns a wrong-password 401 as is, without refreshing or sending the request again', async () => {
    // It used to refresh and retry, so one wrong password cost two attempts against the limit.
    const auth = fakeAuth('tok', true);
    ApiClient.setAuthManager(auth as unknown as AuthManager);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: 'Password is incorrect', code: 'INVALID_PASSWORD' }),
    );

    const err = await ApiClient.post('/user/totp/disable', { password: 'x', code: '1' }).catch(
      (e) => e,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(auth.logout).not.toHaveBeenCalled();
    expect(err.code).toBe('INVALID_PASSWORD');
  });
});

describe('ApiClient.download', () => {
  it('sends the Bearer token and returns the raw response', async () => {
    ApiClient.setAuthManager(fakeAuth('tok-123') as unknown as AuthManager);
    fetchMock.mockResolvedValueOnce(
      new Response('export default class Bot {}', {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="MyBot.ts"' },
      }),
    );

    const res = await ApiClient.download('/admin/ai/abc/download');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/ai/abc/download');
    expect(init.headers.Authorization).toBe('Bearer tok-123');
    expect(init.credentials).toBe('include');
    expect(await res.text()).toBe('export default class Bot {}');
  });

  it('throws an ApiError for a failed download', async () => {
    ApiClient.setAuthManager(fakeAuth('tok') as unknown as AuthManager);
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'Not found', code: 'NOT_FOUND' }));
    const err = await ApiClient.download('/admin/ai/x/download').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const timingSafeEqual = vi.hoisted(() => vi.fn());
vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');
  timingSafeEqual.mockImplementation(actual.timingSafeEqual);
  return { ...actual, default: actual, timingSafeEqual };
});
vi.mock('../../../backend/src/config', () => ({
  getConfig: () => ({ APP_URL: 'http://localhost' }),
}));

import { verifyCsrfToken } from '../../../backend/src/middleware/csrf';

const TOKEN = 'ab'.repeat(32);

function run(cookie: unknown, header: string | undefined) {
  const req = {
    cookies: { csrfToken: cookie },
    get: (name: string) => (name === 'X-CSRF-Token' ? header : undefined),
  } as unknown as Request;
  const status = vi.fn();
  const res = { status, json: vi.fn() } as unknown as Response;
  status.mockReturnValue(res);
  const next = vi.fn();
  verifyCsrfToken(req, res, next as unknown as NextFunction);
  return { next, status };
}

/** The double-submit token is compared in constant time, not with `!==`. */
describe('verifyCsrfToken comparison', () => {
  beforeEach(() => {
    timingSafeEqual.mockClear();
  });

  it('accepts a matching token through crypto.timingSafeEqual', () => {
    const { next, status } = run(TOKEN, TOKEN);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });

  it('refuses a same-length mismatch through crypto.timingSafeEqual', () => {
    const { next, status } = run(TOKEN, 'cd'.repeat(32));
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a shorter header', TOKEN, TOKEN.slice(1)],
    ['no header', TOKEN, undefined],
    ['no cookie', undefined, TOKEN],
  ])('refuses %s without throwing', (_label, cookie, header) => {
    const { next, status } = run(cookie, header);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
});

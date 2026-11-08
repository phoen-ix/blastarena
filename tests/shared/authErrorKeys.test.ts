import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * The sign-in screens translate a server error by its code (`errors:<CODE>`) and fall back to the
 * server's English message when there is no key. Every code the auth paths can send therefore needs
 * a key — or must be listed here as one no sign-in screen shows. Seven had neither, so a German
 * user hitting the login rate limit read "Too many requests".
 */
const root = path.resolve(__dirname, '../..');

const AUTH_SOURCES = [
  'backend/src/routes/auth.ts',
  'backend/src/services/auth.ts',
  'backend/src/services/totp.ts',
  'backend/src/middleware/rateLimiter.ts',
  'backend/src/middleware/csrf.ts',
  'backend/src/middleware/auth.ts',
  'backend/src/middleware/emailVerified.ts',
  'backend/src/middleware/errorHandler.ts',
  'backend/src/app.ts',
];

/** Protocol-level failures, or 2FA management codes shown in Settings, not on the sign-in forms. */
const NOT_SHOWN_ON_SIGN_IN = new Set([
  'HEADERS_TOO_LARGE',
  'INVALID_JSON',
  'METHOD_NOT_ALLOWED',
  'REQUEST_ABORTED',
  'UNSUPPORTED_MEDIA_TYPE',
  'URI_TOO_LONG',
  'NO_TOTP_SETUP',
  'TOTP_ALREADY_ENABLED',
  'TOTP_NOT_CONFIGURED',
  'TOTP_NOT_ENABLED',
]);

describe('auth error codes', () => {
  it('each has an errors: translation key or is listed as not shown on sign-in', () => {
    const codes = new Set<string>();
    for (const file of AUTH_SOURCES) {
      const src = fs.readFileSync(path.join(root, file), 'utf-8');
      for (const m of src.matchAll(/new AppError\([^;]*?,\s*\d+,\s*'([A-Z_]+)'/gs)) codes.add(m[1]);
      for (const m of src.matchAll(/code: '([A-Z_]+)'/g)) codes.add(m[1]);
    }
    expect(codes.size).toBeGreaterThan(10);
    const en = JSON.parse(
      fs.readFileSync(path.join(root, 'frontend/src/i18n/locales/en/errors.json'), 'utf-8'),
    ) as Record<string, string>;
    const missing = [...codes].filter((c) => !(c in en) && !NOT_SHOWN_ON_SIGN_IN.has(c));
    expect(missing).toEqual([]);
  });
});

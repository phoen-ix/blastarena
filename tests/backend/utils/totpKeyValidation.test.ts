import { describe, it, expect } from '@jest/globals';
import crypto from 'crypto';
import { isValidTotpKey } from '../../../backend/src/config';
import { encryptTotpSecret, decryptTotpSecret } from '../../../backend/src/utils/crypto';

/**
 * Regression guard: what config accepts for TOTP_ENCRYPTION_KEY must be what aes-256-gcm accepts.
 *
 * The rule used to be `length >= 32` while `encryptTotpSecret` does `Buffer.from(key, 'hex')` into
 * `aes-256-gcm`, which needs exactly 32 bytes. The two disagreed, and the disagreement was
 * invisible at boot: a 32-character key validated cleanly and then threw `Invalid key length` the
 * first time a user enabled 2FA. The tests below pin both halves together, so tightening one
 * without the other fails here rather than in production at enrolment time.
 *
 * The silent-truncation cases matter as much as the length: `Buffer.from(s, 'hex')` stops at the
 * first non-hex character and returns what it managed to decode instead of throwing, so a
 * passphrase does not fail loudly — it produces a short (or empty) key. (audit TOTP-KEY-LENGTH-1)
 */

const VALID_KEY = crypto.randomBytes(32).toString('hex'); // what `openssl rand -hex 32` gives

describe('isValidTotpKey', () => {
  it('accepts exactly 64 hex characters, in either case', () => {
    expect(isValidTotpKey(VALID_KEY)).toBe(true);
    expect(isValidTotpKey('a'.repeat(64))).toBe(true);
    expect(isValidTotpKey('A'.repeat(64))).toBe(true);
  });

  it('rejects the 32-character key the old >=32 rule let through', () => {
    // The exact shape of the original bug: passes `length >= 32`, decodes to 16 bytes.
    expect(isValidTotpKey('a'.repeat(32))).toBe(false);
    expect(Buffer.from('a'.repeat(32), 'hex')).toHaveLength(16);
  });

  it('rejects non-hex input rather than letting it truncate silently', () => {
    // 'z' is not hex, so Buffer.from stops immediately and yields nothing at all.
    expect(isValidTotpKey('z'.repeat(64))).toBe(false);
    expect(Buffer.from('z'.repeat(64), 'hex')).toHaveLength(0);

    // 64 characters that only *start* hex: decodes to 4 bytes, not 32.
    const mixed = 'abcdef12' + 'g'.repeat(56);
    expect(mixed).toHaveLength(64);
    expect(isValidTotpKey(mixed)).toBe(false);
    expect(Buffer.from(mixed, 'hex')).toHaveLength(4);
  });

  it('rejects lengths either side of 64, including an over-long key that starts with 64 hex', () => {
    expect(isValidTotpKey('')).toBe(false);
    expect(isValidTotpKey('a'.repeat(63))).toBe(false);
    // Would previously have worked by accident — Buffer.from takes the first 64 hex chars and
    // ignores the tail, so the operator's real secret and the key in use silently differ.
    expect(isValidTotpKey(VALID_KEY + 'ff')).toBe(false);
  });
});

describe('TOTP encryption against the validated key shape', () => {
  it('round-trips a secret with a key that passes validation', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    expect(isValidTotpKey(VALID_KEY)).toBe(true);
    expect(decryptTotpSecret(encryptTotpSecret(secret, VALID_KEY), VALID_KEY)).toBe(secret);
  });

  it('throws on a key that fails validation — the failure config now catches at boot', () => {
    const shortKey = 'a'.repeat(32);
    expect(isValidTotpKey(shortKey)).toBe(false);
    expect(() => encryptTotpSecret('JBSWY3DPEHPK3PXP', shortKey)).toThrow();
  });

  it('does not decrypt with a different valid key', () => {
    const other = crypto.randomBytes(32).toString('hex');
    const encrypted = encryptTotpSecret('JBSWY3DPEHPK3PXP', VALID_KEY);
    expect(() => decryptTotpSecret(encrypted, other)).toThrow('Failed to decrypt 2FA secret');
  });
});

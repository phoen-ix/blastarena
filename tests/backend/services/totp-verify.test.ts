import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import * as OTPAuth from 'otpauth';

const KEY = 'a'.repeat(64);

jest.mock('../../../backend/src/config', () => ({
  getConfig: () => ({ TOTP_ENCRYPTION_KEY: 'a'.repeat(64) }),
}));

// users row: encrypted secret + the last accepted step, with the UPDATE's compare-and-set
const row: {
  totp_secret: string;
  totp_backup_codes: string | null;
  totp_last_step: number | null;
} = { totp_secret: '', totp_backup_codes: null, totp_last_step: null };
jest.mock('../../../backend/src/db/connection', () => ({
  query: jest.fn(async () => [row]),
  execute: jest.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('totp_last_step')) {
      const step = params[0] as number;
      if (row.totp_last_step === null || row.totp_last_step < step) {
        row.totp_last_step = step;
        return { affectedRows: 1 };
      }
      return { affectedRows: 0 };
    }
    return { affectedRows: 1 };
  }),
}));

const store = new Map<string, number>();
jest.mock('../../../backend/src/db/redis', () => ({
  getRedis: () => ({
    get: async (k: string) => (store.has(k) ? String(store.get(k)) : null),
    incr: async (k: string) => {
      store.set(k, (store.get(k) ?? 0) + 1);
      return store.get(k);
    },
    expire: async () => 1,
    del: async (k: string) => (store.delete(k) ? 1 : 0),
  }),
}));

import { verifyCode } from '../../../backend/src/services/totp';
import { encryptTotpSecret } from '../../../backend/src/utils/crypto';

const secret = new OTPAuth.Secret();
const totp = new OTPAuth.TOTP({ secret, algorithm: 'SHA1', digits: 6, period: 30 });

describe('TOTP verification', () => {
  beforeEach(() => {
    store.clear();
    row.totp_secret = encryptTotpSecret(secret.base32, KEY);
    row.totp_last_step = null;
  });

  it('accepts a valid code once per time step', async () => {
    const code = totp.generate();
    expect(await verifyCode(1, code)).toBe(true);
    expect(await verifyCode(1, code)).toBe(false);
  });

  it('stops checking codes after repeated failures', async () => {
    for (let i = 0; i < 10; i++) expect(await verifyCode(1, '000000')).toBe(false);
    await expect(verifyCode(1, totp.generate())).rejects.toMatchObject({ statusCode: 429 });
  });

  it('a success clears the failure count', async () => {
    for (let i = 0; i < 5; i++) await verifyCode(1, '000000');
    expect(await verifyCode(1, totp.generate())).toBe(true);
    expect(store.size).toBe(0);
  });
});

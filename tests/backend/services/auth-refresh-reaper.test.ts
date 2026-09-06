import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * cleanupExpiredRefreshTokens used to run one
 * `DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked = TRUE` — the OR across two
 * columns defeats idx_refresh_tokens_expires (full scan), and an unbounded DELETE takes one long
 * write lock on a table that grows by ~96 rows per active user per day. It now runs two indexed
 * predicates, each as `DELETE … LIMIT 10000` in a loop until a chunk comes back short. (audit E8)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockQuery = jest.fn<(...args: any[]) => Promise<any>>();
const mockExecute = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
  withTransaction: jest.fn(),
}));
jest.mock('../../../backend/src/utils/crypto', () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(),
  generateToken: jest.fn(),
  hashToken: jest.fn(),
  hashEmail: jest.fn(),
  generateEmailHint: jest.fn(),
  scrubEmailError: (e: unknown) => e,
}));
jest.mock('../../../backend/src/services/email', () => ({
  sendVerificationEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  sendEmailTakenRegistrationWarning: jest.fn(),
}));
jest.mock('../../../backend/src/config', () => ({
  getConfig: () => ({ JWT_SECRET: 'x'.repeat(32), EMAIL_PEPPER: 'y'.repeat(32) }),
}));
jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
/* eslint-enable @typescript-eslint/no-explicit-any */

import { cleanupExpiredRefreshTokens } from '../../../backend/src/services/auth';

const CHUNK = 10000;

describe('cleanupExpiredRefreshTokens (audit E8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs two separate indexed deletes, never an OR across both columns', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 0 });

    await cleanupExpiredRefreshTokens();

    expect(mockExecute).toHaveBeenCalledTimes(2);
    const [expiredSql, expiredParams] = mockExecute.mock.calls[0];
    const [revokedSql, revokedParams] = mockExecute.mock.calls[1];

    expect(expiredSql).toMatch(/^DELETE FROM refresh_tokens WHERE expires_at < NOW\(\) LIMIT \?$/);
    expect(expiredParams).toEqual([CHUNK]);

    expect(revokedSql).toMatch(
      /^DELETE FROM refresh_tokens WHERE revoked = TRUE AND created_at < NOW\(\) - INTERVAL 1 DAY LIMIT \?$/,
    );
    expect(revokedParams).toEqual([CHUNK]);

    for (const [sql] of mockExecute.mock.calls) {
      expect(sql).not.toContain(' OR ');
    }
  });

  it('loops each predicate until a chunk comes back short, and sums the rows', async () => {
    // expired: two full chunks then a short one; revoked: one short chunk.
    mockExecute
      .mockResolvedValueOnce({ affectedRows: CHUNK })
      .mockResolvedValueOnce({ affectedRows: CHUNK })
      .mockResolvedValueOnce({ affectedRows: 123 })
      .mockResolvedValueOnce({ affectedRows: 45 });

    const removed = await cleanupExpiredRefreshTokens();

    expect(removed).toBe(CHUNK * 2 + 123 + 45);
    expect(mockExecute).toHaveBeenCalledTimes(4);
    const sqls = mockExecute.mock.calls.map(([sql]) => String(sql));
    expect(sqls.slice(0, 3).every((s) => s.includes('expires_at < NOW()'))).toBe(true);
    expect(sqls[3]).toContain('revoked = TRUE');
  });

  it('stops immediately when a chunk is exactly one row short of full', async () => {
    mockExecute
      .mockResolvedValueOnce({ affectedRows: CHUNK - 1 })
      .mockResolvedValueOnce({ affectedRows: 0 });

    expect(await cleanupExpiredRefreshTokens()).toBe(CHUNK - 1);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('treats a missing affectedRows as zero and terminates', async () => {
    mockExecute.mockResolvedValue({});

    expect(await cleanupExpiredRefreshTokens()).toBe(0);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('propagates a driver error instead of looping forever', async () => {
    mockExecute.mockRejectedValue(new Error('ER_LOCK_WAIT_TIMEOUT'));

    await expect(cleanupExpiredRefreshTokens()).rejects.toThrow('ER_LOCK_WAIT_TIMEOUT');
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});

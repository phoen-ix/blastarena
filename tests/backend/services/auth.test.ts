import { describe, it, expect, vi, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockQuery = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<any>>());
const mockExecute = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<any>>());
// Transaction connection used by the refresh rotation (audit B12). Its execute() follows the
// mysql2 promise shape, `[result, fields]`; the pool-level mockExecute above returns `result`.
const mockConnExecute = vi.fn<(...args: any[]) => Promise<any>>();
const mockWithTransaction = vi.hoisted(() =>
  vi.fn<(...args: any[]) => Promise<any>>(async (fn) =>
    fn({ execute: mockConnExecute, query: vi.fn() }),
  ),
);
vi.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
  withTransaction: mockWithTransaction,
}));

const mockHashPassword = vi.hoisted(() => vi.fn<(password: string) => Promise<string>>());
const mockComparePassword = vi.hoisted(() =>
  vi.fn<(password: string, hash: string) => Promise<boolean>>(),
);
const mockGenerateToken = vi.hoisted(() => vi.fn<() => string>());
const mockHashToken = vi.hoisted(() => vi.fn<(token: string) => string>());
const mockHashEmail = vi.hoisted(() => vi.fn<(email: string, pepper: string) => string>());
const mockGenerateEmailHint = vi.hoisted(() => vi.fn<(email: string) => string>());
vi.mock('../../../backend/src/utils/crypto', async () => ({
  hashPassword: mockHashPassword,
  comparePassword: mockComparePassword,
  generateToken: mockGenerateToken,
  hashToken: mockHashToken,
  hashEmail: mockHashEmail,
  generateEmailHint: mockGenerateEmailHint,
  // Real implementation on purpose: these tests assert that error logs do NOT contain
  // an address, and a stub returning undefined would pass while leaking. (audit EMAIL-LOG-1)
  scrubEmailError: (
    await vi.importActual<typeof import('../../../backend/src/utils/crypto')>(
      '../../../backend/src/utils/crypto',
    )
  ).scrubEmailError,
}));

const mockSendVerificationEmail = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<void>>());
const mockSendPasswordResetEmail = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<void>>());
const mockSendEmailTakenRegistrationWarning = vi.hoisted(() =>
  vi.fn<(...args: any[]) => Promise<void>>(),
);
vi.mock('../../../backend/src/services/email', () => ({
  sendVerificationEmail: mockSendVerificationEmail,
  sendPasswordResetEmail: mockSendPasswordResetEmail,
  sendEmailTakenRegistrationWarning: mockSendEmailTakenRegistrationWarning,
}));

vi.mock('../../../backend/src/config', () => ({
  getConfig: () => ({
    JWT_SECRET: 'test-secret-key-that-is-at-least-32-chars-long',
    JWT_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    EMAIL_PEPPER: 'test-pepper-minimum-32-characters-long',
  }),
}));

vi.mock('../../../backend/src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
/* eslint-enable @typescript-eslint/no-explicit-any */

import jwt from 'jsonwebtoken';
import * as authService from '../../../backend/src/services/auth';
import { AppError } from '../../../backend/src/middleware/errorHandler';
import { verifyAccessToken } from '../../../backend/src/middleware/auth';

describe('Auth Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHashPassword.mockResolvedValue('hashed-password');
    mockComparePassword.mockResolvedValue(true);
    mockGenerateToken.mockReturnValue('a'.repeat(64));
    mockHashToken.mockReturnValue('hashed-token');
    mockHashEmail.mockReturnValue('hashed-email');
    mockGenerateEmailHint.mockReturnValue('n***@t***.com');
    mockSendVerificationEmail.mockResolvedValue(undefined);
    mockSendPasswordResetEmail.mockResolvedValue(undefined);
    mockSendEmailTakenRegistrationWarning.mockResolvedValue(undefined);
  });

  describe('register', () => {
    it('returns a uniform emailVerificationRequired response with no session on success', async () => {
      mockQuery.mockResolvedValueOnce([]); // username check
      mockQuery.mockResolvedValueOnce([]); // email check
      mockExecute.mockResolvedValue({ insertId: 42, affectedRows: 1 });

      const result = await authService.register('newuser', 'new@test.com', 'password123');

      // No auto-login: registration issues no session token. (audit EMAIL-005)
      expect(result).toEqual({ emailVerificationRequired: true });
      const asRecord = result as unknown as Record<string, unknown>;
      expect(asRecord.accessToken).toBeUndefined();
      expect(asRecord.user).toBeUndefined();
    });

    it('should throw 409 on duplicate username', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 1 }]); // username taken

      try {
        await authService.register('taken', 'new@test.com', 'pass');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as InstanceType<typeof AppError>).statusCode).toBe(409);
      }
    });

    it('returns the same response as success on duplicate email (no enumeration) and warns the owner', async () => {
      mockQuery.mockResolvedValueOnce([]); // username free
      mockQuery.mockResolvedValueOnce([{ id: 1, language: 'de' }]); // email taken

      const result = await authService.register('newuser', 'taken@test.com', 'pass');

      // Indistinguishable from a successful registration. (audit EMAIL-005)
      expect(result).toEqual({ emailVerificationRequired: true });
      expect(mockSendEmailTakenRegistrationWarning).toHaveBeenCalledWith('taken@test.com', 'de');
      // No account is created for an already-registered email.
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should call hashPassword with the provided password', async () => {
      mockQuery.mockResolvedValueOnce([]); // username check
      mockQuery.mockResolvedValueOnce([]); // email check
      mockExecute.mockResolvedValue({ insertId: 1, affectedRows: 1 });

      await authService.register('user1', 'user1@test.com', 'mypassword');

      expect(mockHashPassword).toHaveBeenCalledWith('mypassword');
    });

    it('should send verification email without blocking on failure', async () => {
      mockQuery.mockResolvedValue([]);
      mockExecute.mockResolvedValue({ insertId: 1, affectedRows: 1 });
      mockSendVerificationEmail.mockRejectedValue(new Error('SMTP down'));

      const result = await authService.register('user2', 'user2@test.com', 'pass');

      expect(result.emailVerificationRequired).toBe(true);
      expect(mockSendVerificationEmail).toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const mockUserRow = {
      id: 10,
      username: 'testuser',
      password_hash: 'hashed',
      role: 'user',
      language: 'en',
      is_deactivated: false,
      email_verified: true,
      totp_enabled: false,
    };

    it('should return auth and refreshToken on success', async () => {
      mockQuery.mockResolvedValue([mockUserRow]);
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const result = await authService.login('testuser', 'password');

      expect('totpRequired' in result).toBe(false);
      if ('auth' in result) {
        expect(result.auth.user).toEqual({
          id: 10,
          username: 'testuser',
          role: 'user',
          language: 'en',
          emailVerified: true,
          twoFactorEnabled: false,
        });
        expect(result.auth.accessToken).toBeDefined();
        expect(result.refreshToken).toBeDefined();
      }
    });

    it('should throw 401 when user is not found', async () => {
      mockQuery.mockResolvedValue([]);

      try {
        await authService.login('nonexistent', 'pass');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as InstanceType<typeof AppError>).statusCode).toBe(401);
      }
    });

    it('should throw 401 when password is wrong', async () => {
      mockQuery.mockResolvedValue([mockUserRow]);
      mockComparePassword.mockResolvedValue(false);

      try {
        await authService.login('testuser', 'wrongpass');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as InstanceType<typeof AppError>).statusCode).toBe(401);
      }
    });

    it('should throw 403 when user is deactivated', async () => {
      mockQuery.mockResolvedValue([{ ...mockUserRow, is_deactivated: true }]);

      try {
        await authService.login('testuser', 'pass');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as InstanceType<typeof AppError>).statusCode).toBe(403);
      }
    });

    // The password used to be checked after deactivation, and not at all for an unknown name:
    // both answers and their timing told a caller which usernames exist. (audit S5)
    it('compares the password against a dummy bcrypt hash for an unknown username', async () => {
      mockQuery.mockResolvedValue([]);

      await expect(authService.login('nonexistent', 'pass')).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
      });
      expect(mockComparePassword).toHaveBeenCalledTimes(1);
      expect(mockComparePassword.mock.calls[0][1]).toMatch(/^\$2[aby]\$12\$.{53}$/);
    });

    it('answers a deactivated account with a wrong password as invalid credentials', async () => {
      mockQuery.mockResolvedValue([{ ...mockUserRow, is_deactivated: true }]);
      mockComparePassword.mockResolvedValue(false);

      await expect(authService.login('testuser', 'wrong')).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('reveals deactivation only after the password checked out', async () => {
      mockQuery.mockResolvedValue([{ ...mockUserRow, is_deactivated: true }]);

      await expect(authService.login('testuser', 'right')).rejects.toMatchObject({
        statusCode: 403,
        code: 'DEACTIVATED',
      });
      expect(mockComparePassword).toHaveBeenCalledWith('right', 'hashed');
    });

    it('should store hashed refresh token in DB', async () => {
      mockQuery.mockResolvedValue([mockUserRow]);
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await authService.login('testuser', 'password');

      // First execute: UPDATE last_login, second: INSERT refresh token
      const insertCall = mockExecute.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO refresh_tokens'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toEqual(expect.arrayContaining([10, 'hashed-token']));
    });
  });

  describe('refreshTokenLifetimeMs', () => {
    it('follows JWT_REFRESH_EXPIRES_IN (the route sets the cookie maxAge from it)', () => {
      expect(authService.refreshTokenLifetimeMs()).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe('refreshAccessToken', () => {
    const mockRefreshRow = {
      id: 5,
      user_id: 10,
      expires_at: new Date(Date.now() + 86400000), // +1 day
      revoked: false,
      username: 'testuser',
      role: 'user',
      language: 'en',
      is_deactivated: false,
      email_verified: false,
      totp_enabled: false,
    };

    it('should rotate token and return new auth on success', async () => {
      mockQuery.mockResolvedValue([mockRefreshRow]);
      mockConnExecute.mockResolvedValue([{ affectedRows: 1 }]);

      const result = await authService.refreshAccessToken('old-token');

      expect(result.auth.user).toEqual({
        id: 10,
        username: 'testuser',
        role: 'user',
        language: 'en',
        emailVerified: false,
        twoFactorEnabled: false,
      });
      expect(result.auth.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      // Revoke-old and insert-new run on the SAME transaction connection, so an INSERT failure
      // cannot leave the user with no valid refresh token. (audit B12)
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      expect(mockConnExecute).toHaveBeenCalledTimes(2);
      expect(mockConnExecute).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SET revoked = TRUE WHERE id = ? AND revoked = FALSE'),
        [5],
      );
      expect(mockConnExecute).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO refresh_tokens'),
        [10, 'hashed-token', expect.any(Date)],
      );
      // Nothing written outside the transaction.
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('rolls back the rotation when the insert fails, and rethrows', async () => {
      mockQuery.mockResolvedValue([mockRefreshRow]);
      mockConnExecute
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockRejectedValueOnce(new Error('ER_LOCK_WAIT_TIMEOUT'));
      // A real withTransaction rolls back and rethrows; the mock simply propagates.

      await expect(authService.refreshAccessToken('old-token')).rejects.toThrow(
        'ER_LOCK_WAIT_TIMEOUT',
      );
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('treats a lost compare-and-swap as reuse: revokes every token for the user', async () => {
      mockQuery.mockResolvedValue([mockRefreshRow]);
      mockConnExecute.mockResolvedValue([{ affectedRows: 0 }]);
      mockExecute.mockResolvedValue({ affectedRows: 3 });

      await expect(authService.refreshAccessToken('old-token')).rejects.toMatchObject({
        statusCode: 401,
        code: 'TOKEN_REUSE',
      });
      expect(mockConnExecute).toHaveBeenCalledTimes(1); // no INSERT after a failed CAS
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('SET revoked = TRUE WHERE user_id = ?'),
        [10],
      );
    });

    it('should throw 401 on invalid token (not found in DB)', async () => {
      mockQuery.mockResolvedValue([]);

      try {
        await authService.refreshAccessToken('bad-token');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as InstanceType<typeof AppError>).statusCode).toBe(401);
      }
    });

    it('should throw 401 and revoke ALL tokens on token reuse (revoked token)', async () => {
      mockQuery.mockResolvedValue([{ ...mockRefreshRow, revoked: true }]);
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      try {
        await authService.refreshAccessToken('reused-token');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as InstanceType<typeof AppError>).statusCode).toBe(401);
        // Should revoke all tokens for user
        const revokeCall = mockExecute.mock.calls.find(
          (call) =>
            typeof call[0] === 'string' &&
            (call[0] as string).includes('SET revoked = TRUE WHERE user_id'),
        );
        expect(revokeCall).toBeDefined();
      }
    });

    it('should throw 401 on expired token', async () => {
      mockQuery.mockResolvedValue([{ ...mockRefreshRow, expires_at: new Date(Date.now() - 1000) }]);

      try {
        await authService.refreshAccessToken('expired-token');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as InstanceType<typeof AppError>).statusCode).toBe(401);
      }
    });

    it('should throw 403 on deactivated user', async () => {
      mockQuery.mockResolvedValue([{ ...mockRefreshRow, is_deactivated: true }]);

      try {
        await authService.refreshAccessToken('some-token');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as InstanceType<typeof AppError>).statusCode).toBe(403);
      }
    });
  });

  describe('logout', () => {
    it('should revoke token by hash', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await authService.logout('my-refresh-token');

      expect(mockHashToken).toHaveBeenCalledWith('my-refresh-token');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('SET revoked = TRUE WHERE token_hash'),
        ['hashed-token'],
      );
    });
  });

  describe('verifyEmail', () => {
    it('should succeed when affectedRows is 1', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await expect(authService.verifyEmail('verify-token')).resolves.toBeUndefined();
      expect(mockHashToken).toHaveBeenCalledWith('verify-token');
    });

    it('should throw 400 on invalid token (affectedRows is 0)', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 0 });

      try {
        await authService.verifyEmail('bad-token');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as InstanceType<typeof AppError>).statusCode).toBe(400);
      }
    });
  });

  describe('resendVerificationEmail', () => {
    const unverified = {
      id: 10,
      email_hash: 'hashed-email',
      email_verified: false,
      language: 'de',
      verification_resend_count: 1,
    };

    it('counts the resend only after the email has actually been sent', async () => {
      // (audit B14) — the counter used to be bumped in the same UPDATE as the token, before the
      // SMTP call, so a delivery failure burned one of the three attempts.
      mockQuery.mockResolvedValue([unverified]);
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const result = await authService.resendVerificationEmail(10, 'Test@Example.com');

      expect(result).toEqual({ remainingResends: 1 });
      expect(mockSendVerificationEmail).toHaveBeenCalledWith(
        'test@example.com',
        'a'.repeat(64),
        'de',
      );

      const sqls = mockExecute.mock.calls.map((c) => String(c[0]));
      expect(sqls[0]).toContain('email_verify_token = ?');
      expect(sqls[0]).not.toContain('verification_resend_count');
      expect(sqls[1]).toContain('verification_resend_count = verification_resend_count + 1');
      // Order: token written, mail sent, THEN counted.
      const sendOrder = mockSendVerificationEmail.mock.invocationCallOrder[0];
      expect(mockExecute.mock.invocationCallOrder[0]).toBeLessThan(sendOrder);
      expect(mockExecute.mock.invocationCallOrder[1]).toBeGreaterThan(sendOrder);
    });

    it('does not burn an attempt when the email fails to send', async () => {
      mockQuery.mockResolvedValue([unverified]);
      mockExecute.mockResolvedValue({ affectedRows: 1 });
      mockSendVerificationEmail.mockRejectedValue(new Error('SMTP down'));

      await expect(authService.resendVerificationEmail(10, 'test@example.com')).rejects.toThrow(
        'SMTP down',
      );

      const sqls = mockExecute.mock.calls.map((c) => String(c[0]));
      expect(sqls.some((sql) => sql.includes('verification_resend_count + 1'))).toBe(false);
    });

    it('refuses once the limit is reached', async () => {
      mockQuery.mockResolvedValue([{ ...unverified, verification_resend_count: 3 }]);

      await expect(
        authService.resendVerificationEmail(10, 'test@example.com'),
      ).rejects.toMatchObject({ statusCode: 429, code: 'RESEND_LIMIT_REACHED' });
      expect(mockSendVerificationEmail).not.toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('should silently return on unknown email (no information leak)', async () => {
      mockQuery.mockResolvedValue([]);

      await expect(authService.forgotPassword('unknown@test.com')).resolves.toBeUndefined();
      expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('should revoke all refresh tokens after password change', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1, insertId: 10 });

      await authService.resetPassword('reset-token', 'newpassword');

      expect(mockHashPassword).toHaveBeenCalledWith('newpassword');
      // Should revoke all refresh tokens for the user (userId captured via LAST_INSERT_ID)
      const revokeCall = mockExecute.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          (call[0] as string).includes('SET revoked = TRUE WHERE user_id'),
      );
      expect(revokeCall).toBeDefined();
      expect(revokeCall![1]).toEqual([10]);
    });
  });

  describe('token types', () => {
    const userRow = {
      id: 10,
      username: 'testuser',
      password_hash: 'hashed',
      role: 'admin',
      language: 'en',
      is_deactivated: false,
      email_verified: true,
    };

    it('issues access tokens that verifyAccessToken accepts', async () => {
      mockQuery.mockResolvedValue([{ ...userRow, totp_enabled: false }]);
      mockExecute.mockResolvedValue({ affectedRows: 1 });
      const result = await authService.login('testuser', 'password');
      if (!('auth' in result)) throw new Error('expected a session');
      expect(verifyAccessToken(result.auth.accessToken).userId).toBe(10);
    });

    it('never accepts the 2FA challenge token as an access token', async () => {
      mockQuery.mockResolvedValue([{ ...userRow, totp_enabled: true }]);
      const result = await authService.login('testuser', 'password');
      if (!('totpToken' in result)) throw new Error('expected a challenge');
      expect(() => verifyAccessToken(result.totpToken)).toThrow();
    });

    it('never accepts local co-op tokens as access tokens', () => {
      for (const token of [
        authService.generateLocalCoopToken(10, 'p2', 1),
        authService.generateLocalCoopSocketToken(10, 'p2'),
        authService.generateLocalCoopTotpToken(10, 3, 1),
      ]) {
        expect(() => verifyAccessToken(token)).toThrow();
      }
    });

    it('binds the pending local co-op 2FA token to the host account', () => {
      const token = authService.generateLocalCoopTotpToken(10, 3, 6);
      expect(authService.verifyLocalCoopTotpToken(token, 3)).toEqual({ userId: 10, duration: 6 });
      expect(authService.verifyLocalCoopTotpToken(token, 4)).toBeNull();
    });

    it('refuses tokens signed with any algorithm but HS256', async () => {
      const secret = 'test-secret-key-that-is-at-least-32-chars-long';
      const hs512 = (claims: object) => jwt.sign(claims, secret, { algorithm: 'HS512' });
      expect(
        authService.verifyLocalCoopToken(
          hs512({ userId: 10, username: 'p2', purpose: 'local-coop-p2' }),
        ),
      ).toBeNull();
      expect(
        authService.verifyLocalCoopSocketToken(
          hs512({ userId: 10, username: 'p2', purpose: 'local-coop-socket' }),
        ),
      ).toBeNull();
      expect(
        authService.verifyLocalCoopTotpToken(
          hs512({ userId: 10, hostUserId: 3, duration: 6, purpose: 'local-coop-totp' }),
          3,
        ),
      ).toBeNull();
      await expect(
        authService.completeTotpLogin(
          hs512({ userId: 10, username: 'testuser', role: 'admin', purpose: 'totp-challenge' }),
          '123456',
        ),
      ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    });
  });
});

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockQuery = jest.fn<(...args: any[]) => Promise<any>>();
const mockExecute = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
}));

const mockHashPassword = jest.fn<(password: string) => Promise<string>>();
const mockComparePassword = jest.fn<(password: string, hash: string) => Promise<boolean>>();
const mockGenerateToken = jest.fn<() => string>();
const mockHashToken = jest.fn<(token: string) => string>();
const mockHashEmail = jest.fn<(email: string, pepper: string) => string>();
const mockGenerateEmailHint = jest.fn<(email: string) => string>();
jest.mock('../../../backend/src/utils/crypto', () => ({
  hashPassword: mockHashPassword,
  comparePassword: mockComparePassword,
  generateToken: mockGenerateToken,
  hashToken: mockHashToken,
  hashEmail: mockHashEmail,
  generateEmailHint: mockGenerateEmailHint,
}));

const mockSendVerificationEmail = jest.fn<(...args: any[]) => Promise<void>>();
const mockSendPasswordResetEmail = jest.fn<(...args: any[]) => Promise<void>>();
const mockSendEmailTakenRegistrationWarning = jest.fn<(...args: any[]) => Promise<void>>();
jest.mock('../../../backend/src/services/email', () => ({
  sendVerificationEmail: mockSendVerificationEmail,
  sendPasswordResetEmail: mockSendPasswordResetEmail,
  sendEmailTakenRegistrationWarning: mockSendEmailTakenRegistrationWarning,
}));

jest.mock('../../../backend/src/config', () => ({
  getConfig: () => ({
    JWT_SECRET: 'test-secret-key-that-is-at-least-32-chars-long',
    JWT_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    EMAIL_PEPPER: 'test-pepper-minimum-32-characters-long',
  }),
}));

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));
/* eslint-enable @typescript-eslint/no-explicit-any */

import * as authService from '../../../backend/src/services/auth';
import { AppError } from '../../../backend/src/middleware/errorHandler';

describe('Auth Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    it('should return user object and accessToken on success', async () => {
      mockQuery.mockResolvedValueOnce([]); // username check
      mockQuery.mockResolvedValueOnce([]); // email check
      mockExecute.mockResolvedValue({ insertId: 42, affectedRows: 1 });

      const result = await authService.register('newuser', 'new@test.com', 'password123');

      expect(result.user).toEqual({
        id: 42,
        username: 'newuser',
        role: 'user',
        language: 'en',
        emailVerified: false,
        twoFactorEnabled: false,
      });
      expect(result.accessToken).toBeDefined();
      expect(typeof result.accessToken).toBe('string');
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

    it('should throw generic 400 on duplicate email without revealing existence', async () => {
      mockQuery.mockResolvedValueOnce([]); // username free
      mockQuery.mockResolvedValueOnce([{ id: 1, language: 'de' }]); // email taken

      try {
        await authService.register('newuser', 'taken@test.com', 'pass');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as InstanceType<typeof AppError>).statusCode).toBe(400);
        expect((err as InstanceType<typeof AppError>).message).toBe(
          'Registration could not be completed',
        );
      }
      expect(mockSendEmailTakenRegistrationWarning).toHaveBeenCalledWith('taken@test.com', 'de');
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

      expect(result.user).toBeDefined();
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
      mockExecute.mockResolvedValue({ affectedRows: 1 });

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
      // Should revoke old token and insert new one
      expect(mockExecute).toHaveBeenCalledTimes(2);
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
});

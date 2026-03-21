import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();
const mockWithTransaction = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
  withTransaction: mockWithTransaction,
}));

const mockComparePassword = jest.fn<AnyFn>();
const mockHashPassword = jest.fn<AnyFn>();
const mockGenerateToken = jest.fn<AnyFn>();
const mockHashToken = jest.fn<AnyFn>();
jest.mock('../../../backend/src/utils/crypto', () => ({
  comparePassword: mockComparePassword,
  hashPassword: mockHashPassword,
  generateToken: mockGenerateToken,
  hashToken: mockHashToken,
}));

const mockSendEmailChangeEmail = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/email', () => ({
  sendEmailChangeEmail: mockSendEmailChangeEmail,
}));

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
}));

import {
  getUserProfile,
  updateUsername,
  requestEmailChange,
  confirmEmailChange,
  changePassword,
  cancelEmailChange,
} from '../../../backend/src/services/user';

import { AppError } from '../../../backend/src/middleware/errorHandler';

describe('user service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── getUserProfile ──────────────────────────────────────────────────

  describe('getUserProfile', () => {
    it('returns formatted profile with stats', async () => {
      const row = {
        id: 1,
        username: 'alice',
        email: 'alice@example.com',
        role: 'user',
        email_verified: true,
        pending_email: null,
        created_at: new Date('2025-01-01'),
        total_matches: 50,
        total_wins: 20,
        total_kills: 100,
        total_deaths: 30,
        total_bombs: 200,
        total_powerups: 80,
        total_playtime: 3600,
        win_streak: 3,
        best_win_streak: 7,
        elo_rating: 1250,
        peak_elo: 1300,
        is_profile_public: true,
        accept_friend_requests: true,
      };
      mockQuery.mockResolvedValueOnce([row]);

      const profile = await getUserProfile(1);

      expect(profile).toEqual({
        id: 1,
        username: 'alice',
        email: 'alice@example.com',
        role: 'user',
        emailVerified: true,
        pendingEmail: null,
        createdAt: new Date('2025-01-01'),
        stats: {
          totalMatches: 50,
          totalWins: 20,
          totalKills: 100,
          totalDeaths: 30,
          totalBombs: 200,
          totalPowerups: 80,
          totalPlaytime: 3600,
          winStreak: 3,
          bestWinStreak: 7,
          eloRating: 1250,
          peakElo: 1300,
        },
        isProfilePublic: true,
        acceptFriendRequests: true,
      });
    });

    it('returns default 0 stats when user_stats columns are null', async () => {
      const row = {
        id: 2,
        username: 'newuser',
        email: 'new@example.com',
        role: 'user',
        email_verified: false,
        pending_email: null,
        created_at: new Date('2025-06-01'),
        total_matches: null,
        total_wins: null,
        total_kills: null,
        total_deaths: null,
        total_bombs: null,
        total_powerups: null,
        total_playtime: null,
        win_streak: null,
        best_win_streak: null,
        elo_rating: null,
        peak_elo: null,
      };
      mockQuery.mockResolvedValueOnce([row]);

      const profile = await getUserProfile(2);

      expect(profile.stats).toEqual({
        totalMatches: 0,
        totalWins: 0,
        totalKills: 0,
        totalDeaths: 0,
        totalBombs: 0,
        totalPowerups: 0,
        totalPlaytime: 0,
        winStreak: 0,
        bestWinStreak: 0,
        eloRating: 1000,
        peakElo: 1000,
      });
    });

    it('throws 404 when user not found', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const promise = getUserProfile(999);
      await expect(promise).rejects.toThrow(AppError);
      await expect(promise).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    });
  });

  // ── updateUsername ──────────────────────────────────────────────────

  describe('updateUsername', () => {
    it('updates username when not taken', async () => {
      mockQuery.mockResolvedValueOnce([]); // no existing user
      mockExecute.mockResolvedValueOnce({});

      await updateUsername(1, 'newname');

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT id FROM users WHERE username = ? AND id != ?',
        ['newname', 1],
      );
      expect(mockExecute).toHaveBeenCalledWith('UPDATE users SET username = ? WHERE id = ?', [
        'newname',
        1,
      ]);
    });

    it('throws 409 on duplicate username', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 2 }]); // another user has this name

      const promise = updateUsername(1, 'taken');
      await expect(promise).rejects.toThrow(AppError);
      await expect(promise).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
      });
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ── requestEmailChange ─────────────────────────────────────────────

  describe('requestEmailChange', () => {
    it('stores hashed token and sends email on success', async () => {
      mockQuery.mockResolvedValueOnce([]); // email not used
      mockQuery.mockResolvedValueOnce([]); // pending_email not used
      mockGenerateToken.mockReturnValue('raw-token-123');
      mockHashToken.mockReturnValue('hashed-token-abc');
      mockExecute.mockResolvedValueOnce({});
      mockSendEmailChangeEmail.mockResolvedValueOnce(undefined);

      await requestEmailChange(1, 'newemail@example.com');

      expect(mockGenerateToken).toHaveBeenCalled();
      expect(mockHashToken).toHaveBeenCalledWith('raw-token-123');
      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE users SET pending_email = ?, email_change_token = ?, email_change_expires = ? WHERE id = ?',
        ['newemail@example.com', 'hashed-token-abc', expect.any(Date), 1],
      );
      expect(mockSendEmailChangeEmail).toHaveBeenCalledWith(
        'newemail@example.com',
        'raw-token-123',
      );
    });

    it('throws 409 when email is already used by another user', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 2 }]); // email in use

      const promise = requestEmailChange(1, 'taken@example.com');
      await expect(promise).rejects.toThrow(AppError);
      await expect(promise).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
      });
    });

    it('throws 409 when email is pending for another user', async () => {
      mockQuery.mockResolvedValueOnce([]); // email column clear
      mockQuery.mockResolvedValueOnce([{ id: 3 }]); // pending_email in use

      const promise = requestEmailChange(1, 'pending@example.com');
      await expect(promise).rejects.toThrow(AppError);
      await expect(promise).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
      });
    });
  });

  // ── confirmEmailChange ─────────────────────────────────────────────

  describe('confirmEmailChange', () => {
    let mockConnExecute: jest.Mock<AnyFn>;

    beforeEach(() => {
      mockConnExecute = jest.fn<AnyFn>();
      mockWithTransaction.mockImplementation(async (fn: AnyFn) => fn({ execute: mockConnExecute }));
    });

    it('updates email and clears pending fields on valid token', async () => {
      mockHashToken.mockReturnValue('hashed-token');
      const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1h from now
      // conn.execute returns [rows, fields] tuples
      mockConnExecute.mockResolvedValueOnce([
        [{ id: 5, pending_email: 'new@example.com', email_change_expires: futureDate }],
      ]);
      mockConnExecute.mockResolvedValueOnce([[]]); // no conflict
      mockConnExecute.mockResolvedValueOnce([{}]); // update result

      await confirmEmailChange('some-token');

      expect(mockHashToken).toHaveBeenCalledWith('some-token');
      expect(mockConnExecute).toHaveBeenCalledWith(
        'UPDATE users SET email = ?, email_verified = TRUE, pending_email = NULL, email_change_token = NULL, email_change_expires = NULL WHERE id = ?',
        ['new@example.com', 5],
      );
    });

    it('throws 400 INVALID_TOKEN when token not found', async () => {
      mockHashToken.mockReturnValue('bad-hash');
      mockConnExecute.mockResolvedValueOnce([[]]); // no matching row

      const promise = confirmEmailChange('bad-token');
      await expect(promise).rejects.toThrow(AppError);
      await expect(promise).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_TOKEN',
      });
    });

    it('throws 400 TOKEN_EXPIRED when token is expired', async () => {
      mockHashToken.mockReturnValue('hashed-token');
      const pastDate = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
      mockConnExecute.mockResolvedValueOnce([
        [{ id: 5, pending_email: 'new@example.com', email_change_expires: pastDate }],
      ]);
      mockConnExecute.mockResolvedValueOnce([{}]); // cleanup update

      const promise = confirmEmailChange('expired-token');
      await expect(promise).rejects.toThrow(AppError);
      await expect(promise).rejects.toMatchObject({
        statusCode: 400,
        code: 'TOKEN_EXPIRED',
      });
    });

    it('throws 409 on race condition when email taken at confirmation time', async () => {
      mockHashToken.mockReturnValue('hashed-token');
      const futureDate = new Date(Date.now() + 60 * 60 * 1000);
      mockConnExecute.mockResolvedValueOnce([
        [{ id: 5, pending_email: 'race@example.com', email_change_expires: futureDate }],
      ]);
      mockConnExecute.mockResolvedValueOnce([[{ id: 99 }]]); // conflict found
      mockConnExecute.mockResolvedValueOnce([{}]); // cleanup update

      const promise = confirmEmailChange('race-token');
      await expect(promise).rejects.toThrow(AppError);
      await expect(promise).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
      });
    });
  });

  // ── changePassword ─────────────────────────────────────────────────

  describe('changePassword', () => {
    it('updates password hash on success', async () => {
      mockQuery.mockResolvedValueOnce([{ password_hash: 'old-hash' }]);
      mockComparePassword.mockResolvedValueOnce(true);
      mockHashPassword.mockResolvedValueOnce('new-hash');
      mockExecute.mockResolvedValueOnce({});

      await changePassword(1, 'currentPass', 'newPass');

      expect(mockComparePassword).toHaveBeenCalledWith('currentPass', 'old-hash');
      expect(mockHashPassword).toHaveBeenCalledWith('newPass');
      expect(mockExecute).toHaveBeenCalledWith('UPDATE users SET password_hash = ? WHERE id = ?', [
        'new-hash',
        1,
      ]);
    });

    it('throws 401 when current password is wrong', async () => {
      mockQuery.mockResolvedValueOnce([{ password_hash: 'old-hash' }]);
      mockComparePassword.mockResolvedValueOnce(false);

      const promise = changePassword(1, 'wrongPass', 'newPass');
      await expect(promise).rejects.toThrow(AppError);
      await expect(promise).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_PASSWORD',
      });
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('throws 404 when user not found', async () => {
      mockQuery.mockResolvedValueOnce([]); // no user

      const promise = changePassword(999, 'pass', 'newpass');
      await expect(promise).rejects.toThrow(AppError);
      await expect(promise).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    });
  });

  // ── cancelEmailChange ──────────────────────────────────────────────

  describe('cancelEmailChange', () => {
    it('calls execute to clear pending email fields', async () => {
      mockExecute.mockResolvedValueOnce({});

      await cancelEmailChange(1);

      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE users SET pending_email = NULL, email_change_token = NULL, email_change_expires = NULL WHERE id = ?',
        [1],
      );
    });
  });
});

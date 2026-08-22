import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mocks BEFORE imports
type AnyFn = (...args: any[]) => any;
const mockQuery = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
}));

const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
jest.mock('../../../backend/src/utils/logger', () => ({ logger: mockLogger }));

import { emailVerifiedMiddleware } from '../../../backend/src/middleware/emailVerified';

function createMockRes() {
  const res = {
    status: jest.fn().mockReturnThis() as jest.Mock,
    json: jest.fn() as jest.Mock,
  };
  return res;
}

describe('emailVerifiedMiddleware', () => {
  let mockReq: any;
  let mockRes: ReturnType<typeof createMockRes>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {};
    mockRes = createMockRes();
    mockNext = jest.fn();
  });

  it('should return 401 with UNAUTHORIZED when req.user is undefined', async () => {
    mockReq.user = undefined;

    await emailVerifiedMiddleware(mockReq, mockRes as any, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Authentication required',
      code: 'UNAUTHORIZED',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 with UNAUTHORIZED when req.user is null', async () => {
    mockReq.user = null;

    await emailVerifiedMiddleware(mockReq, mockRes as any, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Authentication required',
      code: 'UNAUTHORIZED',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 with USER_NOT_FOUND when DB returns empty array', async () => {
    mockReq.user = { userId: 999, username: 'ghost', role: 'user' };
    mockQuery.mockResolvedValue([]);

    await emailVerifiedMiddleware(mockReq, mockRes as any, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'User not found',
      code: 'USER_NOT_FOUND',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 403 with EMAIL_NOT_VERIFIED when email_verified is false', async () => {
    mockReq.user = { userId: 1, username: 'player', role: 'user' };
    mockQuery.mockResolvedValue([{ email_verified: false }]);

    await emailVerifiedMiddleware(mockReq, mockRes as any, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Email not verified',
      code: 'EMAIL_NOT_VERIFIED',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should call next() when email_verified is true', async () => {
    mockReq.user = { userId: 1, username: 'player', role: 'user' };
    mockQuery.mockResolvedValue([{ email_verified: true }]);

    await emailVerifiedMiddleware(mockReq, mockRes as any, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockRes.status).not.toHaveBeenCalled();
    expect(mockRes.json).not.toHaveBeenCalled();
  });

  it('should query DB with the correct userId parameter', async () => {
    mockReq.user = { userId: 42, username: 'player42', role: 'user' };
    mockQuery.mockResolvedValue([{ email_verified: true }]);

    await emailVerifiedMiddleware(mockReq, mockRes as any, mockNext);

    expect(mockQuery).toHaveBeenCalledWith('SELECT email_verified FROM users WHERE id = ?', [42]);
  });

  it('should return 500 with INTERNAL_ERROR when DB query throws', async () => {
    mockReq.user = { userId: 1, username: 'player', role: 'user' };
    mockQuery.mockRejectedValue(new Error('Connection lost'));

    await emailVerifiedMiddleware(mockReq, mockRes as any, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should not call next() when req.user is undefined (401 path)', async () => {
    mockReq.user = undefined;

    await emailVerifiedMiddleware(mockReq, mockRes as any, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should not call next() when user not found in DB (401 path)', async () => {
    mockReq.user = { userId: 888, username: 'missing', role: 'user' };
    mockQuery.mockResolvedValue([]);

    await emailVerifiedMiddleware(mockReq, mockRes as any, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'User not found',
      code: 'USER_NOT_FOUND',
    });
  });

  it('should not call next() on the 403 EMAIL_NOT_VERIFIED path', async () => {
    mockReq.user = { userId: 2, username: 'unverified', role: 'user' };
    mockQuery.mockResolvedValue([{ email_verified: false }]);

    await emailVerifiedMiddleware(mockReq, mockRes as any, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Email not verified',
      code: 'EMAIL_NOT_VERIFIED',
    });
  });

  // Was a bare `catch {}` — the 500 went out with no record of what failed.
  // (audit APPERROR-LOG-1)
  it('records why the check failed, without telling the client', async () => {
    mockQuery.mockRejectedValue(new Error('ER_LOCK_WAIT_TIMEOUT: lock wait timeout exceeded'));

    mockReq.user = { userId: 3, username: 'player', role: 'user' };

    await emailVerifiedMiddleware(mockReq, mockRes as any, mockNext);

    expect(mockLogger.error).toHaveBeenCalledWith(
      { err: 'ER_LOCK_WAIT_TIMEOUT: lock wait timeout exceeded', userId: 3 },
      'Email verification check failed',
    );
    // ...and the client is still told nothing.
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  });

  it('should not call next() on the 500 INTERNAL_ERROR path', async () => {
    mockReq.user = { userId: 3, username: 'player', role: 'user' };
    mockQuery.mockRejectedValue(new Error('ECONNREFUSED'));

    await emailVerifiedMiddleware(mockReq, mockRes as any, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  });

  // The flag now normally rides on the access token, so the common path costs no query at all.
  // Legacy tokens (signed before the claim existed) must still fall back to the database rather
  // than be treated as unverified. (audit EMAILVERIFIED-CLAIM-1)
  describe('emailVerified claim', () => {
    it('passes without touching the database when the claim is true', async () => {
      mockReq.user = { userId: 1, username: 'a', role: 'user', emailVerified: true };

      await emailVerifiedMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('rejects without touching the database when the claim is false', async () => {
      mockReq.user = { userId: 1, username: 'a', role: 'user', emailVerified: false };

      await emailVerifiedMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('falls back to the database for a legacy token with no claim', async () => {
      mockQuery.mockResolvedValue([{ email_verified: 1 }]);
      mockReq.user = { userId: 1, username: 'a', role: 'user' };

      await emailVerifiedMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockQuery).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('still catches a deleted user on the fallback path', async () => {
      mockQuery.mockResolvedValue([]);
      mockReq.user = { userId: 99, username: 'gone', role: 'user' };

      await emailVerifiedMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });
});

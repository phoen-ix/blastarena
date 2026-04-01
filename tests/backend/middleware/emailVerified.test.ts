import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mocks BEFORE imports
type AnyFn = (...args: any[]) => any;
const mockQuery = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
}));

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
});

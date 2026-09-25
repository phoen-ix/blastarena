import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockVerify = jest.fn();
jest.mock('jsonwebtoken', () => ({
  verify: mockVerify,
}));

jest.mock('../../../backend/src/config', () => ({
  getConfig: () => ({
    JWT_SECRET: 'test-secret-key-that-is-at-least-32-chars-long',
  }),
}));

// The admin middlewares re-read the role from the users table (audit B18).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockQuery = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
}));

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import { authMiddleware } from '../../../backend/src/middleware/auth';
import { staffMiddleware, adminOnlyMiddleware } from '../../../backend/src/middleware/admin';

function createMockRes() {
  const res = {
    status: jest.fn().mockReturnThis() as jest.Mock,
    json: jest.fn() as jest.Mock,
    locals: {} as Record<string, unknown>,
  };
  return res;
}

/** users row the middleware reads: role + deactivation flag. */
function dbUser(role: string, is_deactivated = 0) {
  return [{ role, is_deactivated }];
}

describe('Auth & Admin Middleware', () => {
  let mockReq: any;
  let mockRes: ReturnType<typeof createMockRes>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = { headers: {} };
    mockRes = createMockRes();
    mockNext = jest.fn();
  });

  describe('authMiddleware', () => {
    it('should set req.user and call next() on valid Bearer token', () => {
      const payload = { userId: 1, username: 'admin', role: 'admin' };
      mockVerify.mockReturnValue(payload);
      mockReq.headers.authorization = 'Bearer valid-token';

      authMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockReq.user).toEqual(payload);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('accepts an access token and a legacy token without typ', () => {
      for (const payload of [
        { userId: 1, username: 'a', role: 'user', typ: 'access' },
        { userId: 1, username: 'a', role: 'user' },
      ]) {
        mockVerify.mockReturnValue(payload);
        mockReq.headers.authorization = 'Bearer t';
        mockNext.mockClear();
        authMiddleware(mockReq, mockRes as any, mockNext);
        expect(mockNext).toHaveBeenCalled();
      }
    });

    it('refuses tokens issued for another purpose', () => {
      for (const payload of [
        { userId: 1, username: 'a', role: 'user', purpose: 'totp-challenge' },
        { userId: 1, username: 'a', purpose: 'local-coop-socket' },
        { userId: 1, username: 'a', typ: 'refresh' },
      ]) {
        mockVerify.mockReturnValue(payload);
        mockReq.headers.authorization = 'Bearer t';
        mockNext.mockClear();
        mockRes.status.mockClear();
        authMiddleware(mockReq, mockRes as any, mockNext);
        expect(mockNext).not.toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(401);
      }
    });

    it('should return 401 when Authorization header is missing', () => {
      authMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHORIZED' }));
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 on malformed token without Bearer prefix', () => {
      mockReq.headers.authorization = 'Basic some-token';

      authMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when jwt.verify throws (expired/invalid)', () => {
      mockReq.headers.authorization = 'Bearer expired-token';
      mockVerify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      authMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_TOKEN' }));
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next() on success without sending a response', () => {
      const payload = { userId: 5, username: 'player', role: 'user' };
      mockVerify.mockReturnValue(payload);
      mockReq.headers.authorization = 'Bearer good-token';

      authMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });
  });

  describe('staffMiddleware', () => {
    it('should allow admin role and call next()', async () => {
      mockReq.user = { userId: 1, username: 'admin', role: 'admin' };
      mockQuery.mockResolvedValue(dbUser('admin'));

      await staffMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM users WHERE id = ?'),
        [1],
      );
    });

    it('should allow moderator role and call next()', async () => {
      mockReq.user = { userId: 2, username: 'mod', role: 'moderator' };
      mockQuery.mockResolvedValue(dbUser('moderator'));

      await staffMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 403 for user role', async () => {
      mockReq.user = { userId: 3, username: 'player', role: 'user' };
      mockQuery.mockResolvedValue(dbUser('user'));

      await staffMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 403 when req.user is undefined', async () => {
      mockReq.user = undefined;

      await staffMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    // (audit B18) — the database, not the token claim, decides.
    it('uses the database role, not the JWT claim: demoted admin is refused', async () => {
      mockReq.user = { userId: 1, username: 'ex-admin', role: 'admin' };
      mockQuery.mockResolvedValue(dbUser('user'));

      await staffMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('uses the database role, not the JWT claim: freshly promoted user is allowed', async () => {
      mockReq.user = { userId: 1, username: 'new-mod', role: 'user' };
      mockQuery.mockResolvedValue(dbUser('moderator'));

      await staffMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
      // Downstream handlers see the live role.
      expect(mockReq.user.role).toBe('moderator');
    });

    it('refuses a deactivated account even if the token says admin', async () => {
      mockReq.user = { userId: 1, username: 'admin', role: 'admin' };
      mockQuery.mockResolvedValue(dbUser('admin', 1));

      await staffMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'DEACTIVATED' }));
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 401 when the user row is gone', async () => {
      mockReq.user = { userId: 404, username: 'ghost', role: 'admin' };
      mockQuery.mockResolvedValue([]);

      await staffMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 500 and does not call next() when the lookup fails', async () => {
      mockReq.user = { userId: 1, username: 'admin', role: 'admin' };
      mockQuery.mockRejectedValue(new Error('DB down'));

      await staffMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('looks the role up once per request when chained with adminOnlyMiddleware', async () => {
      mockReq.user = { userId: 1, username: 'admin', role: 'admin' };
      mockQuery.mockResolvedValue(dbUser('admin'));

      await staffMiddleware(mockReq, mockRes as any, mockNext);
      await adminOnlyMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('adminOnlyMiddleware', () => {
    it('should allow admin role and call next()', async () => {
      mockReq.user = { userId: 1, username: 'admin', role: 'admin' };
      mockQuery.mockResolvedValue(dbUser('admin'));

      await adminOnlyMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 403 for moderator role', async () => {
      mockReq.user = { userId: 2, username: 'mod', role: 'moderator' };
      mockQuery.mockResolvedValue(dbUser('moderator'));

      await adminOnlyMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 403 for user role', async () => {
      mockReq.user = { userId: 3, username: 'player', role: 'user' };
      mockQuery.mockResolvedValue(dbUser('user'));

      await adminOnlyMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('refuses a demoted admin whose token still says admin', async () => {
      mockReq.user = { userId: 1, username: 'ex-admin', role: 'admin' };
      mockQuery.mockResolvedValue(dbUser('moderator'));

      await adminOnlyMiddleware(mockReq, mockRes as any, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});

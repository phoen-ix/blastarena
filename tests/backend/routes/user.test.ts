import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

const mockGetUserProfile = jest.fn<AnyFn>();
const mockUpdateUsername = jest.fn<AnyFn>();
const mockRequestEmailChange = jest.fn<AnyFn>();
const mockUpdateEmailDirect = jest.fn<AnyFn>();
const mockChangePassword = jest.fn<AnyFn>();
const mockCancelEmailChange = jest.fn<AnyFn>();
const mockConfirmEmailChange = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/user', () => ({
  getUserProfile: mockGetUserProfile,
  updateUsername: mockUpdateUsername,
  requestEmailChange: mockRequestEmailChange,
  updateEmailDirect: mockUpdateEmailDirect,
  changePassword: mockChangePassword,
  cancelEmailChange: mockCancelEmailChange,
  confirmEmailChange: mockConfirmEmailChange,
}));

jest.mock('../../../backend/src/services/totp', () => ({
  beginSetup: jest.fn(),
  confirmSetup: jest.fn(),
  disable: jest.fn(),
}));

jest.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: jest.fn((_req: any, _res: any, next: any) => next()),
}));

jest.mock('../../../backend/src/middleware/rateLimiter', () => ({
  rateLimiter: jest.fn(() => (_req: any, _res: any, next: any) => next()),
}));

jest.mock('../../../backend/src/middleware/validation', () => ({
  validate: jest.fn(() => (_req: any, _res: any, next: any) => next()),
}));

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import userRouter from '../../../backend/src/routes/user';
import { authMiddleware } from '../../../backend/src/middleware/auth';
import { Request, Response, NextFunction } from 'express';

type RouteLayer = {
  route: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: Function }>;
  };
};

function getHandler(method: string, path: string) {
  const stack = (userRouter as any).stack as RouteLayer[];
  const layer = stack.find((l) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  const routeStack = layer.route.stack;
  return routeStack[routeStack.length - 1].handle;
}

function mockRes() {
  const data: { _status: number; _json: unknown } = { _status: 200, _json: null };
  const res: any = {
    get _status() {
      return data._status;
    },
    get _json() {
      return data._json;
    },
    status(code: number) {
      data._status = code;
      return res;
    },
    json(body: unknown) {
      data._json = body;
      return res;
    },
  };
  jest.spyOn(res, 'status');
  jest.spyOn(res, 'json');
  return res;
}

function mockReq(overrides: Record<string, any> = {}): any {
  return {
    user: { userId: 42, username: 'testuser', role: 'user' },
    body: {},
    params: {},
    ...overrides,
  };
}

describe('User routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /user/profile', () => {
    const handler = getHandler('get', '/user/profile');

    it('returns profile data on success', async () => {
      const profile = { id: 42, username: 'testuser', email: 'test@example.com' };
      mockGetUserProfile.mockResolvedValue(profile);

      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(res._json).toEqual(profile);
    });

    it('passes userId from req.user to getUserProfile', async () => {
      mockGetUserProfile.mockResolvedValue({});

      const req = mockReq({ user: { userId: 99, username: 'other', role: 'user' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetUserProfile).toHaveBeenCalledWith(99);
    });

    it('passes error to next() on service failure', async () => {
      const error = new Error('DB down');
      mockGetUserProfile.mockRejectedValue(error);

      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('PUT /user/profile', () => {
    const handler = getHandler('put', '/user/profile');

    it('updates username and returns updated profile', async () => {
      const updatedProfile = { id: 42, username: 'newname', email: 'test@example.com' };
      mockUpdateUsername.mockResolvedValue(undefined);
      mockGetUserProfile.mockResolvedValue(updatedProfile);

      const req = mockReq({ body: { username: 'newname' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockUpdateUsername).toHaveBeenCalledWith(42, 'newname');
      expect(res._json).toEqual(updatedProfile);
    });

    it('returns 400 for invalid username when validateUsername returns error', async () => {
      const req = mockReq({ body: { username: 'x' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(res._status).toBe(400);
      expect(res._json).toEqual({ error: expect.any(String) });
      expect(mockUpdateUsername).not.toHaveBeenCalled();
    });

    it('skips update when username is not provided', async () => {
      const profile = { id: 42, username: 'testuser', email: 'test@example.com' };
      mockGetUserProfile.mockResolvedValue(profile);

      const req = mockReq({ body: {} });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockUpdateUsername).not.toHaveBeenCalled();
      expect(mockGetUserProfile).toHaveBeenCalledWith(42);
      expect(res._json).toEqual(profile);
    });

    it('calls getUserProfile after update for fresh data', async () => {
      const callOrder: string[] = [];
      mockUpdateUsername.mockImplementation(async () => {
        callOrder.push('updateUsername');
      });
      mockGetUserProfile.mockImplementation(async () => {
        callOrder.push('getUserProfile');
        return { id: 42, username: 'fresh' };
      });

      const req = mockReq({ body: { username: 'ValidName' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(callOrder).toEqual(['updateUsername', 'getUserProfile']);
      expect(mockGetUserProfile).toHaveBeenCalledWith(42);
    });

    it('passes error to next() on service failure', async () => {
      const error = new Error('Username taken');
      mockUpdateUsername.mockRejectedValue(error);

      const req = mockReq({ body: { username: 'ValidName' } });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('POST /user/email', () => {
    const handler = getHandler('post', '/user/email');

    it('admin: calls updateEmailDirect and returns direct update message', async () => {
      mockUpdateEmailDirect.mockResolvedValue(undefined);

      const req = mockReq({
        user: { userId: 1, username: 'admin', role: 'admin' },
        body: { email: 'new@example.com' },
      });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockUpdateEmailDirect).toHaveBeenCalledWith(1, 'new@example.com');
      expect(mockRequestEmailChange).not.toHaveBeenCalled();
      expect(res._json).toEqual({ message: 'Email address updated.' });
    });

    it('non-admin: calls requestEmailChange and returns confirmation message', async () => {
      mockRequestEmailChange.mockResolvedValue(undefined);

      const req = mockReq({ body: { email: 'new@example.com' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockRequestEmailChange).toHaveBeenCalledWith(42, 'new@example.com', 'en');
      expect(mockUpdateEmailDirect).not.toHaveBeenCalled();
      expect(res._json).toEqual({
        message: 'Confirmation email sent to your new address. The link expires in 24 hours.',
      });
    });

    it('returns 400 for invalid email when validateEmailFn returns error', async () => {
      const req = mockReq({ body: { email: 'not-an-email' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(res._status).toBe(400);
      expect(res._json).toEqual({ error: expect.any(String) });
      expect(mockRequestEmailChange).not.toHaveBeenCalled();
      expect(mockUpdateEmailDirect).not.toHaveBeenCalled();
    });

    it('passes correct userId to email service calls', async () => {
      mockRequestEmailChange.mockResolvedValue(undefined);

      const req = mockReq({
        user: { userId: 77, username: 'someone', role: 'user' },
        body: { email: 'valid@test.com' },
      });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockRequestEmailChange).toHaveBeenCalledWith(77, 'valid@test.com', 'en');
    });

    it('passes error to next() on service failure', async () => {
      const error = new Error('SMTP error');
      mockRequestEmailChange.mockRejectedValue(error);

      const req = mockReq({ body: { email: 'valid@test.com' } });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('POST /user/password', () => {
    const handler = getHandler('post', '/user/password');

    it('returns success message on valid password change', async () => {
      mockChangePassword.mockResolvedValue(undefined);

      const req = mockReq({
        body: { currentPassword: 'OldPass123!', newPassword: 'NewPass456!' },
      });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(res._json).toEqual({ message: 'Password updated successfully' });
    });

    it('returns 400 when current password equals new password', async () => {
      const req = mockReq({
        body: { currentPassword: 'SamePass123!', newPassword: 'SamePass123!' },
      });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(res._status).toBe(400);
      expect(res._json).toEqual({
        error: 'New password must be different from current password',
      });
      expect(mockChangePassword).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid new password when validatePassword returns error', async () => {
      const req = mockReq({
        body: { currentPassword: 'OldPass123!', newPassword: 'x' },
      });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(res._status).toBe(400);
      expect(res._json).toEqual({ error: expect.any(String) });
      expect(mockChangePassword).not.toHaveBeenCalled();
    });

    it('calls changePassword with correct arguments', async () => {
      mockChangePassword.mockResolvedValue(undefined);

      const req = mockReq({
        user: { userId: 55, username: 'pwuser', role: 'user' },
        body: { currentPassword: 'OldPass123!', newPassword: 'NewPass456!' },
      });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockChangePassword).toHaveBeenCalledWith(55, 'OldPass123!', 'NewPass456!');
    });

    it('passes error to next() on service failure', async () => {
      const error = new Error('Wrong password');
      mockChangePassword.mockRejectedValue(error);

      const req = mockReq({
        body: { currentPassword: 'OldPass123!', newPassword: 'NewPass456!' },
      });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('DELETE /user/email', () => {
    const handler = getHandler('delete', '/user/email');

    it('calls cancelEmailChange and returns success message', async () => {
      mockCancelEmailChange.mockResolvedValue(undefined);

      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockCancelEmailChange).toHaveBeenCalledWith(42);
      expect(res._json).toEqual({ message: 'Pending email change cancelled' });
    });

    it('passes error to next() on service failure', async () => {
      const error = new Error('No pending change');
      mockCancelEmailChange.mockRejectedValue(error);

      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('GET /user/confirm-email/:token', () => {
    const handler = getHandler('get', '/user/confirm-email/:token');

    it('calls confirmEmailChange with token and returns success message', async () => {
      mockConfirmEmailChange.mockResolvedValue(undefined);

      const req = mockReq({ params: { token: 'abc123token' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockConfirmEmailChange).toHaveBeenCalledWith('abc123token');
      expect(res._json).toEqual({ message: 'Email address updated successfully' });
    });

    it('passes error to next() on service failure', async () => {
      const error = new Error('Token expired');
      mockConfirmEmailChange.mockRejectedValue(error);

      const req = mockReq({ params: { token: 'badtoken' } });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('Middleware presence', () => {
    it('auth-protected routes include authMiddleware in their stack', () => {
      const stack = (userRouter as any).stack as RouteLayer[];
      const authRoutes = [
        { method: 'get', path: '/user/profile' },
        { method: 'put', path: '/user/profile' },
        { method: 'post', path: '/user/email' },
        { method: 'post', path: '/user/password' },
        { method: 'delete', path: '/user/email' },
      ];

      for (const { method, path } of authRoutes) {
        const layer = stack.find((l) => l.route?.path === path && l.route.methods[method]);
        expect(layer).toBeDefined();

        const handlers = layer!.route.stack.map((s) => s.handle);
        expect(handlers).toContain(authMiddleware);
      }
    });

    it('confirm-email route does not include authMiddleware', () => {
      const stack = (userRouter as any).stack as RouteLayer[];
      const layer = stack.find(
        (l) => l.route?.path === '/user/confirm-email/:token' && l.route.methods.get,
      );
      expect(layer).toBeDefined();

      const handlers = layer!.route.stack.map((s) => s.handle);
      expect(handlers).not.toContain(authMiddleware);
    });
  });
});

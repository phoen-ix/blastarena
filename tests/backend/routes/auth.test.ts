import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

// ---------------------------------------------------------------------------
// Mocks — declared before the router import so module‑level side effects
// in auth.ts see the fakes.
// ---------------------------------------------------------------------------

const mockRegister = jest.fn<AnyFn>();
const mockLogin = jest.fn<AnyFn>();
const mockLogout = jest.fn<AnyFn>();
const mockRefreshAccessToken = jest.fn<AnyFn>();
const mockVerifyEmail = jest.fn<AnyFn>();
const mockForgotPassword = jest.fn<AnyFn>();
const mockResetPassword = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/auth', () => ({
  register: mockRegister,
  login: mockLogin,
  logout: mockLogout,
  refreshAccessToken: mockRefreshAccessToken,
  verifyEmail: mockVerifyEmail,
  forgotPassword: mockForgotPassword,
  resetPassword: mockResetPassword,
}));

const mockIsRegistrationEnabled = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/settings', () => ({
  isRegistrationEnabled: mockIsRegistrationEnabled,
}));

const mockGetConfig = jest.fn<AnyFn>();

jest.mock('../../../backend/src/config', () => ({
  getConfig: mockGetConfig,
}));

// Middleware pass‑throughs — we test route handlers, not middleware.
const mockAuthMiddleware = jest.fn<AnyFn>((_req, _res, next) => next());

jest.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: mockAuthMiddleware,
}));

const mockRateLimiter = jest.fn<AnyFn>(() => (_req: any, _res: any, next: any) => next());

jest.mock('../../../backend/src/middleware/rateLimiter', () => ({
  rateLimiter: mockRateLimiter,
}));

const mockValidate = jest.fn<AnyFn>(() => (_req: any, _res: any, next: any) => next());

jest.mock('../../../backend/src/middleware/validation', () => ({
  validate: mockValidate,
}));

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Import the router under test (after all mocks are in place).
// ---------------------------------------------------------------------------

import authRouter from '../../../backend/src/routes/auth';
import { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RouteLayer = {
  route: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: Function; name?: string }>;
  };
};

/**
 * Extract the final handler (the actual route logic, after middleware) from
 * an Express Router for a given method + path.
 */
function getHandler(method: string, path: string) {
  const stack = (authRouter as any).stack as RouteLayer[];
  const layer = stack.find((l) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  const routeStack = layer.route.stack;
  return routeStack[routeStack.length - 1].handle;
}

/** Return the full route stack (middleware + handler) for a method+path. */
function getRouteStack(method: string, path: string) {
  const stack = (authRouter as any).stack as RouteLayer[];
  const layer = stack.find((l) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  return layer.route.stack;
}

function mockRes() {
  const data: {
    _status: number;
    _json: unknown;
    _cookie: any;
    _clearCookie: any;
  } = { _status: 200, _json: null, _cookie: null, _clearCookie: null };

  const res: any = {
    get _status() {
      return data._status;
    },
    get _json() {
      return data._json;
    },
    get _cookie() {
      return data._cookie;
    },
    get _clearCookie() {
      return data._clearCookie;
    },
    status(code: number) {
      data._status = code;
      return res;
    },
    json(body: unknown) {
      data._json = body;
      return res;
    },
    cookie(name: string, value: string, opts: any) {
      data._cookie = { name, value, opts };
      return res;
    },
    clearCookie(name: string, opts: any) {
      data._clearCookie = { name, opts };
      return res;
    },
  };
  return res;
}

function mockReq(overrides: Record<string, unknown> = {}): any {
  return { body: {}, params: {}, cookies: {}, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockGetConfig.mockReturnValue({ APP_URL: 'http://localhost:8080' });
});

// ============================== POST /auth/register ========================

describe('POST /auth/register', () => {
  let handler: Function;
  beforeEach(() => {
    handler = getHandler('post', '/auth/register');
  });

  it('returns 201 with registration result on success', async () => {
    mockIsRegistrationEnabled.mockResolvedValue(true);
    const result = { message: 'Registration successful' };
    mockRegister.mockResolvedValue(result);

    const req = mockReq({
      body: { username: 'testuser', email: 'test@example.com', password: 'password123' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(201);
    expect(res._json).toEqual(result);
  });

  it('returns 403 when registration is disabled', async () => {
    mockIsRegistrationEnabled.mockResolvedValue(false);

    const req = mockReq({
      body: { username: 'testuser', email: 'test@example.com', password: 'password123' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(403);
    expect(res._json).toEqual({ error: 'Registration is currently disabled' });
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid username', async () => {
    mockIsRegistrationEnabled.mockResolvedValue(true);

    const req = mockReq({
      body: { username: 'ab', email: 'test@example.com', password: 'password123' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(400);
    expect(res._json).toEqual(
      expect.objectContaining({ error: expect.stringContaining('Username') }),
    );
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid password', async () => {
    mockIsRegistrationEnabled.mockResolvedValue(true);

    const req = mockReq({
      body: { username: 'testuser', email: 'test@example.com', password: 'short' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(400);
    expect(res._json).toEqual(
      expect.objectContaining({ error: expect.stringContaining('Password') }),
    );
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid email', async () => {
    mockIsRegistrationEnabled.mockResolvedValue(true);

    const req = mockReq({
      body: { username: 'testuser', email: 'not-an-email', password: 'password123' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(400);
    expect(res._json).toEqual(
      expect.objectContaining({ error: expect.stringContaining('email') }),
    );
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('calls authService.register with correct arguments', async () => {
    mockIsRegistrationEnabled.mockResolvedValue(true);
    mockRegister.mockResolvedValue({ message: 'ok' });

    const req = mockReq({
      body: { username: 'alice', email: 'alice@example.com', password: 'securepass1' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockRegister).toHaveBeenCalledWith('alice', 'alice@example.com', 'securepass1');
  });

  it('passes error to next() on service failure', async () => {
    mockIsRegistrationEnabled.mockResolvedValue(true);
    const err = new Error('DB error');
    mockRegister.mockRejectedValue(err);

    const req = mockReq({
      body: { username: 'testuser', email: 'test@example.com', password: 'password123' },
    });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================== POST /auth/login ===========================

describe('POST /auth/login', () => {
  let handler: Function;
  beforeEach(() => {
    handler = getHandler('post', '/auth/login');
  });

  it('returns auth data and sets refresh token cookie on success', async () => {
    const authData = { accessToken: 'tok', user: { id: 1, username: 'u', role: 'user' } };
    mockLogin.mockResolvedValue({ auth: authData, refreshToken: 'rt_123' });

    const req = mockReq({ body: { username: 'u', password: 'p' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._json).toEqual(authData);
    expect(res._cookie).not.toBeNull();
    expect(res._cookie.name).toBe('refreshToken');
    expect(res._cookie.value).toBe('rt_123');
  });

  it('sets cookie with correct options (httpOnly, sameSite, path)', async () => {
    mockLogin.mockResolvedValue({ auth: {}, refreshToken: 'rt' });

    const req = mockReq({ body: { username: 'u', password: 'p' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    const opts = res._cookie.opts;
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('strict');
    expect(opts.path).toBe('/api/auth');
    expect(opts.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('sets secure flag based on APP_URL (http = false, https = true)', async () => {
    // HTTP
    mockGetConfig.mockReturnValue({ APP_URL: 'http://localhost:8080' });
    mockLogin.mockResolvedValue({ auth: {}, refreshToken: 'rt' });

    let req = mockReq({ body: { username: 'u', password: 'p' } });
    let res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._cookie.opts.secure).toBe(false);

    // HTTPS
    mockGetConfig.mockReturnValue({ APP_URL: 'https://blast.example.com' });
    req = mockReq({ body: { username: 'u', password: 'p' } });
    res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._cookie.opts.secure).toBe(true);
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('invalid creds');
    mockLogin.mockRejectedValue(err);

    const req = mockReq({ body: { username: 'u', password: 'p' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================== POST /auth/logout ==========================

describe('POST /auth/logout', () => {
  let handler: Function;
  beforeEach(() => {
    handler = getHandler('post', '/auth/logout');
  });

  it('clears refresh token cookie and returns message', async () => {
    mockLogout.mockResolvedValue(undefined);

    const req = mockReq({ cookies: { refreshToken: 'rt_abc' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._json).toEqual({ message: 'Logged out' });
    expect(res._clearCookie).toEqual({ name: 'refreshToken', opts: { path: '/api/auth' } });
  });

  it('calls authService.logout with the refresh token from cookie', async () => {
    mockLogout.mockResolvedValue(undefined);

    const req = mockReq({ cookies: { refreshToken: 'rt_xyz' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockLogout).toHaveBeenCalledWith('rt_xyz');
  });

  it('does not call authService.logout when no cookie present', async () => {
    const req = mockReq({ cookies: {} });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockLogout).not.toHaveBeenCalled();
    expect(res._json).toEqual({ message: 'Logged out' });
  });
});

// ============================== POST /auth/refresh =========================

describe('POST /auth/refresh', () => {
  let handler: Function;
  beforeEach(() => {
    handler = getHandler('post', '/auth/refresh');
  });

  it('returns 401 when no refresh token cookie', async () => {
    const req = mockReq({ cookies: {} });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(401);
    expect(res._json).toEqual({ error: 'No refresh token', code: 'NO_REFRESH_TOKEN' });
  });

  it('returns new auth data and sets new cookie on success', async () => {
    const authData = { accessToken: 'new_tok', user: { id: 1 } };
    mockRefreshAccessToken.mockResolvedValue({ auth: authData, refreshToken: 'new_rt' });

    const req = mockReq({ cookies: { refreshToken: 'old_rt' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._json).toEqual(authData);
    expect(res._cookie.name).toBe('refreshToken');
    expect(res._cookie.value).toBe('new_rt');
    expect(res._cookie.opts.httpOnly).toBe(true);
    expect(res._cookie.opts.path).toBe('/api/auth');
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('token expired');
    mockRefreshAccessToken.mockRejectedValue(err);

    const req = mockReq({ cookies: { refreshToken: 'stale_rt' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================== GET /auth/verify-email/:token ==============

describe('GET /auth/verify-email/:token', () => {
  let handler: Function;
  beforeEach(() => {
    handler = getHandler('get', '/auth/verify-email/:token');
  });

  it('returns success message on valid token', async () => {
    mockVerifyEmail.mockResolvedValue(undefined);

    const req = mockReq({ params: { token: 'valid_token' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._json).toEqual({ message: 'Email verified successfully' });
    expect(mockVerifyEmail).toHaveBeenCalledWith('valid_token');
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('invalid token');
    mockVerifyEmail.mockRejectedValue(err);

    const req = mockReq({ params: { token: 'bad' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================== POST /auth/forgot-password =================

describe('POST /auth/forgot-password', () => {
  let handler: Function;
  beforeEach(() => {
    handler = getHandler('post', '/auth/forgot-password');
  });

  it('always returns the same message to prevent user enumeration', async () => {
    mockForgotPassword.mockResolvedValue(undefined);

    const req = mockReq({ body: { email: 'any@example.com' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._json).toEqual({ message: 'If the email exists, a reset link has been sent' });
    expect(mockForgotPassword).toHaveBeenCalledWith('any@example.com');
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('mail send failure');
    mockForgotPassword.mockRejectedValue(err);

    const req = mockReq({ body: { email: 'x@y.com' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================== POST /auth/reset-password ==================

describe('POST /auth/reset-password', () => {
  let handler: Function;
  beforeEach(() => {
    handler = getHandler('post', '/auth/reset-password');
  });

  it('returns success message on valid reset', async () => {
    mockResetPassword.mockResolvedValue(undefined);

    const req = mockReq({ body: { token: 'reset_tok', password: 'newpassword1' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._json).toEqual({ message: 'Password reset successfully' });
    expect(mockResetPassword).toHaveBeenCalledWith('reset_tok', 'newpassword1');
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('expired token');
    mockResetPassword.mockRejectedValue(err);

    const req = mockReq({ body: { token: 't', password: 'p' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================== Middleware presence =========================

describe('Middleware presence', () => {
  it('rateLimiter is applied to register, login, verify-email, forgot-password, reset-password', () => {
    const rateLimitedRoutes = [
      { method: 'post', path: '/auth/register' },
      { method: 'post', path: '/auth/login' },
      { method: 'get', path: '/auth/verify-email/:token' },
      { method: 'post', path: '/auth/forgot-password' },
      { method: 'post', path: '/auth/reset-password' },
    ];

    for (const { method, path } of rateLimitedRoutes) {
      const stack = getRouteStack(method, path);
      // The rate limiter mock returns a middleware fn; that middleware fn is in the route stack
      // Route should have more than just the handler (at least rate limiter + handler)
      expect(stack.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('authMiddleware is on the logout route', () => {
    const logoutStack = getRouteStack('post', '/auth/logout');
    // authMiddleware should be one of the handlers before the final route handler
    const middlewareFns = logoutStack.slice(0, -1).map((entry) => entry.handle);
    expect(middlewareFns).toContain(mockAuthMiddleware);
  });

  it('validate middleware is applied to register, login, forgot-password, reset-password', () => {
    const validatedRoutes = [
      { method: 'post', path: '/auth/register' },
      { method: 'post', path: '/auth/login' },
      { method: 'post', path: '/auth/forgot-password' },
      { method: 'post', path: '/auth/reset-password' },
    ];

    for (const { method, path } of validatedRoutes) {
      const stack = getRouteStack(method, path);
      // These routes have rateLimiter + validate + handler = at least 3
      expect(stack.length).toBeGreaterThanOrEqual(3);
    }

    // verify-email has rateLimiter but NOT validate — only 2 entries
    const verifyStack = getRouteStack('get', '/auth/verify-email/:token');
    expect(verifyStack.length).toBe(2);
  });
});

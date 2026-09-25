import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockEval = jest.fn<(...args: unknown[]) => Promise<number>>();
const mockTtl = jest.fn<(key: string) => Promise<number>>();
const mockLoggerWarn = jest.fn();

jest.mock('../../../backend/src/db/redis', () => ({
  getRedis: jest.fn(() => ({
    eval: mockEval,
    ttl: mockTtl,
  })),
}));

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: {
    warn: mockLoggerWarn,
    error: jest.fn(),
    info: jest.fn(),
  },
}));

import { rateLimiter } from '../../../backend/src/middleware/rateLimiter';
import { Request, Response, NextFunction } from 'express';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    ip: '127.0.0.1',
    path: '/api/test',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn<(code: number) => Response>().mockReturnValue(res as Response);
  res.json = jest.fn<(body: unknown) => Response>().mockReturnValue(res as Response);
  (res as Record<string, unknown>).set = jest.fn().mockReturnValue(res as Response);
  return res as Response;
}

describe('rateLimiter middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const config = { windowMs: 60000, maxRequests: 5 };

  describe('Redis-based rate limiting', () => {
    it('allows first request via atomic Lua eval', async () => {
      mockEval.mockResolvedValue(1);

      const middleware = rateLimiter(config);
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(mockEval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'ratelimit:127.0.0.1:/api/test',
        60,
      );
      expect(next).toHaveBeenCalled();
    });

    it('shares one budget across the ids of a parameterised route', async () => {
      // Keyed by req.path, /replays/1 and /replays/2 each had a budget of their own
      mockEval.mockResolvedValue(1);
      const middleware = rateLimiter(config);
      for (const id of ['1', '2']) {
        const req = mockReq({
          path: `/admin/replays/${id}`,
          baseUrl: '/api',
          route: { path: '/admin/replays/:matchId' },
        } as unknown as Partial<Request>);
        await middleware(req, mockRes(), jest.fn() as unknown as NextFunction);
      }
      const keys = mockEval.mock.calls.map((c) => c[2]);
      expect(keys).toEqual([
        'ratelimit:127.0.0.1:/api/admin/replays/:matchId',
        'ratelimit:127.0.0.1:/api/admin/replays/:matchId',
      ]);
    });

    it('allows requests within limit', async () => {
      mockEval.mockResolvedValue(3);

      const middleware = rateLimiter(config);
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 429 with Retry-After when over limit', async () => {
      mockEval.mockResolvedValue(6);
      mockTtl.mockResolvedValue(45);

      const middleware = rateLimiter(config);
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.set).toHaveBeenCalledWith('Retry-After', '45');
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Too many requests',
          code: 'RATE_LIMITED',
          retryAfter: 45,
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('tracks different IPs independently', async () => {
      mockEval.mockResolvedValue(1);

      const middleware = rateLimiter(config);

      const req1 = mockReq({ ip: '10.0.0.1', path: '/api/test' } as Partial<Request>);
      const req2 = mockReq({ ip: '10.0.0.2', path: '/api/test' } as Partial<Request>);
      const res1 = mockRes();
      const res2 = mockRes();

      await middleware(req1, res1, jest.fn() as unknown as NextFunction);
      await middleware(req2, res2, jest.fn() as unknown as NextFunction);

      const evalCalls = mockEval.mock.calls;
      expect(evalCalls[0][2]).toBe('ratelimit:10.0.0.1:/api/test');
      expect(evalCalls[1][2]).toBe('ratelimit:10.0.0.2:/api/test');
    });

    it('tracks different paths independently', async () => {
      mockEval.mockResolvedValue(1);

      const middleware = rateLimiter(config);

      const req1 = mockReq({ ip: '127.0.0.1', path: '/api/login' } as Partial<Request>);
      const req2 = mockReq({ ip: '127.0.0.1', path: '/api/register' } as Partial<Request>);
      const res1 = mockRes();
      const res2 = mockRes();

      await middleware(req1, res1, jest.fn() as unknown as NextFunction);
      await middleware(req2, res2, jest.fn() as unknown as NextFunction);

      const evalCalls = mockEval.mock.calls;
      expect(evalCalls[0][2]).toBe('ratelimit:127.0.0.1:/api/login');
      expect(evalCalls[1][2]).toBe('ratelimit:127.0.0.1:/api/register');
    });
  });

  describe('in-memory fallback when Redis is unavailable', () => {
    it('falls back to in-memory rate limiting when Redis throws', async () => {
      mockEval.mockRejectedValue(new Error('Redis connection refused'));

      const middleware = rateLimiter({ windowMs: 60000, maxRequests: 3 });
      const req = mockReq({ ip: '192.168.1.1', path: '/fallback' } as Partial<Request>);
      const res = mockRes();
      const next = jest.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ ip: '192.168.1.1', path: '/fallback' }),
        expect.stringContaining('Redis unavailable'),
      );
      expect(next).toHaveBeenCalled();
    });

    it('allows requests within limit using fallback', async () => {
      mockEval.mockRejectedValue(new Error('Redis down'));

      const middleware = rateLimiter({ windowMs: 60000, maxRequests: 3 });
      const req = mockReq({ ip: '192.168.2.1', path: '/fallback-ok' } as Partial<Request>);
      const res = mockRes();
      const next = jest.fn() as unknown as NextFunction;

      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();

      (next as unknown as jest.Mock).mockClear();
      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('returns 429 when fallback limit exceeded', async () => {
      mockEval.mockRejectedValue(new Error('Redis down'));

      const fallbackConfig = { windowMs: 60000, maxRequests: 2 };
      const middleware = rateLimiter(fallbackConfig);
      const ip = '192.168.3.1';
      const path = '/fallback-limit';

      // First two requests pass
      for (let i = 0; i < 2; i++) {
        const req = mockReq({ ip, path } as Partial<Request>);
        const res = mockRes();
        const n = jest.fn() as unknown as NextFunction;
        await middleware(req, res, n);
        expect(n).toHaveBeenCalled();
      }

      // Third request should be rate limited
      const req = mockReq({ ip, path } as Partial<Request>);
      const res = mockRes();
      const blockedNext = jest.fn() as unknown as NextFunction;

      await middleware(req, res, blockedNext);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Too many requests',
          code: 'RATE_LIMITED',
        }),
      );
      expect(blockedNext).not.toHaveBeenCalled();
    });

    it('logs warning when Redis error triggers fallback', async () => {
      mockEval.mockRejectedValue(new Error('ECONNREFUSED'));

      const middleware = rateLimiter(config);
      const req = mockReq({ ip: '192.168.4.1', path: '/warn-test' } as Partial<Request>);
      const res = mockRes();
      const next = jest.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ ip: '192.168.4.1', path: '/warn-test' }),
        expect.stringContaining('Redis unavailable'),
      );
    });
  });
});

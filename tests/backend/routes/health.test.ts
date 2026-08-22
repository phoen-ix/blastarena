import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockExecute = jest.fn<() => Promise<unknown>>();
const mockPing = jest.fn<() => Promise<string>>();

jest.mock('../../../backend/src/db/connection', () => ({
  getPool: jest.fn(() => ({
    execute: mockExecute,
  })),
}));

jest.mock('../../../backend/src/db/redis', () => ({
  getRedis: jest.fn(() => ({
    ping: mockPing,
  })),
}));

const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
jest.mock('../../../backend/src/utils/logger', () => ({ logger: mockLogger }));

import healthRouter, { BUILD_ID } from '../../../backend/src/routes/health';
import { Request, Response } from 'express';

type RouteLayer = {
  route: {
    path: string;
    methods: { get: boolean };
    stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
  };
};

function getHealthHandler(): (req: Request, res: Response) => Promise<void> {
  const stack = (healthRouter as unknown as { stack: RouteLayer[] }).stack;
  const layer = stack.find((l) => l.route && l.route.path === '/health' && l.route.methods.get);
  if (!layer) throw new Error('GET /health route not found on router');
  return layer.route.stack[0].handle;
}

function mockRes() {
  const data: { _status: number; _json: unknown } = { _status: 200, _json: null };
  const res = {
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

describe('GET /health', () => {
  let handler: (req: Request, res: Response) => Promise<void>;

  beforeEach(() => {
    handler = getHealthHandler();
    jest.clearAllMocks();
  });

  it('returns 200 with status ok when healthy', async () => {
    mockExecute.mockResolvedValue([[{ 1: 1 }]]);
    mockPing.mockResolvedValue('PONG');

    const res = mockRes();
    await handler({} as Request, res as unknown as Response);

    expect(res._json).toEqual(expect.objectContaining({ status: 'ok' }));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('response includes buildId', async () => {
    mockExecute.mockResolvedValue([[{ 1: 1 }]]);
    mockPing.mockResolvedValue('PONG');

    const res = mockRes();
    await handler({} as Request, res as unknown as Response);

    expect(res._json).toEqual(expect.objectContaining({ buildId: BUILD_ID }));
    expect(typeof BUILD_ID).toBe('string');
    expect(BUILD_ID.length).toBeGreaterThan(0);
  });

  it('response includes timestamp as ISO string', async () => {
    mockExecute.mockResolvedValue([[{ 1: 1 }]]);
    mockPing.mockResolvedValue('PONG');

    const res = mockRes();
    await handler({} as Request, res as unknown as Response);

    const body = res._json as { timestamp: string };
    expect(body).toHaveProperty('timestamp');

    // Verify it's a valid ISO 8601 date string
    const parsed = new Date(body.timestamp);
    expect(parsed.toISOString()).toBe(body.timestamp);
  });

  it('returns 503 when database fails', async () => {
    mockExecute.mockRejectedValue(new Error('ECONNREFUSED'));
    mockPing.mockResolvedValue('PONG');

    const res = mockRes();
    await handler({} as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res._json).toEqual(
      expect.objectContaining({ status: 'error', message: 'Service unavailable' }),
    );
  });

  it('returns 503 when Redis fails', async () => {
    mockExecute.mockResolvedValue([[{ 1: 1 }]]);
    mockPing.mockRejectedValue(new Error('Redis timeout'));

    const res = mockRes();
    await handler({} as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res._json).toEqual(
      expect.objectContaining({ status: 'error', message: 'Service unavailable' }),
    );
  });

  it('does not leak error details in 503 response', async () => {
    const sensitiveError = new Error('password=s3cret host=db.internal');
    mockExecute.mockRejectedValue(sensitiveError);

    const res = mockRes();
    await handler({} as Request, res as unknown as Response);

    const body = res._json as Record<string, unknown>;
    const bodyStr = JSON.stringify(body);

    expect(bodyStr).not.toContain('s3cret');
    expect(bodyStr).not.toContain('db.internal');
    expect(body).toEqual({ status: 'error', message: 'Service unavailable' });
  });

  // The 503 IS the signal that a dependency is down. It used to throw the reason away, so Docker
  // would flip the container to "unhealthy" with nothing in the log saying which one failed.
  // (audit APPERROR-LOG-1)
  it('records which dependency failed, without putting it in the response', async () => {
    mockExecute.mockRejectedValue(new Error('ECONNREFUSED 172.19.5.3:3306'));

    const res = mockRes();
    await handler({} as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(mockLogger.error).toHaveBeenCalledWith(
      { err: 'ECONNREFUSED 172.19.5.3:3306' },
      'Health check failed',
    );
    // ...and the client still learns nothing.
    expect(JSON.stringify(res._json)).not.toContain('ECONNREFUSED');
  });

  it('logs nothing on the healthy path', async () => {
    mockExecute.mockResolvedValue([]);
    mockPing.mockResolvedValue('PONG');

    await handler({} as Request, mockRes() as unknown as Response);

    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});

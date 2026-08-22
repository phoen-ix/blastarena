import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
}));

import { AppError, errorHandler } from '../../../backend/src/middleware/errorHandler';
import { logger } from '../../../backend/src/utils/logger';
import { Request, Response, NextFunction } from 'express';

const mockLogger = logger as unknown as {
  error: jest.Mock;
  warn: jest.Mock;
  info: jest.Mock;
};

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: '/test',
    method: 'POST',
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn<(code: number) => Response>().mockReturnValue(res as Response);
  res.json = jest.fn<(body: unknown) => Response>().mockReturnValue(res as Response);
  return res as Response;
}

describe('errorHandler middleware', () => {
  const next = jest.fn() as unknown as NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns custom statusCode and code for AppError', () => {
    const err = new AppError('Not found', 404, 'NOT_FOUND');
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Not found',
      code: 'NOT_FOUND',
    });
  });

  it('does NOT log to logger.error for AppError', () => {
    const err = new AppError('Bad input', 400, 'BAD_REQUEST');
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, next);

    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('returns 500 with INTERNAL_ERROR for generic Error', () => {
    const err = new Error('Something broke');
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  });

  it('logs generic Error to logger.error with path and method', () => {
    const err = new Error('Unexpected failure');
    const req = mockReq({ path: '/api/users', method: 'GET' });
    const res = mockRes();

    errorHandler(err, req, res, next);

    expect(mockLogger.error).toHaveBeenCalledWith(
      { err, path: '/api/users', method: 'GET' },
      'Unhandled error',
    );
  });

  it('AppError instanceof works correctly', () => {
    const err = new AppError('test');

    expect(err instanceof AppError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('AppError uses default statusCode=400 and code=BAD_REQUEST', () => {
    const err = new AppError('Default error');
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, next);

    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('BAD_REQUEST');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Default error',
      code: 'BAD_REQUEST',
    });
  });

  // ── Client-fault classification (audit ERRORHANDLER-4XX-1) ─────────────────────────────────
  //
  // Errors from body-parser carry a status and an `expose` flag from `http-errors`. They used to
  // fall through to the opaque 500 branch, which answered the wrong status AND logged the raw
  // request body plus a stack trace at error level for anyone who could send a POST.

  /** The shape body-parser actually attaches — captured from the real library, not invented. */
  function bodyParserError(message: string, type: string, status: number, body?: string): Error {
    const err = new SyntaxError(message) as Error & Record<string, unknown>;
    err.expose = true;
    err.status = status;
    err.statusCode = status;
    err.type = type;
    if (body !== undefined) err.body = body;
    return err;
  }

  it('answers malformed JSON with 400 INVALID_JSON, not 500', () => {
    const err = bodyParserError(
      'Unexpected token n in JSON at position 1',
      'entity.parse.failed',
      400,
      '{not json',
    );
    const res = mockRes();

    errorHandler(err, mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Malformed JSON in request body',
      code: 'INVALID_JSON',
    });
  });

  it('never logs the request body or a stack trace for a client fault', () => {
    // The regression this guards: `logger.error({ err, ... })` where err.body is the payload the
    // caller just sent. Asserting on the whole serialised call, rather than named fields, is what
    // makes this catch a future `{ err }` being reintroduced.
    const err = bodyParserError(
      'Unexpected token',
      'entity.parse.failed',
      400,
      '{"password":"hunter2"',
    );
    errorHandler(err, mockReq(), mockRes(), next);

    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);

    const logged = JSON.stringify(mockLogger.warn.mock.calls[0]);
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain('password');
    expect(logged).not.toContain('stack');
  });

  it('does not echo library-internal messages back to the client', () => {
    // A bad Content-Encoding surfaces zlib's "incorrect header check" with expose:true. The status
    // is trustworthy; the wording is not ours to forward.
    const err = bodyParserError('incorrect header check', 'encoding.unsupported', 415);
    const res = mockRes();

    errorHandler(err, mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(415);
    expect(JSON.stringify((res.json as jest.Mock).mock.calls[0])).not.toContain('incorrect header');
  });

  it('maps an oversized body to 413', () => {
    const err = bodyParserError('request entity too large', 'entity.too.large', 413);
    const res = mockRes();

    errorHandler(err, mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Request body is too large',
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('falls back to a generic 4xx message for an unrecognised type', () => {
    const err = bodyParserError('something odd', 'some.new.type', 400);
    const res = mockRes();

    errorHandler(err, mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Bad request', code: 'BAD_REQUEST' });
  });

  // ── The trust gates: everything below must still be an opaque 500 ─────────────────────────

  it.each([
    [
      'a mysql2 driver error',
      Object.assign(new Error("Unknown column 'x' in field list"), {
        code: 'ER_BAD_FIELD_ERROR',
        errno: 1054,
        sqlState: '42S22',
      }),
    ],
    ['an ioredis error', Object.assign(new Error('READONLY'), { name: 'ReplyError' })],
    ['a jwt error', Object.assign(new Error('jwt expired'), { name: 'TokenExpiredError' })],
    ['a 4xx status without expose', Object.assign(new Error('nope'), { statusCode: 403 })],
    ['an exposable 5xx', Object.assign(new Error('boom'), { expose: true, statusCode: 500 })],
    ['a non-numeric status', Object.assign(new Error('x'), { expose: true, statusCode: '400' })],
  ])('reports %s as an opaque 500', (_label, err) => {
    const res = mockRes();

    errorHandler(err as Error, mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
  });

  it('hands back to Express once the response has started', () => {
    const res = mockRes();
    (res as unknown as { headersSent: boolean }).headersSent = true;
    const nextFn = jest.fn();
    const err = new AppError('too late', 400);

    errorHandler(err, mockReq(), res, nextFn as unknown as NextFunction);

    expect(nextFn).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('does not throw when something non-Error is thrown', () => {
    const res = mockRes();

    expect(() => errorHandler('boom', mockReq(), res, next)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

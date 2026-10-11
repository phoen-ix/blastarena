import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { z } from 'zod';
import { validate } from '../../../backend/src/middleware/validation';
import { Request, Response, NextFunction } from 'express';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    query: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn<(code: number) => Response>().mockReturnValue(res as Response);
  res.json = jest.fn<(body: unknown) => Response>().mockReturnValue(res as Response);
  return res as Response;
}

describe('validate middleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = jest.fn() as unknown as NextFunction;
  });

  const userSchema = z.object({
    username: z.string().min(3),
    age: z.number().int().positive(),
  });

  it('passes valid body data and calls next()', () => {
    const req = mockReq({ body: { username: 'alice', age: 25 } });
    const res = mockRes();
    const middleware = validate(userSchema);

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('replaces req.body with Zod-parsed output (strips extra fields)', () => {
    const req = mockReq({ body: { username: 'alice', age: 25, extraField: 'should be stripped' } });
    const res = mockRes();
    const middleware = validate(userSchema);

    middleware(req, res, next);

    expect(req.body).toEqual({ username: 'alice', age: 25 });
    expect(req.body).not.toHaveProperty('extraField');
    expect(next).toHaveBeenCalled();
  });

  it('returns 400 with VALIDATION_ERROR on invalid data', () => {
    const req = mockReq({ body: { username: 'ab', age: -5 } });
    const res = mockRes();
    const middleware = validate(userSchema);

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns field-level error details', () => {
    const req = mockReq({ body: { username: 123, age: 25 } });
    const res = mockRes();
    const middleware = validate(userSchema);

    middleware(req, res, next);

    const jsonCall = (res.json as jest.Mock).mock.calls[0][0] as {
      details: Array<{ field: string; message: string }>;
    };
    expect(jsonCall.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'username' })]),
    );
    expect(jsonCall.details[0]).toHaveProperty('message');
  });

  it('returns multiple validation errors together', () => {
    const req = mockReq({ body: { username: 42, age: 'not a number' } });
    const res = mockRes();
    const middleware = validate(userSchema);

    middleware(req, res, next);

    const jsonCall = (res.json as jest.Mock).mock.calls[0][0] as {
      details: Array<{ field: string; message: string }>;
    };
    expect(jsonCall.details.length).toBeGreaterThanOrEqual(2);

    const fields = jsonCall.details.map((d: { field: string }) => d.field);
    expect(fields).toContain('username');
    expect(fields).toContain('age');
  });

  it('works with query source', () => {
    const querySchema = z.object({ page: z.string() });
    const req = mockReq({ query: { page: '5', extra: 'gone' } });
    const res = mockRes();
    const middleware = validate(querySchema, 'query');

    middleware(req, res, next);

    expect(req.query).toEqual({ page: '5' });
    expect(req.query).not.toHaveProperty('extra');
    expect(next).toHaveBeenCalled();
  });

  it('replaces req.query even though Express 5 defines it as a getter', () => {
    // Express 5 puts `query` on the request prototype as a getter with no setter; a plain
    // `req.query = data` would throw a TypeError there.
    const proto = {};
    Object.defineProperty(proto, 'query', {
      get: () => ({ page: '5', extra: 'gone' }),
      configurable: true,
    });
    const req = Object.assign(Object.create(proto), { body: {}, params: {} }) as Request;
    const res = mockRes();
    const middleware = validate(z.object({ page: z.string() }), 'query');

    middleware(req, res, next);

    expect(req.query).toEqual({ page: '5' });
    expect(next).toHaveBeenCalledWith();
  });

  it('works with params source', () => {
    const paramsSchema = z.object({ id: z.string() });
    const req = mockReq({ params: { id: '42', slug: 'extra' } });
    const res = mockRes();
    const middleware = validate(paramsSchema, 'params');

    middleware(req, res, next);

    expect(req.params).toEqual({ id: '42' });
    expect(next).toHaveBeenCalled();
  });

  it('forwards non-Zod errors to next()', () => {
    const throwingSchema = {
      parse: () => {
        throw new TypeError('Something else went wrong');
      },
    } as unknown as z.ZodSchema;

    const req = mockReq({ body: {} });
    const res = mockRes();
    const middleware = validate(throwingSchema);

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(TypeError));
    expect(res.status).not.toHaveBeenCalled();
  });
});

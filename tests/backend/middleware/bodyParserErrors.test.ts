import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { errorHandler } from '../../../backend/src/middleware/errorHandler';

/**
 * The companion to errorHandler.test.ts, driving the REAL body-parser.
 *
 * The unit tests use hand-built fixtures of the shape body-parser attaches — `expose`, `status`,
 * `type`, `body`. Those fixtures are a claim about a third-party library, and a claim that would
 * quietly stop being true the day express is upgraded, taking the fix with it and reverting every
 * malformed request to a 500. This boots a real Express app and sends real malformed requests, so
 * the classification is checked against the library rather than against our memory of it.
 * (audit ERRORHANDLER-4XX-1)
 */

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.post('/echo', (req, res) => res.json({ ok: true, got: req.body }));
  app.use(errorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

const post = async (body: string, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}/echo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  return { status: res.status, text: await res.text() };
};

describe('body-parser faults through the real Express stack', () => {
  it('a well-formed body still succeeds', async () => {
    const res = await post('{"a":1}');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ ok: true, got: { a: 1 } });
  });

  it('malformed JSON is 400 INVALID_JSON, not 500', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(400);
    expect(JSON.parse(res.text)).toEqual({
      error: 'Malformed JSON in request body',
      code: 'INVALID_JSON',
    });
  });

  it('does not reflect the request body back to the caller', async () => {
    // body-parser's own message quotes the offending slice, which would put a half-typed
    // credential straight into the error response.
    const res = await post('{"password":"hunter2"');
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('hunter2');
    expect(res.text).not.toContain('password');
  });

  it('a corrupt gzip body is a 4xx and leaks no zlib internals', async () => {
    const res = await post('garbagegarbage', { 'Content-Encoding': 'gzip' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.text).not.toContain('incorrect header check');
    expect(res.text).not.toContain('Z_DATA_ERROR');
  });

  it('an oversized body is 413, not 500', async () => {
    const res = await post(JSON.stringify({ pad: 'x'.repeat(1_200_000) }));
    expect(res.status).toBe(413);
    expect(JSON.parse(res.text).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('an unsupported charset is 415, not 500', async () => {
    const res = await post('{"a":1}', { 'Content-Type': 'application/json; charset=utf-32' });
    expect(res.status).toBe(415);
    expect(JSON.parse(res.text).code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
});

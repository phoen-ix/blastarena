import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs';
import path from 'path';

// This test exercises routing and headers only; the data layers must never be touched.
jest.mock('../../../backend/src/db/connection', () => ({
  query: jest.fn(async () => []),
  execute: jest.fn(async () => ({ affectedRows: 0, insertId: 0 })),
  withTransaction: jest.fn(async () => undefined),
  createPool: jest.fn(async () => undefined),
  getPool: jest.fn(() => ({ execute: jest.fn(async () => [[], []]) })),
}));
jest.mock('../../../backend/src/db/redis', () => ({
  getRedis: jest.fn(() => ({ ping: jest.fn(async () => 'PONG') })),
  createRedisClient: jest.fn(async () => undefined),
}));
jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { createApp } from '../../../backend/src/app';
import { loadConfig } from '../../../backend/src/config';

/**
 * Guards two header/response-shape defects that only showed up under a real HTTP request.
 *
 * 1. Unmatched routes fell through to Express's finalhandler, which answers with an HTML error
 *    page — `<pre>Cannot GET /api/nope</pre>` — on an API that is otherwise JSON end to end. A
 *    client branching on `code` got nothing to branch on. finalhandler also stamps its own
 *    `Content-Security-Policy: default-src 'none'`, which arrived alongside nginx's policy, so
 *    those responses carried two conflicting CSP headers.
 *
 * 2. app.ts set four security headers that nginx also sets, so every /api response carried them
 *    twice — and the two X-Frame-Options disagreed (DENY here, SAMEORIGIN at the edge). nginx owns
 *    them now, because it is the only layer that sees static assets, the 502 page and 429s.
 *
 * (audit HEADER-OWNERSHIP-1)
 */

let server: http.Server;
let base: string;

beforeAll(async () => {
  // createApp() reads the validated config (for the CORS origin), so it has to be loaded. Only
  // the four secrets have no default; everything else falls back.
  process.env.DB_PASSWORD ??= 'test-db-password';
  process.env.JWT_SECRET ??= 'x'.repeat(32);
  process.env.EMAIL_PEPPER ??= 'y'.repeat(32);
  process.env.TOTP_ENCRYPTION_KEY ??= 'z'.repeat(32);
  process.env.APP_URL ??= 'http://localhost';
  loadConfig();

  server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe('unmatched routes', () => {
  it.each([['/api/definitely-not-a-route'], ['/api/'], ['/not-even-api']])(
    'answers %s with a JSON 404, not an HTML page',
    async (url) => {
      const res = await fetch(`${base}${url}`);
      const text = await res.text();

      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      expect(JSON.parse(text)).toEqual({ error: 'Not found', code: 'NOT_FOUND' });
      expect(text).not.toContain('<pre>');
      expect(text).not.toContain('<!DOCTYPE');
    },
  );

  it('leaves the admin gate in front of the catch-all', async () => {
    // /api/admin/* is auth-gated by a path-less `router.use` before any route matches, so an
    // unknown admin path answers 401 rather than 404 — an anonymous caller must not learn which
    // admin routes exist. The catch-all must not get in front of that.
    const res = await fetch(`${base}/api/admin/nope`);
    expect(res.status).toBe(401);
  });

  it('does not emit the finalhandler CSP that collided with nginx', async () => {
    const res = await fetch(`${base}/api/definitely-not-a-route`);
    // Express's finalhandler sets `default-src 'none'` on its HTML page. Reaching our JSON 404
    // means it is never invoked, so nothing here can collide with the edge policy.
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('still routes real endpoints (the catch-all is last, not greedy)', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect((await res.json()) as { status: string }).toEqual(
      expect.objectContaining({ status: 'ok' }),
    );
  });
});

describe('security header ownership', () => {
  it.each([
    ['x-frame-options'],
    ['x-content-type-options'],
    ['referrer-policy'],
    ['permissions-policy'],
  ])('does not set %s — nginx owns it', async (header) => {
    const res = await fetch(`${base}/api/health`);
    expect(res.headers.get(header)).toBeNull();
  });

  it('nginx sets every header Express stopped setting', () => {
    // The other half of the handoff: dropping them from Express is only safe while the edge
    // actually sets them. Both configs are checked, because the dev stack has its own file.
    const prod = fs.readFileSync(
      path.join(__dirname, '../../../docker/nginx/security-headers.conf'),
      'utf-8',
    );
    const dev = fs.readFileSync(
      path.join(__dirname, '../../../docker/nginx/security-headers-dev.conf'),
      'utf-8',
    );

    for (const header of [
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]) {
      expect(prod).toContain(`add_header ${header}`);
      expect(dev).toContain(`add_header ${header}`);
    }
  });

  it('the dev header file carries no CSP or HSTS, so Vite HMR still works', () => {
    const dev = fs
      .readFileSync(
        path.join(__dirname, '../../../docker/nginx/security-headers-dev.conf'),
        'utf-8',
      )
      .split('\n')
      .filter((l) => l.trim().startsWith('add_header'))
      .join('\n');

    // Vite's HMR client uses inline scripts, eval and a WebSocket to the dev server; the
    // production CSP would break all three, and HSTS on plain-HTTP localhost is meaningless.
    expect(dev).not.toMatch(/Content-Security-Policy/i);
    expect(dev).not.toMatch(/Strict-Transport-Security/i);
  });
});

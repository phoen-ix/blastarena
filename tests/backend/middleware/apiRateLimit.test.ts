import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import http from 'http';
import type { AddressInfo } from 'net';

// Routing and limiter only; the data layers must never be touched.
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
 * The app-wide /api limiter: a per-IP safety net that needs neither nginx nor Redis. Every route
 * shares the one budget, so requests past it get 429 in the app's error shape whatever the path.
 */

const LIMIT = 3;
let server: http.Server;
let base: string;

beforeAll(async () => {
  process.env.DB_PASSWORD ??= 'test-db-password';
  process.env.JWT_SECRET ??= 'x'.repeat(32);
  process.env.EMAIL_PEPPER ??= 'y'.repeat(32);
  process.env.TOTP_ENCRYPTION_KEY ??= 'ab'.repeat(32);
  process.env.APP_URL ??= 'http://localhost';
  process.env.API_RATE_LIMIT_PER_MIN = String(LIMIT);
  loadConfig();

  server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // The first request loads fetch's HTTP client (undici) and opens the first connection: real
  // one-time work, done here so no single test pays for it. Under heavy host load the same
  // work overran the 5 s default in csrf.test.ts, hence the hook's own budget.
  // Outside /api, so it leaves the limiter's budget untouched.
  await (await fetch(`${base}/not-api`)).text();
}, 30_000);

afterAll(async () => {
  delete process.env.API_RATE_LIMIT_PER_MIN;
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe('app-wide API rate limit', () => {
  it('answers 429 RATE_LIMITED once an IP has used its per-minute budget, on any route', async () => {
    for (let i = 0; i < LIMIT; i++) {
      const ok = await fetch(`${base}/api/health`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get('ratelimit-policy')).toContain(`q=${LIMIT}; w=60`);
    }

    // A different route draws on the same budget.
    const limited = await fetch(`${base}/api/leaderboard`);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'Too many requests', code: 'RATE_LIMITED' });
    expect(limited.headers.get('ratelimit')).toMatch(/r=0/);
  });

  it('does not count requests outside /api', async () => {
    const res = await fetch(`${base}/not-api`);
    expect(res.status).toBe(404);
  });

  it('defaults to 1000 per minute when the variable is unset', () => {
    delete process.env.API_RATE_LIMIT_PER_MIN;
    expect(loadConfig().API_RATE_LIMIT_PER_MIN).toBe(1000);
  });
});

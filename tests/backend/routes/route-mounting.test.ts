import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import http from 'http';
import type { AddressInfo } from 'net';

// The DB/Redis layers must never be touched by this test — it only exercises routing.
jest.mock('../../../backend/src/db/connection', () => ({
  query: jest.fn(async () => []),
  execute: jest.fn(async () => ({ affectedRows: 0, insertId: 0 })),
  withTransaction: jest.fn(async () => undefined),
  createPool: jest.fn(async () => undefined),
  getPool: jest.fn(() => ({})),
}));

jest.mock('../../../backend/src/db/redis', () => ({
  getRedis: jest.fn(() => ({})),
  createRedisClient: jest.fn(async () => undefined),
}));

import express from 'express';
import { registerRoutes } from '../../../backend/src/routes';
import { errorHandler } from '../../../backend/src/middleware/errorHandler';

/**
 * Regression guard for the admin router swallowing every router mounted after it.
 *
 * `routes/index.ts` mounts all 13 routers on the same `/api` prefix. `routes/admin.ts`
 * previously registered a PATH-LESS `router.use(authMiddleware, staffMiddleware)`, which in
 * Express matches every request that enters the router — so requests for campaign / friends /
 * messages / leaderboard / cosmetics / docs / custom-maps / challenges fell through the admin
 * router's non-matching route layers, hit that `use`, and were rejected with 401/403 before ever
 * reaching the router that owns them.
 *
 * The existing route tests all invoke handlers directly off `router.stack`, so none of them
 * exercise the mounted app and none of them could catch this. This one boots the real thing.
 */
describe('route mounting', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    registerRoutes(app);
    app.use(errorHandler);

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // Declared with no auth middleware in their own routers, so an anonymous caller must at least
  // reach the handler. We assert "not rejected by an auth gate" rather than a specific 2xx,
  // because the handlers' services are not mocked here — the invariant under test is
  // reachability, not the response body.
  const publicPaths = [
    '/api/leaderboard',
    '/api/leaderboard/tiers',
    '/api/leaderboard/seasons',
    '/api/user/1/public',
    '/api/challenges/active',
  ];

  it.each(publicPaths)('%s is reachable without a token', async (path) => {
    const res = await fetch(`${base}${path}`);
    expect([401, 403]).not.toContain(res.status);
  });

  it('routes registered before the admin gate still work', async () => {
    const res = await fetch(`${base}/api/admin/settings/public`);
    expect([401, 403]).not.toContain(res.status);
  });

  // Positive control: the gate must still protect the admin surface it was written for.
  const guardedPaths = [
    '/api/admin/users',
    '/api/admin/replays',
    '/api/admin/simulations',
    '/api/admin/settings/simulation_defaults',
  ];

  it.each(guardedPaths)('%s still requires auth', async (path) => {
    const res = await fetch(`${base}${path}`);
    expect([401, 403]).toContain(res.status);
  });
});

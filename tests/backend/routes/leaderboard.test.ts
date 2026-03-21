import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

// Mock services
const mockGetLeaderboard = jest.fn<AnyFn>();
const mockGetRankConfig = jest.fn<AnyFn>();
const mockGetPublicProfile = jest.fn<AnyFn>();
const mockGetUserRank = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/leaderboard', () => ({
  getLeaderboard: mockGetLeaderboard,
  getRankConfig: mockGetRankConfig,
  getPublicProfile: mockGetPublicProfile,
  getUserRank: mockGetUserRank,
}));

const mockGetSeasons = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/season', () => ({
  getSeasons: mockGetSeasons,
}));

// Mock middleware
const mockAuthMiddleware = jest.fn<AnyFn>((_req, _res, next) => next());
jest.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: mockAuthMiddleware,
}));

import router from '../../../backend/src/routes/leaderboard';

type RouteLayer = {
  route: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: Function; name?: string }>;
  };
};

function getHandler(method: string, path: string) {
  const stack = (router as any).stack as RouteLayer[];
  const layer = stack.find(
    (l: RouteLayer) => l.route?.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  const routeStack = layer.route.stack;
  return routeStack[routeStack.length - 1].handle;
}

function getRouteStack(method: string, path: string) {
  const stack = (router as any).stack as RouteLayer[];
  const layer = stack.find(
    (l: RouteLayer) => l.route?.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  return layer.route.stack;
}

function mockReq(overrides: Record<string, unknown> = {}): any {
  return {
    query: {},
    params: {},
    body: {},
    user: { userId: 1, username: 'alice', role: 'user' },
    ...overrides,
  };
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
  return res;
}

describe('Leaderboard Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /leaderboard', () => {
    it('calls getLeaderboard with default pagination and returns result', async () => {
      const result = { entries: [{ userId: 1, rank: 1 }], total: 1 };
      mockGetLeaderboard.mockResolvedValue(result);

      const handler = getHandler('get', '/leaderboard');
      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetLeaderboard).toHaveBeenCalledWith({ page: 1, limit: 25, seasonId: undefined });
      expect(res._json).toEqual(result);
    });

    it('parses page, limit, and season_id from query params', async () => {
      const result = { entries: [], total: 0 };
      mockGetLeaderboard.mockResolvedValue(result);

      const handler = getHandler('get', '/leaderboard');
      const req = mockReq({ query: { page: '3', limit: '10', season_id: '7' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetLeaderboard).toHaveBeenCalledWith({ page: 3, limit: 10, seasonId: 7 });
      expect(res._json).toEqual(result);
    });

    it('clamps page to minimum 1', async () => {
      mockGetLeaderboard.mockResolvedValue({ entries: [], total: 0 });

      const handler = getHandler('get', '/leaderboard');
      const req = mockReq({ query: { page: '-5' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetLeaderboard).toHaveBeenCalledWith({ page: 1, limit: 25, seasonId: undefined });
    });

    it('clamps limit to maximum 100', async () => {
      mockGetLeaderboard.mockResolvedValue({ entries: [], total: 0 });

      const handler = getHandler('get', '/leaderboard');
      const req = mockReq({ query: { limit: '500' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetLeaderboard).toHaveBeenCalledWith({ page: 1, limit: 100, seasonId: undefined });
    });

    it('clamps limit to minimum 1', async () => {
      mockGetLeaderboard.mockResolvedValue({ entries: [], total: 0 });

      const handler = getHandler('get', '/leaderboard');
      const req = mockReq({ query: { limit: '-5' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetLeaderboard).toHaveBeenCalledWith({ page: 1, limit: 1, seasonId: undefined });
    });

    it('passes error to next on failure', async () => {
      mockGetLeaderboard.mockRejectedValue(new Error('DB error'));

      const handler = getHandler('get', '/leaderboard');
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('GET /leaderboard/tiers', () => {
    it('calls getRankConfig and returns config', async () => {
      const config = [
        { tier: 'Bronze', minElo: 0 },
        { tier: 'Silver', minElo: 1000 },
      ];
      mockGetRankConfig.mockResolvedValue(config);

      const handler = getHandler('get', '/leaderboard/tiers');
      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetRankConfig).toHaveBeenCalled();
      expect(res._json).toEqual(config);
    });

    it('passes error to next on failure', async () => {
      mockGetRankConfig.mockRejectedValue(new Error('Config error'));

      const handler = getHandler('get', '/leaderboard/tiers');
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('GET /leaderboard/seasons', () => {
    it('calls getSeasons with default pagination', async () => {
      const result = { seasons: [{ id: 1, name: 'Season 1' }], total: 1 };
      mockGetSeasons.mockResolvedValue(result);

      const handler = getHandler('get', '/leaderboard/seasons');
      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetSeasons).toHaveBeenCalledWith(1, 20);
      expect(res._json).toEqual(result);
    });

    it('parses page and limit from query params', async () => {
      const result = { seasons: [], total: 0 };
      mockGetSeasons.mockResolvedValue(result);

      const handler = getHandler('get', '/leaderboard/seasons');
      const req = mockReq({ query: { page: '2', limit: '5' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetSeasons).toHaveBeenCalledWith(2, 5);
      expect(res._json).toEqual(result);
    });

    it('clamps page to minimum 1', async () => {
      mockGetSeasons.mockResolvedValue({ seasons: [], total: 0 });

      const handler = getHandler('get', '/leaderboard/seasons');
      const req = mockReq({ query: { page: '0' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetSeasons).toHaveBeenCalledWith(1, 20);
    });

    it('clamps limit to maximum 50', async () => {
      mockGetSeasons.mockResolvedValue({ seasons: [], total: 0 });

      const handler = getHandler('get', '/leaderboard/seasons');
      const req = mockReq({ query: { limit: '200' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetSeasons).toHaveBeenCalledWith(1, 50);
    });

    it('clamps limit to minimum 1', async () => {
      mockGetSeasons.mockResolvedValue({ seasons: [], total: 0 });

      const handler = getHandler('get', '/leaderboard/seasons');
      const req = mockReq({ query: { limit: '-10' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetSeasons).toHaveBeenCalledWith(1, 1);
    });

    it('passes error to next on failure', async () => {
      mockGetSeasons.mockRejectedValue(new Error('Season error'));

      const handler = getHandler('get', '/leaderboard/seasons');
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('GET /user/:id/public', () => {
    it('returns public profile for valid user', async () => {
      const profile = { userId: 2, username: 'bob', rank: 'Silver', elo: 1200 };
      mockGetPublicProfile.mockResolvedValue(profile);

      const handler = getHandler('get', '/user/:id/public');
      const req = mockReq({ params: { id: '2' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetPublicProfile).toHaveBeenCalledWith(2);
      expect(res._json).toEqual(profile);
    });

    it('returns 400 for invalid user ID', async () => {
      const handler = getHandler('get', '/user/:id/public');
      const req = mockReq({ params: { id: 'abc' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(res._status).toBe(400);
      expect(res._json).toEqual({ error: 'Invalid user ID' });
      expect(mockGetPublicProfile).not.toHaveBeenCalled();
    });

    it('returns 404 when profile is not found', async () => {
      mockGetPublicProfile.mockResolvedValue(null);

      const handler = getHandler('get', '/user/:id/public');
      const req = mockReq({ params: { id: '999' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetPublicProfile).toHaveBeenCalledWith(999);
      expect(res._status).toBe(404);
      expect(res._json).toEqual({ error: 'Profile not found or is private' });
    });

    it('passes error to next on failure', async () => {
      mockGetPublicProfile.mockRejectedValue(new Error('DB error'));

      const handler = getHandler('get', '/user/:id/public');
      const req = mockReq({ params: { id: '2' } });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('GET /user/rank', () => {
    it('authMiddleware is present on the route', () => {
      const stack = getRouteStack('get', '/user/rank');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
    });

    it('returns rank for authenticated user', async () => {
      const rank = { elo: 1500, tier: 'Gold', position: 42 };
      mockGetUserRank.mockResolvedValue(rank);

      const handler = getHandler('get', '/user/rank');
      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetUserRank).toHaveBeenCalledWith(1);
      expect(res._json).toEqual(rank);
    });

    it('passes error to next on failure', async () => {
      mockGetUserRank.mockRejectedValue(new Error('Rank error'));

      const handler = getHandler('get', '/user/rank');
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

// Mock services
const mockGetAllCosmetics = jest.fn<AnyFn>();
const mockGetUserCosmetics = jest.fn<AnyFn>();
const mockGetEquippedCosmetics = jest.fn<AnyFn>();
const mockEquipCosmetic = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/cosmetics', () => ({
  getAllCosmetics: mockGetAllCosmetics,
  getUserCosmetics: mockGetUserCosmetics,
  getEquippedCosmetics: mockGetEquippedCosmetics,
  equipCosmetic: mockEquipCosmetic,
}));

const mockGetAllAchievements = jest.fn<AnyFn>();
const mockGetUserAchievements = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/achievements', () => ({
  getAllAchievements: mockGetAllAchievements,
  getUserAchievements: mockGetUserAchievements,
}));

// Mock middleware
const mockAuthMiddleware = jest.fn<AnyFn>((_req, _res, next) => next());
jest.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: mockAuthMiddleware,
}));

const mockValidate = jest.fn<AnyFn>(() => (_req: any, _res: any, next: any) => next());
jest.mock('../../../backend/src/middleware/validation', () => ({
  validate: mockValidate,
}));

import router from '../../../backend/src/routes/cosmetics';

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

describe('Cosmetics Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Middleware presence', () => {
    it('GET /cosmetics has no authMiddleware', () => {
      const stack = getRouteStack('get', '/cosmetics');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).not.toContain(mockAuthMiddleware);
    });

    it('authMiddleware is on GET /cosmetics/mine', () => {
      const stack = getRouteStack('get', '/cosmetics/mine');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
    });

    it('authMiddleware is on GET /cosmetics/equipped', () => {
      const stack = getRouteStack('get', '/cosmetics/equipped');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
    });

    it('authMiddleware is on PUT /cosmetics/equip', () => {
      const stack = getRouteStack('put', '/cosmetics/equip');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
    });

    it('PUT /cosmetics/equip has validation middleware', () => {
      const stack = getRouteStack('put', '/cosmetics/equip');
      // Should have authMiddleware + validate + handler = at least 3
      expect(stack.length).toBeGreaterThanOrEqual(3);
    });

    it('GET /achievements has no authMiddleware', () => {
      const stack = getRouteStack('get', '/achievements');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).not.toContain(mockAuthMiddleware);
    });

    it('authMiddleware is on GET /achievements/mine', () => {
      const stack = getRouteStack('get', '/achievements/mine');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
    });
  });

  describe('GET /cosmetics', () => {
    it('returns all active cosmetics', async () => {
      const cosmetics = [
        { id: 1, name: 'Red Trail', slot: 'trail', rarity: 'common' },
        { id: 2, name: 'Blue Eyes', slot: 'eyes', rarity: 'rare' },
      ];
      mockGetAllCosmetics.mockResolvedValue(cosmetics);

      const handler = getHandler('get', '/cosmetics');
      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetAllCosmetics).toHaveBeenCalledWith(true);
      expect(res._json).toEqual({ cosmetics });
    });

    it('passes error to next on failure', async () => {
      mockGetAllCosmetics.mockRejectedValue(new Error('DB error'));

      const handler = getHandler('get', '/cosmetics');
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('GET /cosmetics/mine', () => {
    it('returns user unlocked cosmetics', async () => {
      const cosmetics = [{ id: 1, name: 'Red Trail', slot: 'trail', unlockedAt: '2026-01-01' }];
      mockGetUserCosmetics.mockResolvedValue(cosmetics);

      const handler = getHandler('get', '/cosmetics/mine');
      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetUserCosmetics).toHaveBeenCalledWith(1);
      expect(res._json).toEqual({ cosmetics });
    });

    it('passes error to next on failure', async () => {
      mockGetUserCosmetics.mockRejectedValue(new Error('DB error'));

      const handler = getHandler('get', '/cosmetics/mine');
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('GET /cosmetics/equipped', () => {
    it('returns equipped cosmetics for user', async () => {
      const equipped = { color: null, eyes: 1, trail: null, bomb_skin: 2 };
      mockGetEquippedCosmetics.mockResolvedValue(equipped);

      const handler = getHandler('get', '/cosmetics/equipped');
      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetEquippedCosmetics).toHaveBeenCalledWith(1);
      expect(res._json).toEqual(equipped);
    });

    it('passes error to next on failure', async () => {
      mockGetEquippedCosmetics.mockRejectedValue(new Error('DB error'));

      const handler = getHandler('get', '/cosmetics/equipped');
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('PUT /cosmetics/equip', () => {
    it('equips cosmetic and returns updated equipped state', async () => {
      mockEquipCosmetic.mockResolvedValue(undefined);
      const equipped = { color: null, eyes: 3, trail: null, bomb_skin: null };
      mockGetEquippedCosmetics.mockResolvedValue(equipped);

      const handler = getHandler('put', '/cosmetics/equip');
      const req = mockReq({ body: { slot: 'eyes', cosmeticId: 3 } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockEquipCosmetic).toHaveBeenCalledWith(1, 'eyes', 3);
      expect(mockGetEquippedCosmetics).toHaveBeenCalledWith(1);
      expect(res._json).toEqual(equipped);
    });

    it('supports unequipping with null cosmeticId', async () => {
      mockEquipCosmetic.mockResolvedValue(undefined);
      const equipped = { color: null, eyes: null, trail: null, bomb_skin: null };
      mockGetEquippedCosmetics.mockResolvedValue(equipped);

      const handler = getHandler('put', '/cosmetics/equip');
      const req = mockReq({ body: { slot: 'trail', cosmeticId: null } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockEquipCosmetic).toHaveBeenCalledWith(1, 'trail', null);
      expect(mockGetEquippedCosmetics).toHaveBeenCalledWith(1);
      expect(res._json).toEqual(equipped);
    });

    it('passes error to next on failure', async () => {
      mockEquipCosmetic.mockRejectedValue(new Error('Equip failed'));

      const handler = getHandler('put', '/cosmetics/equip');
      const req = mockReq({ body: { slot: 'eyes', cosmeticId: 3 } });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('GET /achievements', () => {
    it('returns all active achievements', async () => {
      const achievements = [
        { id: 1, name: 'First Blood', description: 'Get your first kill' },
        { id: 2, name: 'Survivor', description: 'Win 10 games' },
      ];
      mockGetAllAchievements.mockResolvedValue(achievements);

      const handler = getHandler('get', '/achievements');
      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetAllAchievements).toHaveBeenCalledWith(true);
      expect(res._json).toEqual({ achievements });
    });

    it('passes error to next on failure', async () => {
      mockGetAllAchievements.mockRejectedValue(new Error('DB error'));

      const handler = getHandler('get', '/achievements');
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('GET /achievements/mine', () => {
    it('returns user achievements', async () => {
      const achievements = [
        { id: 1, name: 'First Blood', progress: 1, target: 1, unlockedAt: '2026-01-15' },
      ];
      mockGetUserAchievements.mockResolvedValue(achievements);

      const handler = getHandler('get', '/achievements/mine');
      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetUserAchievements).toHaveBeenCalledWith(1);
      expect(res._json).toEqual({ achievements });
    });

    it('passes error to next on failure', async () => {
      mockGetUserAchievements.mockRejectedValue(new Error('DB error'));

      const handler = getHandler('get', '/achievements/mine');
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});

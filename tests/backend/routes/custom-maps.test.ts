import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

// Mock services
const mockListMyMaps = jest.fn<AnyFn>();
const mockListPublishedMaps = jest.fn<AnyFn>();
const mockGetMap = jest.fn<AnyFn>();
const mockCreateMap = jest.fn<AnyFn>();
const mockUpdateMap = jest.fn<AnyFn>();
const mockDeleteMap = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/custom-maps', () => ({
  listMyMaps: mockListMyMaps,
  listPublishedMaps: mockListPublishedMaps,
  getMap: mockGetMap,
  createMap: mockCreateMap,
  updateMap: mockUpdateMap,
  deleteMap: mockDeleteMap,
}));

const mockValidateCustomMap = jest.fn<AnyFn>();
jest.mock('@blast-arena/shared', () => ({
  validateCustomMap: mockValidateCustomMap,
}));

// Mock middleware as pass-through
const mockAuthMiddleware = jest.fn<AnyFn>((_req, _res, next) => next());
jest.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: mockAuthMiddleware,
}));

const mockEmailVerifiedMiddleware = jest.fn<AnyFn>((_req, _res, next) => next());
jest.mock('../../../backend/src/middleware/emailVerified', () => ({
  emailVerifiedMiddleware: mockEmailVerifiedMiddleware,
}));

const mockValidate = jest.fn<AnyFn>(() => (_req: any, _res: any, next: any) => next());
jest.mock('../../../backend/src/middleware/validation', () => ({
  validate: mockValidate,
}));

import customMapsRouter from '../../../backend/src/routes/custom-maps';

type RouteLayer = {
  route: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: Function; name?: string }>;
  };
};

function getHandler(method: string, path: string) {
  const stack = (customMapsRouter as any).stack as RouteLayer[];
  const layer = stack.find((l: RouteLayer) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  const routeStack = layer.route.stack;
  return routeStack[routeStack.length - 1].handle;
}

function getRouteStack(method: string, path: string) {
  const stack = (customMapsRouter as any).stack as RouteLayer[];
  const layer = stack.find((l: RouteLayer) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  return layer.route.stack;
}

function mockReq(overrides: Record<string, unknown> = {}): any {
  return {
    body: {},
    params: {},
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

describe('Custom Maps Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Middleware presence', () => {
    it('authMiddleware and emailVerifiedMiddleware on GET /maps/mine', () => {
      const stack = getRouteStack('get', '/maps/mine');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
      expect(middlewareFns).toContain(mockEmailVerifiedMiddleware);
    });

    it('authMiddleware and emailVerifiedMiddleware on GET /maps/published', () => {
      const stack = getRouteStack('get', '/maps/published');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
      expect(middlewareFns).toContain(mockEmailVerifiedMiddleware);
    });

    it('authMiddleware and emailVerifiedMiddleware on GET /maps/:id', () => {
      const stack = getRouteStack('get', '/maps/:id');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
      expect(middlewareFns).toContain(mockEmailVerifiedMiddleware);
    });

    it('authMiddleware, emailVerifiedMiddleware, and validation on POST /maps', () => {
      const stack = getRouteStack('post', '/maps');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
      expect(middlewareFns).toContain(mockEmailVerifiedMiddleware);
      expect(stack.length).toBeGreaterThanOrEqual(4);
    });

    it('authMiddleware, emailVerifiedMiddleware, and validation on PUT /maps/:id', () => {
      const stack = getRouteStack('put', '/maps/:id');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
      expect(middlewareFns).toContain(mockEmailVerifiedMiddleware);
      expect(stack.length).toBeGreaterThanOrEqual(4);
    });

    it('authMiddleware and emailVerifiedMiddleware on DELETE /maps/:id', () => {
      const stack = getRouteStack('delete', '/maps/:id');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
      expect(middlewareFns).toContain(mockEmailVerifiedMiddleware);
    });
  });

  describe('GET /maps/mine', () => {
    it('returns maps for current user', async () => {
      const maps = [{ id: 1, name: 'My Map' }];
      mockListMyMaps.mockResolvedValue(maps);

      const handler = getHandler('get', '/maps/mine');
      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockListMyMaps).toHaveBeenCalledWith(1);
      expect(res._json).toEqual({ maps });
    });

    it('passes error to next on failure', async () => {
      mockListMyMaps.mockRejectedValue(new Error('DB error'));

      const handler = getHandler('get', '/maps/mine');
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('GET /maps/published', () => {
    it('returns all published maps', async () => {
      const maps = [{ id: 2, name: 'Public Map' }];
      mockListPublishedMaps.mockResolvedValue(maps);

      const handler = getHandler('get', '/maps/published');
      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockListPublishedMaps).toHaveBeenCalled();
      expect(res._json).toEqual({ maps });
    });
  });

  describe('GET /maps/:id', () => {
    it('returns map when user is owner', async () => {
      const map = { id: 5, name: 'My Map', createdBy: 1, isPublished: false };
      mockGetMap.mockResolvedValue(map);

      const handler = getHandler('get', '/maps/:id');
      const req = mockReq({ params: { id: '5' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetMap).toHaveBeenCalledWith(5);
      expect(res._json).toEqual({ map });
    });

    it('returns map when it is published and user is not owner', async () => {
      const map = { id: 5, name: 'Public Map', createdBy: 99, isPublished: true };
      mockGetMap.mockResolvedValue(map);

      const handler = getHandler('get', '/maps/:id');
      const req = mockReq({ params: { id: '5' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(res._json).toEqual({ map });
    });

    it('throws 404 when map is unpublished and user is not owner', async () => {
      const map = { id: 5, name: 'Private Map', createdBy: 99, isPublished: false };
      mockGetMap.mockResolvedValue(map);

      const handler = getHandler('get', '/maps/:id');
      const req = mockReq({ params: { id: '5' } });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Map not found', statusCode: 404 }),
      );
    });

    it('throws 404 when map does not exist', async () => {
      mockGetMap.mockResolvedValue(null);

      const handler = getHandler('get', '/maps/:id');
      const req = mockReq({ params: { id: '999' } });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Map not found', statusCode: 404 }),
      );
    });

    it('throws 400 for invalid (non-numeric) map ID', async () => {
      const handler = getHandler('get', '/maps/:id');
      const req = mockReq({ params: { id: 'abc' } });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid map ID', statusCode: 400 }),
      );
      expect(mockGetMap).not.toHaveBeenCalled();
    });
  });

  describe('POST /maps', () => {
    it('creates map and returns 201 with id', async () => {
      mockValidateCustomMap.mockReturnValue([]);
      mockCreateMap.mockResolvedValue(42);

      const handler = getHandler('post', '/maps');
      const req = mockReq({
        body: {
          name: 'New Map',
          description: 'A map',
          mapWidth: 11,
          mapHeight: 11,
          tiles: [['empty']],
          spawnPoints: [{ x: 1, y: 1 }],
          isPublished: false,
        },
      });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockValidateCustomMap).toHaveBeenCalledWith([['empty']], 11, 11);
      expect(mockCreateMap).toHaveBeenCalledWith(
        {
          name: 'New Map',
          description: 'A map',
          mapWidth: 11,
          mapHeight: 11,
          tiles: [['empty']],
          spawnPoints: [{ x: 1, y: 1 }],
          isPublished: false,
        },
        1,
      );
      expect(res._status).toBe(201);
      expect(res._json).toEqual({ id: 42 });
    });

    it('throws 400 when validateCustomMap returns errors', async () => {
      mockValidateCustomMap.mockReturnValue(['Dimensions must be odd']);

      const handler = getHandler('post', '/maps');
      const req = mockReq({
        body: {
          name: 'Bad Map',
          mapWidth: 10,
          mapHeight: 10,
          tiles: [],
          spawnPoints: [],
        },
      });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Dimensions must be odd', statusCode: 400 }),
      );
      expect(mockCreateMap).not.toHaveBeenCalled();
    });
  });

  describe('PUT /maps/:id', () => {
    it('updates map and returns success', async () => {
      mockValidateCustomMap.mockReturnValue([]);
      mockUpdateMap.mockResolvedValue(true);

      const handler = getHandler('put', '/maps/:id');
      const req = mockReq({
        params: { id: '10' },
        body: {
          name: 'Updated',
          description: 'New desc',
          mapWidth: 13,
          mapHeight: 13,
          tiles: [['wall']],
          spawnPoints: [{ x: 0, y: 0 }],
          isPublished: true,
        },
      });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockUpdateMap).toHaveBeenCalledWith(
        10,
        {
          name: 'Updated',
          description: 'New desc',
          mapWidth: 13,
          mapHeight: 13,
          tiles: [['wall']],
          spawnPoints: [{ x: 0, y: 0 }],
          isPublished: true,
        },
        1,
      );
      expect(res._json).toEqual({ success: true });
    });

    it('throws 404 when update returns false (not owned)', async () => {
      mockValidateCustomMap.mockReturnValue([]);
      mockUpdateMap.mockResolvedValue(false);

      const handler = getHandler('put', '/maps/:id');
      const req = mockReq({
        params: { id: '10' },
        body: {
          name: 'X',
          mapWidth: 11,
          mapHeight: 11,
          tiles: [],
          spawnPoints: [],
        },
      });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Map not found or not owned by you', statusCode: 404 }),
      );
    });

    it('throws 400 for invalid map ID', async () => {
      const handler = getHandler('put', '/maps/:id');
      const req = mockReq({ params: { id: 'xyz' }, body: {} });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid map ID', statusCode: 400 }),
      );
    });

    it('throws 400 when validateCustomMap fails', async () => {
      mockValidateCustomMap.mockReturnValue(['Need at least 2 spawns']);

      const handler = getHandler('put', '/maps/:id');
      const req = mockReq({
        params: { id: '10' },
        body: {
          name: 'Bad',
          mapWidth: 11,
          mapHeight: 11,
          tiles: [],
          spawnPoints: [],
        },
      });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Need at least 2 spawns', statusCode: 400 }),
      );
      expect(mockUpdateMap).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /maps/:id', () => {
    it('deletes map and returns success', async () => {
      mockDeleteMap.mockResolvedValue(true);

      const handler = getHandler('delete', '/maps/:id');
      const req = mockReq({ params: { id: '10' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockDeleteMap).toHaveBeenCalledWith(10, 1);
      expect(res._json).toEqual({ success: true });
    });

    it('throws 404 when delete returns false', async () => {
      mockDeleteMap.mockResolvedValue(false);

      const handler = getHandler('delete', '/maps/:id');
      const req = mockReq({ params: { id: '10' } });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Map not found or not owned by you', statusCode: 404 }),
      );
    });

    it('throws 400 for invalid map ID', async () => {
      const handler = getHandler('delete', '/maps/:id');
      const req = mockReq({ params: { id: 'bad' } });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid map ID', statusCode: 400 }),
      );
      expect(mockDeleteMap).not.toHaveBeenCalled();
    });
  });
});

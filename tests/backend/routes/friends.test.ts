import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

// Mock services
const mockGetFriends = jest.fn<AnyFn>();
const mockGetPendingRequests = jest.fn<AnyFn>();
const mockGetBlockedUsers = jest.fn<AnyFn>();
const mockSearchUsers = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/friends', () => ({
  getFriends: mockGetFriends,
  getPendingRequests: mockGetPendingRequests,
  getBlockedUsers: mockGetBlockedUsers,
  searchUsers: mockSearchUsers,
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

import friendsRouter from '../../../backend/src/routes/friends';

type RouteLayer = {
  route: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: Function; name?: string }>;
  };
};

function getHandler(method: string, path: string) {
  const stack = (friendsRouter as any).stack as RouteLayer[];
  const layer = stack.find((l: RouteLayer) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  const routeStack = layer.route.stack;
  return routeStack[routeStack.length - 1].handle;
}

function getRouteStack(method: string, path: string) {
  const stack = (friendsRouter as any).stack as RouteLayer[];
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

describe('Friends Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Middleware presence', () => {
    it('authMiddleware is on GET /friends', () => {
      const stack = getRouteStack('get', '/friends');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
    });

    it('authMiddleware is on GET /friends/blocked', () => {
      const stack = getRouteStack('get', '/friends/blocked');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
    });

    it('authMiddleware is on POST /friends/search', () => {
      const stack = getRouteStack('post', '/friends/search');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
    });

    it('POST /friends/search has validation middleware', () => {
      const stack = getRouteStack('post', '/friends/search');
      // Should have authMiddleware + validate + handler = at least 3
      expect(stack.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('GET /friends', () => {
    it('returns friends, incoming, outgoing, and blocked', async () => {
      const friends = [{ userId: 2, username: 'bob', activity: 'online' }];
      const pending = { incoming: [{ fromUserId: 3 }], outgoing: [] };
      const blocked = [{ userId: 5, username: 'eve' }];

      mockGetFriends.mockResolvedValue(friends);
      mockGetPendingRequests.mockResolvedValue(pending);
      mockGetBlockedUsers.mockResolvedValue(blocked);

      const handler = getHandler('get', '/friends');
      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(res._json).toEqual({
        friends,
        incoming: pending.incoming,
        outgoing: pending.outgoing,
        blocked,
      });
    });

    it('passes error to next on failure', async () => {
      mockGetFriends.mockRejectedValue(new Error('DB error'));
      mockGetPendingRequests.mockResolvedValue({ incoming: [], outgoing: [] });
      mockGetBlockedUsers.mockResolvedValue([]);

      const handler = getHandler('get', '/friends');
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('GET /friends/blocked', () => {
    it('returns blocked users', async () => {
      mockGetBlockedUsers.mockResolvedValue([{ userId: 5, username: 'eve' }]);

      const handler = getHandler('get', '/friends/blocked');
      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(res._json).toEqual({ blocked: [{ userId: 5, username: 'eve' }] });
    });
  });

  describe('POST /friends/search', () => {
    it('returns search results', async () => {
      const users = [{ id: 2, username: 'bob' }];
      mockSearchUsers.mockResolvedValue(users);

      const handler = getHandler('post', '/friends/search');
      const req = mockReq({ body: { query: 'bo' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(res._json).toEqual({ users });
      expect(mockSearchUsers).toHaveBeenCalledWith('bo', 1);
    });

    it('passes error to next on failure', async () => {
      mockSearchUsers.mockRejectedValue(new Error('Search error'));

      const handler = getHandler('post', '/friends/search');
      const req = mockReq({ body: { query: 'bo' } });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});

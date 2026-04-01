import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

// Mock services
const mockGetConversationList = jest.fn<AnyFn>();
const mockGetUnreadCounts = jest.fn<AnyFn>();
const mockGetConversation = jest.fn<AnyFn>();
const mockMarkRead = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/messages', () => ({
  getConversationList: mockGetConversationList,
  getUnreadCounts: mockGetUnreadCounts,
  getConversation: mockGetConversation,
  markRead: mockMarkRead,
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

import messagesRouter from '../../../backend/src/routes/messages';

type RouteLayer = {
  route: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: Function; name?: string }>;
  };
};

function getHandler(method: string, path: string) {
  const stack = (messagesRouter as any).stack as RouteLayer[];
  const layer = stack.find((l: RouteLayer) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  const routeStack = layer.route.stack;
  return routeStack[routeStack.length - 1].handle;
}

function getRouteStack(method: string, path: string) {
  const stack = (messagesRouter as any).stack as RouteLayer[];
  const layer = stack.find((l: RouteLayer) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  return layer.route.stack;
}

function mockReq(overrides: Record<string, unknown> = {}): any {
  return {
    body: {},
    params: {},
    query: {},
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

describe('Messages Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Middleware presence', () => {
    it('authMiddleware and emailVerifiedMiddleware on GET /messages', () => {
      const stack = getRouteStack('get', '/messages');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
      expect(middlewareFns).toContain(mockEmailVerifiedMiddleware);
    });

    it('authMiddleware and emailVerifiedMiddleware on GET /messages/unread', () => {
      const stack = getRouteStack('get', '/messages/unread');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
      expect(middlewareFns).toContain(mockEmailVerifiedMiddleware);
    });

    it('authMiddleware and emailVerifiedMiddleware on GET /messages/:userId', () => {
      const stack = getRouteStack('get', '/messages/:userId');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
      expect(middlewareFns).toContain(mockEmailVerifiedMiddleware);
    });

    it('authMiddleware and emailVerifiedMiddleware on PUT /messages/:userId/read', () => {
      const stack = getRouteStack('put', '/messages/:userId/read');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
      expect(middlewareFns).toContain(mockEmailVerifiedMiddleware);
    });
  });

  describe('GET /messages', () => {
    it('returns conversation list for current user', async () => {
      const conversations = [{ userId: 2, username: 'bob', lastMessage: 'hi', unreadCount: 1 }];
      mockGetConversationList.mockResolvedValue(conversations);

      const handler = getHandler('get', '/messages');
      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetConversationList).toHaveBeenCalledWith(1);
      expect(res._json).toEqual({ conversations });
    });

    it('passes error to next on failure', async () => {
      mockGetConversationList.mockRejectedValue(new Error('DB error'));

      const handler = getHandler('get', '/messages');
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('GET /messages/unread', () => {
    it('returns unread counts for current user', async () => {
      const counts = { 2: 3, 5: 1 };
      mockGetUnreadCounts.mockResolvedValue(counts);

      const handler = getHandler('get', '/messages/unread');
      const req = mockReq();
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetUnreadCounts).toHaveBeenCalledWith(1);
      expect(res._json).toEqual({ counts });
    });

    it('passes error to next on failure', async () => {
      mockGetUnreadCounts.mockRejectedValue(new Error('DB error'));

      const handler = getHandler('get', '/messages/unread');
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('GET /messages/:userId', () => {
    it('returns paginated conversation with default page and limit', async () => {
      const result = { messages: [], total: 0, page: 1, limit: 20 };
      mockGetConversation.mockResolvedValue(result);

      const handler = getHandler('get', '/messages/:userId');
      const req = mockReq({ params: { userId: '5' }, query: {} });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetConversation).toHaveBeenCalledWith(1, 5, 1, 20);
      expect(res._json).toEqual(result);
    });

    it('parses page and limit from query params', async () => {
      const result = { messages: [], total: 50, page: 3, limit: 10 };
      mockGetConversation.mockResolvedValue(result);

      const handler = getHandler('get', '/messages/:userId');
      const req = mockReq({ params: { userId: '5' }, query: { page: '3', limit: '10' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetConversation).toHaveBeenCalledWith(1, 5, 3, 10);
    });

    it('caps limit at 50', async () => {
      const result = { messages: [], total: 0, page: 1, limit: 50 };
      mockGetConversation.mockResolvedValue(result);

      const handler = getHandler('get', '/messages/:userId');
      const req = mockReq({ params: { userId: '5' }, query: { limit: '200' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockGetConversation).toHaveBeenCalledWith(1, 5, 1, 50);
    });

    it('returns 400 for non-numeric userId', async () => {
      const handler = getHandler('get', '/messages/:userId');
      const req = mockReq({ params: { userId: 'abc' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(res._status).toBe(400);
      expect(res._json).toEqual({ error: 'Invalid user ID' });
      expect(mockGetConversation).not.toHaveBeenCalled();
    });

    it('passes error to next on failure', async () => {
      mockGetConversation.mockRejectedValue(new Error('DB error'));

      const handler = getHandler('get', '/messages/:userId');
      const req = mockReq({ params: { userId: '5' }, query: {} });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('PUT /messages/:userId/read', () => {
    it('marks messages as read and returns success message', async () => {
      mockMarkRead.mockResolvedValue(undefined);

      const handler = getHandler('put', '/messages/:userId/read');
      const req = mockReq({ params: { userId: '5' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(mockMarkRead).toHaveBeenCalledWith(1, 5);
      expect(res._json).toEqual({ message: 'Messages marked as read' });
    });

    it('returns 400 for non-numeric userId', async () => {
      const handler = getHandler('put', '/messages/:userId/read');
      const req = mockReq({ params: { userId: 'bad' } });
      const res = mockRes();
      await handler(req, res, jest.fn());

      expect(res._status).toBe(400);
      expect(res._json).toEqual({ error: 'Invalid user ID' });
      expect(mockMarkRead).not.toHaveBeenCalled();
    });

    it('passes error to next on failure', async () => {
      mockMarkRead.mockRejectedValue(new Error('DB error'));

      const handler = getHandler('put', '/messages/:userId/read');
      const req = mockReq({ params: { userId: '5' } });
      const res = mockRes();
      const next = jest.fn();
      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});

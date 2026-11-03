import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = (...args: any[]) => any;

const mockListRooms = vi.hoisted(() => vi.fn<AnyFn>());
const mockCreateRoom = vi.hoisted(() => vi.fn<AnyFn>());

vi.mock('../../../backend/src/services/lobby', () => ({
  listRooms: mockListRooms,
  createRoom: mockCreateRoom,
}));

// Mock middleware to pass through
vi.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../../../backend/src/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import lobbyRouter from '../../../backend/src/routes/lobby';
import { authMiddleware } from '../../../backend/src/middleware/auth';
import { Request, Response, NextFunction } from 'express';

type HandlerFn = (req: Request, res: Response, next: NextFunction) => Promise<void>;

type RouteLayer = {
  route: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: HandlerFn }>;
  };
};

function getHandler(method: string, path: string): HandlerFn {
  const stack = (lobbyRouter as any).stack as RouteLayer[];
  const layer = stack.find((l) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  const routeStack = layer.route.stack;
  return routeStack[routeStack.length - 1].handle;
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

describe('GET /lobby/rooms', () => {
  let handler: (req: Request, res: Response, next: NextFunction) => Promise<void>;

  beforeEach(() => {
    handler = getHandler('get', '/lobby/rooms');
    vi.clearAllMocks();
  });

  it('returns room list on success', async () => {
    const rooms = [
      { id: 'room-1', name: 'Test Room', players: 2 },
      { id: 'room-2', name: 'Another Room', players: 4 },
    ];
    mockListRooms.mockResolvedValue(rooms);

    const res = mockRes();
    const next = vi.fn();
    await handler({} as Request, res as unknown as Response, next as NextFunction);

    expect(res._json).toEqual(rooms);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns empty array when no rooms', async () => {
    mockListRooms.mockResolvedValue([]);

    const res = mockRes();
    const next = vi.fn();
    await handler({} as Request, res as unknown as Response, next as NextFunction);

    expect(res._json).toEqual([]);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls listRooms without arguments', async () => {
    mockListRooms.mockResolvedValue([]);

    const res = mockRes();
    const next = vi.fn();
    await handler({} as Request, res as unknown as Response, next as NextFunction);

    expect(mockListRooms).toHaveBeenCalledTimes(1);
    expect(mockListRooms).toHaveBeenCalledWith();
  });

  it('passes error to next() on service failure', async () => {
    const error = new Error('Database connection lost');
    mockListRooms.mockRejectedValue(error);

    const res = mockRes();
    const next = vi.fn();
    await handler({} as Request, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('Middleware presence', () => {
  it('GET /lobby/rooms has authMiddleware', () => {
    const stack = (lobbyRouter as any).stack as RouteLayer[];
    const layer = stack.find((l) => l.route?.path === '/lobby/rooms' && l.route.methods.get);
    expect(layer).toBeDefined();

    const handlers = layer!.route.stack.map((s) => s.handle);
    expect(handlers).toContain(authMiddleware);
  });

  it('has no POST /lobby/rooms — rooms are created over the socket (audit G6)', () => {
    const stack = (lobbyRouter as any).stack as RouteLayer[];
    const postLayer = stack.find((l) => l.route?.path === '/lobby/rooms' && l.route.methods.post);
    expect(postLayer).toBeUndefined();
    expect(mockCreateRoom).not.toHaveBeenCalled();
  });

  it('GET /lobby/rooms has auth + emailVerified + handler', () => {
    const stack = (lobbyRouter as any).stack as RouteLayer[];
    const getLayer = stack.find((l) => l.route?.path === '/lobby/rooms' && l.route.methods.get);
    expect(getLayer!.route.stack.length).toBe(3);
  });
});

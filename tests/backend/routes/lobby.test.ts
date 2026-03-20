import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

const mockListRooms = jest.fn<AnyFn>();
const mockCreateRoom = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/lobby', () => ({
  listRooms: mockListRooms,
  createRoom: mockCreateRoom,
}));

// Mock middleware to pass through
jest.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: jest.fn((_req: any, _res: any, next: any) => next()),
}));
jest.mock('../../../backend/src/middleware/validation', () => ({
  validate: jest.fn(() => (_req: any, _res: any, next: any) => next()),
}));

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import lobbyRouter from '../../../backend/src/routes/lobby';
import { authMiddleware } from '../../../backend/src/middleware/auth';
import { validate } from '../../../backend/src/middleware/validation';
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
    jest.clearAllMocks();
  });

  it('returns room list on success', async () => {
    const rooms = [
      { id: 'room-1', name: 'Test Room', players: 2 },
      { id: 'room-2', name: 'Another Room', players: 4 },
    ];
    mockListRooms.mockResolvedValue(rooms);

    const res = mockRes();
    const next = jest.fn();
    await handler({} as Request, res as unknown as Response, next as NextFunction);

    expect(res._json).toEqual(rooms);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns empty array when no rooms', async () => {
    mockListRooms.mockResolvedValue([]);

    const res = mockRes();
    const next = jest.fn();
    await handler({} as Request, res as unknown as Response, next as NextFunction);

    expect(res._json).toEqual([]);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls listRooms without arguments', async () => {
    mockListRooms.mockResolvedValue([]);

    const res = mockRes();
    const next = jest.fn();
    await handler({} as Request, res as unknown as Response, next as NextFunction);

    expect(mockListRooms).toHaveBeenCalledTimes(1);
    expect(mockListRooms).toHaveBeenCalledWith();
  });

  it('passes error to next() on service failure', async () => {
    const error = new Error('Database connection lost');
    mockListRooms.mockRejectedValue(error);

    const res = mockRes();
    const next = jest.fn();
    await handler({} as Request, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('POST /lobby/rooms', () => {
  let handler: (req: Request, res: Response, next: NextFunction) => Promise<void>;

  beforeEach(() => {
    handler = getHandler('post', '/lobby/rooms');
    jest.clearAllMocks();
  });

  it('returns 201 with created room on success', async () => {
    const createdRoom = { id: 'room-abc', name: 'My Room', hostId: 1 };
    mockCreateRoom.mockResolvedValue(createdRoom);

    const req = {
      user: { userId: 1, username: 'alice', role: 'user' },
      body: {
        name: 'My Room',
        config: { gameMode: 'ffa', maxPlayers: 4 },
      },
    } as unknown as Request;

    const res = mockRes();
    const next = jest.fn();
    await handler(req, res as unknown as Response, next as NextFunction);

    expect(res._status).toBe(201);
    expect(res._json).toEqual(createdRoom);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes user info (userId, username, role) from req.user to createRoom', async () => {
    mockCreateRoom.mockResolvedValue({ id: 'room-xyz' });

    const req = {
      user: { userId: 42, username: 'bob', role: 'admin' },
      body: {
        name: 'Admin Room',
        config: { gameMode: 'teams', maxPlayers: 8 },
      },
    } as unknown as Request;

    const res = mockRes();
    const next = jest.fn();
    await handler(req, res as unknown as Response, next as NextFunction);

    expect(mockCreateRoom).toHaveBeenCalledWith(
      { id: 42, username: 'bob', role: 'admin' },
      'Admin Room',
      { gameMode: 'teams', maxPlayers: 8 },
    );
  });

  it('passes name and config from req.body to createRoom', async () => {
    mockCreateRoom.mockResolvedValue({ id: 'room-123' });

    const config = {
      gameMode: 'battle_royale',
      maxPlayers: 6,
      mapWidth: 19,
      mapHeight: 15,
      roundTime: 300,
    };
    const req = {
      user: { userId: 1, username: 'eve', role: 'user' },
      body: { name: 'BR Match', config },
    } as unknown as Request;

    const res = mockRes();
    const next = jest.fn();
    await handler(req, res as unknown as Response, next as NextFunction);

    expect(mockCreateRoom).toHaveBeenCalledWith(expect.anything(), 'BR Match', config);
  });

  it('constructs user object with id mapped from userId', async () => {
    mockCreateRoom.mockResolvedValue({ id: 'room-999' });

    const req = {
      user: { userId: 77, username: 'charlie', role: 'moderator' },
      body: {
        name: 'Mod Room',
        config: { gameMode: 'ffa', maxPlayers: 2 },
      },
    } as unknown as Request;

    const res = mockRes();
    const next = jest.fn();
    await handler(req, res as unknown as Response, next as NextFunction);

    const userArg = mockCreateRoom.mock.calls[0][0];
    expect(userArg).toEqual({ id: 77, username: 'charlie', role: 'moderator' });
    expect(userArg).not.toHaveProperty('userId');
  });

  it('passes error to next() on service failure', async () => {
    const error = new Error('Room creation failed');
    mockCreateRoom.mockRejectedValue(error);

    const req = {
      user: { userId: 1, username: 'alice', role: 'user' },
      body: {
        name: 'Failing Room',
        config: { gameMode: 'ffa', maxPlayers: 4 },
      },
    } as unknown as Request;

    const res = mockRes();
    const next = jest.fn();
    await handler(req, res as unknown as Response, next as NextFunction);

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

  it('POST /lobby/rooms has authMiddleware', () => {
    const stack = (lobbyRouter as any).stack as RouteLayer[];
    const layer = stack.find((l) => l.route?.path === '/lobby/rooms' && l.route.methods.post);
    expect(layer).toBeDefined();

    const handlers = layer!.route.stack.map((s) => s.handle);
    expect(handlers).toContain(authMiddleware);
  });

  it('POST /lobby/rooms has validate middleware', () => {
    const stack = (lobbyRouter as any).stack as RouteLayer[];

    const getLayer = stack.find((l) => l.route?.path === '/lobby/rooms' && l.route.methods.get);
    const postLayer = stack.find(
      (l) => l.route?.path === '/lobby/rooms' && l.route.methods.post,
    );
    expect(postLayer).toBeDefined();

    // GET has 2 handlers (authMiddleware + handler), POST has 3 (authMiddleware + validate + handler)
    expect(getLayer!.route.stack.length).toBe(2);
    expect(postLayer!.route.stack.length).toBe(3);
  });
});

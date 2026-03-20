import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const store = new Map<string, string>();
const mockRedis = {
  get: jest.fn<AnyFn>((key: string) => Promise.resolve(store.get(key) || null)),
  set: jest.fn<AnyFn>((...args: unknown[]) => {
    store.set(args[0] as string, args[1] as string);
    return Promise.resolve('OK');
  }),
  del: jest.fn<AnyFn>((key: string) => {
    store.delete(key);
    return Promise.resolve(1);
  }),
  // SCAN returns all matching keys in a single cursor pass (test simplification)
  scan: jest.fn<AnyFn>((_cursor: string, _matchKw: string, pattern: string) => {
    const prefix = pattern.replace('*', '');
    const matched = [...store.keys()].filter((k) => k.startsWith(prefix));
    return Promise.resolve(['0', matched]);
  }),
  mget: jest.fn<AnyFn>((...keys: string[]) => {
    return Promise.resolve(keys.map((k) => store.get(k) || null));
  }),
  eval: jest.fn<AnyFn>(),
};

jest.mock('../../../backend/src/db/redis', () => ({
  getRedis: () => mockRedis,
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'abcdef-1234-5678-9012'),
}));

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

import {
  createRoom,
  getRoom,
  listRooms,
  joinRoom,
  leaveRoom,
  setPlayerReady,
  setPlayerTeam,
} from '../../../backend/src/services/lobby';

import { AppError } from '../../../backend/src/middleware/errorHandler';

function makeUser(id: number, username: string) {
  return { id, username, role: 'user' as const };
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    gameMode: 'ffa',
    maxPlayers: 4,
    mapWidth: 15,
    mapHeight: 13,
    roundTime: 180,
    ...overrides,
  };
}

describe('lobby service', () => {
  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
    // Re-attach real implementations after clearAllMocks resets them
    mockRedis.get.mockImplementation((key: string) => Promise.resolve(store.get(key) || null));
    mockRedis.set.mockImplementation((...args: unknown[]) => {
      store.set(args[0] as string, args[1] as string);
      return Promise.resolve('OK');
    });
    mockRedis.del.mockImplementation((key: string) => {
      store.delete(key);
      return Promise.resolve(1);
    });
    mockRedis.scan.mockImplementation((_cursor: string, _matchKw: string, pattern: string) => {
      const prefix = pattern.replace('*', '');
      const matched = [...store.keys()].filter((k) => k.startsWith(prefix));
      return Promise.resolve(['0', matched]);
    });
    mockRedis.mget.mockImplementation((...keys: string[]) => {
      return Promise.resolve(keys.map((k) => store.get(k) || null));
    });
    // eval mock: simulate the Lua join script behavior using the in-memory store
    mockRedis.eval.mockImplementation(
      (_script: string, _numKeys: number, roomKey: string, playerRoomKey: string, userJson: string, userIdStr: string) => {
        const data = store.get(roomKey);
        if (!data) return Promise.resolve('ERR:NOT_FOUND');

        const room = JSON.parse(data);
        if (room.status !== 'waiting') return Promise.resolve('ERR:GAME_IN_PROGRESS');
        if (room.players.length >= room.config.maxPlayers) return Promise.resolve('ERR:ROOM_FULL');

        const userId = parseInt(userIdStr);
        if (room.players.some((p: any) => p.user.id === userId)) return Promise.resolve('ERR:ALREADY_IN_ROOM');

        const user = JSON.parse(userJson);
        room.players.push({ user, ready: false, team: null });

        const updated = JSON.stringify(room);
        store.set(roomKey, updated);
        store.set(playerRoomKey, room.code);

        return Promise.resolve(updated);
      },
    );
  });

  // ── createRoom ─────────────────────────────────────────────────────

  describe('createRoom', () => {
    it('stores room in Redis with TTL', async () => {
      const host = makeUser(1, 'alice');
      const config = makeConfig();

      await createRoom(host as any, 'Test Room', config as any);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'room:ABCDEF',
        expect.any(String),
        'EX',
        3600,
      );
    });

    it('returns room with generated 6-char code', async () => {
      const host = makeUser(1, 'alice');
      const config = makeConfig();

      const room = await createRoom(host as any, 'Test Room', config as any);

      expect(room.code).toBe('ABCDEF');
      expect(room.code).toHaveLength(6);
      expect(room.name).toBe('Test Room');
      expect(room.host).toEqual(host);
      expect(room.status).toBe('waiting');
      expect(room.players).toHaveLength(1);
      expect(room.players[0]).toEqual({ user: host, ready: false, team: null });
    });

    it('stores player:userId:room mapping', async () => {
      const host = makeUser(1, 'alice');
      const config = makeConfig();

      await createRoom(host as any, 'Test Room', config as any);

      expect(mockRedis.set).toHaveBeenCalledWith('player:1:room', 'ABCDEF', 'EX', 3600);
    });
  });

  // ── getRoom ────────────────────────────────────────────────────────

  describe('getRoom', () => {
    it('returns parsed room when found', async () => {
      const host = makeUser(1, 'alice');
      const config = makeConfig();
      await createRoom(host as any, 'My Room', config as any);

      const room = await getRoom('ABCDEF');

      expect(room).not.toBeNull();
      expect(room!.code).toBe('ABCDEF');
      expect(room!.name).toBe('My Room');
    });

    it('returns null for missing room', async () => {
      const room = await getRoom('XXXXXX');

      expect(room).toBeNull();
    });
  });

  // ── listRooms ──────────────────────────────────────────────────────

  describe('listRooms', () => {
    it('returns rooms with status waiting or playing', async () => {
      const host = makeUser(1, 'alice');
      const config = makeConfig();

      // Create a waiting room
      await createRoom(host as any, 'Waiting Room', config as any);

      // Manually insert a playing room
      const playingRoom = {
        code: 'PLAY01',
        name: 'Playing Room',
        host,
        players: [{ user: host, ready: true, team: null }],
        config,
        status: 'playing',
        createdAt: new Date(),
      };
      store.set('room:PLAY01', JSON.stringify(playingRoom));

      const rooms = await listRooms();

      expect(rooms).toHaveLength(2);
      const names = rooms.map((r) => r.name);
      expect(names).toContain('Waiting Room');
      expect(names).toContain('Playing Room');
    });

    it('filters out finished rooms', async () => {
      const host = makeUser(1, 'alice');
      const config = makeConfig();

      // Insert a finished room directly
      const finishedRoom = {
        code: 'FIN001',
        name: 'Finished Room',
        host,
        players: [{ user: host, ready: false, team: null }],
        config,
        status: 'finished',
        createdAt: new Date(),
      };
      store.set('room:FIN001', JSON.stringify(finishedRoom));

      // Also a waiting room
      await createRoom(host as any, 'Active Room', config as any);

      const rooms = await listRooms();

      expect(rooms).toHaveLength(1);
      expect(rooms[0].name).toBe('Active Room');
    });
  });

  // ── joinRoom ───────────────────────────────────────────────────────

  describe('joinRoom', () => {
    it('adds player to room on success', async () => {
      const host = makeUser(1, 'alice');
      const joiner = makeUser(2, 'bob');
      const config = makeConfig();
      await createRoom(host as any, 'Room', config as any);

      const room = await joinRoom('ABCDEF', joiner as any);

      expect(room.players).toHaveLength(2);
      expect(room.players[1].user).toEqual(joiner);
      expect(room.players[1].ready).toBe(false);
      expect(room.players[1].team).toBeNull();
    });

    it('throws 404 when room not found', async () => {
      const user = makeUser(1, 'alice');

      await expect(joinRoom('NOPE00', user as any)).rejects.toThrow(AppError);
      await expect(joinRoom('NOPE00', user as any)).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    });

    it('throws 400 when game already in progress', async () => {
      const host = makeUser(1, 'alice');
      const config = makeConfig();
      const playingRoom = {
        code: 'PLAY01',
        name: 'Playing',
        host,
        players: [{ user: host, ready: true, team: null }],
        config,
        status: 'playing',
        createdAt: new Date(),
      };
      store.set('room:PLAY01', JSON.stringify(playingRoom));

      const joiner = makeUser(2, 'bob');

      await expect(joinRoom('PLAY01', joiner as any)).rejects.toThrow(AppError);
      await expect(joinRoom('PLAY01', joiner as any)).rejects.toMatchObject({
        statusCode: 400,
        code: 'GAME_IN_PROGRESS',
      });
    });

    it('throws 400 when room is full', async () => {
      const host = makeUser(1, 'alice');
      const config = makeConfig({ maxPlayers: 2 });
      await createRoom(host as any, 'Small Room', config as any);
      await joinRoom('ABCDEF', makeUser(2, 'bob') as any);

      await expect(joinRoom('ABCDEF', makeUser(3, 'carol') as any)).rejects.toThrow(AppError);
      await expect(joinRoom('ABCDEF', makeUser(3, 'carol') as any)).rejects.toMatchObject({
        statusCode: 400,
        code: 'ROOM_FULL',
      });
    });

    it('throws 400 when already in room', async () => {
      const host = makeUser(1, 'alice');
      const config = makeConfig();
      await createRoom(host as any, 'Room', config as any);

      await expect(joinRoom('ABCDEF', host as any)).rejects.toThrow(AppError);
      await expect(joinRoom('ABCDEF', host as any)).rejects.toMatchObject({
        statusCode: 400,
        code: 'ALREADY_IN_ROOM',
      });
    });
  });

  // ── leaveRoom ──────────────────────────────────────────────────────

  describe('leaveRoom', () => {
    it('removes player from room', async () => {
      const host = makeUser(1, 'alice');
      const other = makeUser(2, 'bob');
      const config = makeConfig();
      await createRoom(host as any, 'Room', config as any);
      await joinRoom('ABCDEF', other as any);

      const room = await leaveRoom('ABCDEF', 2);

      expect(room).not.toBeNull();
      expect(room!.players).toHaveLength(1);
      expect(room!.players[0].user.id).toBe(1);
    });

    it('deletes room when last player leaves and returns null', async () => {
      const host = makeUser(1, 'alice');
      const config = makeConfig();
      await createRoom(host as any, 'Room', config as any);

      const result = await leaveRoom('ABCDEF', 1);

      expect(result).toBeNull();
      expect(mockRedis.del).toHaveBeenCalledWith('room:ABCDEF');
    });

    it('transfers host when host leaves', async () => {
      const host = makeUser(1, 'alice');
      const other = makeUser(2, 'bob');
      const config = makeConfig();
      await createRoom(host as any, 'Room', config as any);
      await joinRoom('ABCDEF', other as any);

      const room = await leaveRoom('ABCDEF', 1);

      expect(room).not.toBeNull();
      expect(room!.host.id).toBe(2);
      expect(room!.host.username).toBe('bob');
    });
  });

  // ── setPlayerReady ─────────────────────────────────────────────────

  describe('setPlayerReady', () => {
    it('toggles ready flag on player', async () => {
      const host = makeUser(1, 'alice');
      const config = makeConfig();
      await createRoom(host as any, 'Room', config as any);

      const room = await setPlayerReady('ABCDEF', 1, true);

      expect(room.players[0].ready).toBe(true);

      const room2 = await setPlayerReady('ABCDEF', 1, false);

      expect(room2.players[0].ready).toBe(false);
    });
  });

  // ── setPlayerTeam ──────────────────────────────────────────────────

  describe('setPlayerTeam', () => {
    it('sets team on player', async () => {
      const host = makeUser(1, 'alice');
      const config = makeConfig();
      await createRoom(host as any, 'Room', config as any);

      const room = await setPlayerTeam('ABCDEF', 1, 0);

      expect(room.players[0].team).toBe(0);

      const room2 = await setPlayerTeam('ABCDEF', 1, 1);

      expect(room2.players[0].team).toBe(1);
    });
  });
});

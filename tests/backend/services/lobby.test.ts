import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const store = new Map<string, string>();
// Real set semantics, so the room-index paths are genuinely exercised rather than stubbed.
// (audit LOBBY-SCAN-1)
const sets = new Map<string, Set<string>>();
const setFor = (key: string): Set<string> => {
  let s = sets.get(key);
  if (!s) sets.set(key, (s = new Set<string>()));
  return s;
};
const mockRedis = {
  sadd: jest.fn<AnyFn>((key: string, ...members: string[]) => {
    const s = setFor(key);
    let added = 0;
    for (const m of members)
      if (!s.has(m)) {
        s.add(m);
        added++;
      }
    return Promise.resolve(added);
  }),
  srem: jest.fn<AnyFn>((key: string, ...members: string[]) => {
    const s = setFor(key);
    let removed = 0;
    for (const m of members) if (s.delete(m)) removed++;
    return Promise.resolve(removed);
  }),
  smembers: jest.fn<AnyFn>((key: string) => Promise.resolve([...setFor(key)])),
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
  deleteRoom,
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
    sets.clear();
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
    // eval mock: simulate Lua scripts using the in-memory store
    // Dispatches by numKeys and arg patterns to handle join, leave, ready, team, and start scripts
    mockRedis.eval.mockImplementation((script: string, numKeys: number, ...args: string[]) => {
      const roomKey = args[0];
      const data = store.get(roomKey);

      // JOIN: 2 keys (room + player:room), 2 args (userJson, userIdStr)
      if (numKeys === 2 && script.includes('ALREADY_IN_ROOM')) {
        const playerRoomKey = args[1];
        const userJson = args[2];
        const userIdStr = args[3];
        if (!data) return Promise.resolve('ERR:NOT_FOUND');
        const room = JSON.parse(data);
        if (room.status !== 'waiting') return Promise.resolve('ERR:GAME_IN_PROGRESS');
        if (room.players.length >= room.config.maxPlayers) return Promise.resolve('ERR:ROOM_FULL');
        const userId = parseInt(userIdStr);
        if (room.players.some((p: any) => p.user.id === userId))
          return Promise.resolve('ERR:ALREADY_IN_ROOM');
        const user = JSON.parse(userJson);
        room.players.push({ user, ready: false, team: null });
        const updated = JSON.stringify(room);
        store.set(roomKey, updated);
        store.set(playerRoomKey, room.code);
        return Promise.resolve(updated);
      }

      // LEAVE: 3 keys (room + player:room + rooms:index), 1 arg (userId).
      // The index key was added so the SREM happens atomically with the DEL. (audit LOBBY-SCAN-1)
      if (numKeys === 3 && script.includes('DELETED')) {
        const playerRoomKey = args[1];
        const indexKey = args[2];
        const userIdStr = args[3];
        if (!data) return Promise.resolve('ERR:NOT_FOUND');
        store.delete(playerRoomKey);
        const room = JSON.parse(data);
        const userId = parseInt(userIdStr);
        room.players = room.players.filter((p: any) => p.user.id !== userId);
        if (room.players.length === 0) {
          store.delete(roomKey);
          setFor(indexKey).delete(room.code);
          return Promise.resolve('DELETED');
        }
        if (room.host.id === userId) {
          room.host = room.players[0].user;
        }
        const updated = JSON.stringify(room);
        store.set(roomKey, updated);
        return Promise.resolve(updated);
      }

      // SET_READY: 1 key, 2 args (userId, ready)
      if (numKeys === 1 && script.includes('ready')) {
        const userIdStr = args[1];
        const readyStr = args[2];
        if (!data) return Promise.resolve('ERR:NOT_FOUND');
        const room = JSON.parse(data);
        const userId = parseInt(userIdStr);
        const player = room.players.find((p: any) => p.user.id === userId);
        if (!player) return Promise.resolve('ERR:NOT_IN_ROOM');
        player.ready = readyStr === 'true';
        const updated = JSON.stringify(room);
        store.set(roomKey, updated);
        return Promise.resolve(updated);
      }

      // SET_TEAM: 1 key, 2 args (userId, team)
      if (numKeys === 1 && script.includes('team')) {
        const userIdStr = args[1];
        const teamStr = args[2];
        if (!data) return Promise.resolve('ERR:NOT_FOUND');
        const room = JSON.parse(data);
        const userId = parseInt(userIdStr);
        const player = room.players.find((p: any) => p.user.id === userId);
        if (!player) return Promise.resolve('ERR:NOT_IN_ROOM');
        player.team = teamStr === 'null' ? null : parseInt(teamStr);
        const updated = JSON.stringify(room);
        store.set(roomKey, updated);
        return Promise.resolve(updated);
      }

      // START_ROOM: 1 key, 1 arg (status)
      if (numKeys === 1 && script.includes('ALREADY_STARTING')) {
        const newStatus = args[1];
        if (!data) return Promise.resolve('ERR:NOT_FOUND');
        const room = JSON.parse(data);
        if (room.status !== 'waiting') return Promise.resolve('ERR:ALREADY_STARTING');
        room.status = newStatus;
        const updated = JSON.stringify(room);
        store.set(roomKey, updated);
        return Promise.resolve(updated);
      }

      return Promise.resolve(undefined);
    });
  });

  // ── createRoom ─────────────────────────────────────────────────────

  describe('createRoom', () => {
    it('stores room in Redis with TTL', async () => {
      const host = makeUser(1, 'alice');
      const config = makeConfig();

      await createRoom(host as any, 'Test Room', config as any);

      expect(mockRedis.set).toHaveBeenCalledWith('room:ABCDEF', expect.any(String), 'EX', 3600);
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

  // listRooms used to find rooms with `SCAN MATCH room:*` over the whole keyspace — shared with
  // player:*, invite:*, presence:* and every rate-limit key — on every lobby mutation. It now
  // reads a set of room codes, which it also has to heal, because room keys expire on a TTL and
  // nothing reaps them. (audit LOBBY-SCAN-1)
  describe('room index', () => {
    it('never scans the keyspace', async () => {
      await createRoom(makeUser(1, 'alice') as any, 'R', makeConfig() as any);
      mockRedis.scan.mockClear();

      await listRooms();

      expect(mockRedis.scan).not.toHaveBeenCalled();
      expect(mockRedis.smembers).toHaveBeenCalledWith('rooms:index');
    });

    it('indexes a room on creation', async () => {
      const room = await createRoom(makeUser(1, 'alice') as any, 'R', makeConfig() as any);
      expect([...setFor('rooms:index')]).toEqual([room.code]);
    });

    it('de-indexes a room on delete', async () => {
      const room = await createRoom(makeUser(1, 'alice') as any, 'R', makeConfig() as any);
      await deleteRoom(room.code);
      expect([...setFor('rooms:index')]).toEqual([]);
    });

    it('de-indexes a room when the last player leaves', async () => {
      const room = await createRoom(makeUser(1, 'alice') as any, 'R', makeConfig() as any);
      await leaveRoom(room.code, 1);
      expect([...setFor('rooms:index')]).toEqual([]);
    });

    it('heals itself when an indexed room key has expired', async () => {
      const room = await createRoom(makeUser(1, 'alice') as any, 'R', makeConfig() as any);
      // Simulate the TTL lapsing: the key is gone but the index still names it.
      store.delete(`room:${room.code}`);
      expect([...setFor('rooms:index')]).toEqual([room.code]);

      const rooms = await listRooms();

      expect(rooms).toEqual([]);
      expect([...setFor('rooms:index')]).toEqual([]); // tombstone removed
    });

    it('keeps live rooms while dropping expired ones', async () => {
      // uuid.v4 is mocked to a constant, so every createRoom yields the same code — the second
      // room is seeded by hand to get a distinct one.
      const alive = await createRoom(makeUser(1, 'alice') as any, 'Alive', makeConfig() as any);
      setFor('rooms:index').add('DEAD01'); // indexed, but its room key never existed / expired

      const rooms = await listRooms();

      expect(rooms.map((r) => r.name)).toEqual(['Alive']);
      expect([...setFor('rooms:index')]).toEqual([alive.code]);
    });

    it('returns nothing, and queries nothing, for an empty index', async () => {
      mockRedis.mget.mockClear();

      expect(await listRooms()).toEqual([]);
      expect(mockRedis.mget).not.toHaveBeenCalled();
    });
  });

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
      // listRooms reads the room index, not the keyspace — a hand-seeded room has to be indexed
      // the way createRoom would. (audit LOBBY-SCAN-1)
      setFor('rooms:index').add('PLAY01');

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
      // Room key cleaned up by atomic Lua script
      expect(store.has('room:ABCDEF')).toBe(false);
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

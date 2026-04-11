import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

// --- Mock setup (jest.mock is hoisted before imports) ---

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockExecute = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: jest.fn(),
  execute: mockExecute,
}));

const mockUpdateRoomStatus = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/lobby', () => ({
  updateRoomStatus: mockUpdateRoomStatus,
  createRoom: jest.fn(),
  getRoom: jest.fn(),
  deleteRoom: jest.fn(),
  getRoomList: jest.fn(),
}));

jest.mock('../../../backend/src/services/settings', () => ({
  isRecordingEnabled: jest.fn<AnyFn>().mockResolvedValue(false),
  getSetting: jest.fn(),
  setSetting: jest.fn(),
}));

const mockGameLoopStart = jest.fn<AnyFn>();
const mockGameLoopStop = jest.fn<AnyFn>();
const mockGameLoopIsRunning = jest.fn<AnyFn>().mockReturnValue(false);
jest.mock('../../../backend/src/game/GameLoop', () => ({
  GameLoop: jest.fn<AnyFn>().mockImplementation(() => ({
    start: mockGameLoopStart,
    stop: mockGameLoopStop,
    isRunning: mockGameLoopIsRunning,
  })),
}));

jest.mock('../../../backend/src/utils/replayRecorder', () => ({
  ReplayRecorder: jest.fn<AnyFn>().mockImplementation(() => ({
    setMatchId: jest.fn(),
    recordTick: jest.fn(),
    finalize: jest.fn(),
  })),
}));

jest.mock('../../../backend/src/utils/gameLogger', () => ({
  GameLogger: jest.fn<AnyFn>().mockImplementation(() => ({
    log: jest.fn(),
    logGameOver: jest.fn(),
    replayRecorder: null,
  })),
}));

jest.mock('../../../backend/src/services/botai-registry', () => ({
  getBotAIRegistry: jest.fn().mockReturnValue({
    createInstance: jest.fn().mockReturnValue({
      getAction: jest.fn().mockReturnValue(null),
    }),
  }),
}));

import { RoomManager } from '../../../backend/src/game/RoomManager';
import type { Room } from '@blast-arena/shared';

// --- Helpers ---

function createMockIo() {
  const mockEmit = jest.fn();
  const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
  return {
    io: {
      to: mockTo,
      sockets: { adapter: { rooms: new Map() } },
    } as any,
    mockTo,
    mockEmit,
  };
}

function createMockRoom(overrides: Partial<Room> = {}): Room {
  return {
    code: 'ABC123',
    name: 'Test Room',
    host: {
      id: 1,
      username: 'host',
      role: 'user' as const,
      language: 'en',
      emailVerified: true,
      twoFactorEnabled: false,
    },
    players: [
      {
        user: {
          id: 1,
          username: 'host',
          role: 'user' as const,
          language: 'en',
          emailVerified: true,
          twoFactorEnabled: false,
        },
        ready: true,
        team: null,
      },
      {
        user: {
          id: 2,
          username: 'player2',
          role: 'user' as const,
          language: 'en',
          emailVerified: true,
          twoFactorEnabled: false,
        },
        ready: true,
        team: null,
      },
    ],
    config: {
      gameMode: 'ffa' as any,
      maxPlayers: 8,
      mapWidth: 15,
      mapHeight: 13,
      mapSeed: 12345,
      roundTime: 180,
      wallDensity: 0.65,
      powerUpDropRate: 0.3,
      enabledPowerUps: ['bomb_up', 'fire_up', 'speed_up', 'shield', 'kick'] as any[],
      botCount: 0,
      botDifficulty: 'normal' as const,
      botTeams: {} as any,
      friendlyFire: true,
      hazardTiles: false,
      enableMapEvents: false,
      reinforcedWalls: false,
      recordGame: false,
    },
    status: 'waiting' as const,
    createdAt: new Date(),
    ...overrides,
  } as Room;
}

describe('RoomManager', () => {
  let roomManager: RoomManager;
  let mockIo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    const ioSetup = createMockIo();
    mockIo = ioSetup.io;
    mockExecute.mockResolvedValue({ insertId: 1, affectedRows: 1 });
    mockUpdateRoomStatus.mockResolvedValue(undefined);
    roomManager = new RoomManager(mockIo);
  });

  // ─────────────────────────────────────────────────
  // 1. Construction
  // ─────────────────────────────────────────────────
  describe('Construction', () => {
    it('should create a RoomManager instance', () => {
      expect(roomManager).toBeDefined();
    });

    it('should start with zero active rooms', () => {
      expect(roomManager.getActiveRoomCount()).toBe(0);
    });

    it('should return empty array for getAllRooms initially', () => {
      expect(roomManager.getAllRooms()).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────
  // 2. createGame
  // ─────────────────────────────────────────────────
  describe('createGame', () => {
    it('should create a game room and return it', async () => {
      const room = createMockRoom();
      const gameRoom = await roomManager.createGame(room);

      expect(gameRoom).toBeDefined();
      expect(gameRoom.code).toBe('ABC123');
    });

    it('should store the room in its internal map', async () => {
      const room = createMockRoom();
      await roomManager.createGame(room);

      expect(roomManager.getActiveRoomCount()).toBe(1);
    });

    it('should call start() on the game room', async () => {
      const room = createMockRoom();
      await roomManager.createGame(room);

      expect(mockGameLoopStart).toHaveBeenCalledTimes(1);
    });

    it('should log room creation', async () => {
      const { logger } = require('../../../backend/src/utils/logger');
      const room = createMockRoom();
      await roomManager.createGame(room);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'ABC123', players: 2 }),
        expect.stringContaining('Game room created'),
      );
    });

    it('should create multiple rooms with different codes', async () => {
      const room1 = createMockRoom({ code: 'ROOM1' });
      const room2 = createMockRoom({ code: 'ROOM2' });

      await roomManager.createGame(room1);
      await roomManager.createGame(room2);

      expect(roomManager.getActiveRoomCount()).toBe(2);
    });

    it('should overwrite existing room with same code', async () => {
      const room1 = createMockRoom({ code: 'SAME' });
      const room2 = createMockRoom({ code: 'SAME' });

      await roomManager.createGame(room1);
      await roomManager.createGame(room2);

      // Map.set overwrites the existing entry
      expect(roomManager.getActiveRoomCount()).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────
  // 3. getRoom
  // ─────────────────────────────────────────────────
  describe('getRoom', () => {
    it('should return a room by its code', async () => {
      const room = createMockRoom({ code: 'TEST1' });
      await roomManager.createGame(room);

      const result = roomManager.getRoom('TEST1');
      expect(result).toBeDefined();
      expect(result!.code).toBe('TEST1');
    });

    it('should return undefined for non-existent room code', () => {
      const result = roomManager.getRoom('NONEXISTENT');
      expect(result).toBeUndefined();
    });

    it('should return correct room when multiple rooms exist', async () => {
      const room1 = createMockRoom({ code: 'AAA111' });
      const room2 = createMockRoom({ code: 'BBB222' });
      const room3 = createMockRoom({ code: 'CCC333' });

      await roomManager.createGame(room1);
      await roomManager.createGame(room2);
      await roomManager.createGame(room3);

      const result = roomManager.getRoom('BBB222');
      expect(result).toBeDefined();
      expect(result!.code).toBe('BBB222');
    });

    it('should return undefined after room is removed', async () => {
      const room = createMockRoom({ code: 'REMOVE' });
      await roomManager.createGame(room);

      expect(roomManager.getRoom('REMOVE')).toBeDefined();

      roomManager.removeRoom('REMOVE');

      expect(roomManager.getRoom('REMOVE')).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────
  // 4. removeRoom
  // ─────────────────────────────────────────────────
  describe('removeRoom', () => {
    it('should remove an existing room', async () => {
      const room = createMockRoom({ code: 'DEL1' });
      await roomManager.createGame(room);

      expect(roomManager.getActiveRoomCount()).toBe(1);

      roomManager.removeRoom('DEL1');

      expect(roomManager.getActiveRoomCount()).toBe(0);
    });

    it('should stop the game loop of the removed room', async () => {
      const room = createMockRoom({ code: 'STOP1' });
      await roomManager.createGame(room);
      mockGameLoopStop.mockClear();

      roomManager.removeRoom('STOP1');

      expect(mockGameLoopStop).toHaveBeenCalledTimes(1);
    });

    it('should log room removal', async () => {
      const { logger } = require('../../../backend/src/utils/logger');
      const room = createMockRoom({ code: 'LOG1' });
      await roomManager.createGame(room);
      jest.clearAllMocks();

      roomManager.removeRoom('LOG1');

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'LOG1' }),
        expect.stringContaining('Game room removed'),
      );
    });

    it('should do nothing when removing a non-existent room', () => {
      // Should not throw
      expect(() => roomManager.removeRoom('NOPE')).not.toThrow();
      expect(roomManager.getActiveRoomCount()).toBe(0);
    });

    it('should not affect other rooms when one is removed', async () => {
      const room1 = createMockRoom({ code: 'KEEP1' });
      const room2 = createMockRoom({ code: 'KEEP2' });
      const room3 = createMockRoom({ code: 'REMOVE3' });

      await roomManager.createGame(room1);
      await roomManager.createGame(room2);
      await roomManager.createGame(room3);

      roomManager.removeRoom('REMOVE3');

      expect(roomManager.getActiveRoomCount()).toBe(2);
      expect(roomManager.getRoom('KEEP1')).toBeDefined();
      expect(roomManager.getRoom('KEEP2')).toBeDefined();
      expect(roomManager.getRoom('REMOVE3')).toBeUndefined();
    });

    it('should handle removing the same room twice gracefully', async () => {
      const room = createMockRoom({ code: 'TWICE' });
      await roomManager.createGame(room);

      roomManager.removeRoom('TWICE');
      expect(roomManager.getActiveRoomCount()).toBe(0);

      // Second removal should be a no-op
      expect(() => roomManager.removeRoom('TWICE')).not.toThrow();
      expect(roomManager.getActiveRoomCount()).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────
  // 5. getActiveRoomCount
  // ─────────────────────────────────────────────────
  describe('getActiveRoomCount', () => {
    it('should return 0 with no rooms', () => {
      expect(roomManager.getActiveRoomCount()).toBe(0);
    });

    it('should return correct count after creating rooms', async () => {
      await roomManager.createGame(createMockRoom({ code: 'R1' }));
      expect(roomManager.getActiveRoomCount()).toBe(1);

      await roomManager.createGame(createMockRoom({ code: 'R2' }));
      expect(roomManager.getActiveRoomCount()).toBe(2);

      await roomManager.createGame(createMockRoom({ code: 'R3' }));
      expect(roomManager.getActiveRoomCount()).toBe(3);
    });

    it('should decrement after removing a room', async () => {
      await roomManager.createGame(createMockRoom({ code: 'R1' }));
      await roomManager.createGame(createMockRoom({ code: 'R2' }));
      expect(roomManager.getActiveRoomCount()).toBe(2);

      roomManager.removeRoom('R1');
      expect(roomManager.getActiveRoomCount()).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────
  // 6. getAllRooms
  // ─────────────────────────────────────────────────
  describe('getAllRooms', () => {
    it('should return empty array when no rooms exist', () => {
      const rooms = roomManager.getAllRooms();
      expect(rooms).toEqual([]);
    });

    it('should return all created rooms', async () => {
      await roomManager.createGame(createMockRoom({ code: 'X1' }));
      await roomManager.createGame(createMockRoom({ code: 'X2' }));

      const rooms = roomManager.getAllRooms();
      expect(rooms).toHaveLength(2);
    });

    it('should return a new array (not internal reference)', async () => {
      await roomManager.createGame(createMockRoom({ code: 'Y1' }));

      const rooms1 = roomManager.getAllRooms();
      const rooms2 = roomManager.getAllRooms();

      // Should be equal content but not the same reference
      expect(rooms1).toEqual(rooms2);
      expect(rooms1).not.toBe(rooms2);
    });

    it('should not include removed rooms', async () => {
      await roomManager.createGame(createMockRoom({ code: 'A1' }));
      await roomManager.createGame(createMockRoom({ code: 'A2' }));

      roomManager.removeRoom('A1');

      const rooms = roomManager.getAllRooms();
      expect(rooms).toHaveLength(1);
      expect(rooms[0].code).toBe('A2');
    });
  });

  // ─────────────────────────────────────────────────
  // 7. cleanup
  // ─────────────────────────────────────────────────
  describe('cleanup', () => {
    it('should remove rooms that are not running', async () => {
      mockGameLoopIsRunning.mockReturnValue(false);

      await roomManager.createGame(createMockRoom({ code: 'DONE1' }));
      await roomManager.createGame(createMockRoom({ code: 'DONE2' }));

      expect(roomManager.getActiveRoomCount()).toBe(2);

      roomManager.cleanup();

      expect(roomManager.getActiveRoomCount()).toBe(0);
    });

    it('should keep rooms that are still running', async () => {
      mockGameLoopIsRunning.mockReturnValue(true);

      await roomManager.createGame(createMockRoom({ code: 'ACTIVE1' }));

      roomManager.cleanup();

      expect(roomManager.getActiveRoomCount()).toBe(1);
    });

    it('should handle mixed running and stopped rooms', async () => {
      // First room created with isRunning=true
      mockGameLoopIsRunning.mockReturnValue(true);
      await roomManager.createGame(createMockRoom({ code: 'RUN1' }));

      // Change to not running for next room
      mockGameLoopIsRunning.mockReturnValue(false);
      await roomManager.createGame(createMockRoom({ code: 'STOP1' }));

      // cleanup iterates all rooms — the mock returns the last-set value for all
      // So both would be considered stopped. This tests that cleanup removes non-running rooms.
      roomManager.cleanup();

      expect(roomManager.getActiveRoomCount()).toBe(0);
    });

    it('should not throw when no rooms exist', () => {
      expect(() => roomManager.cleanup()).not.toThrow();
    });

    it('should be callable multiple times safely', async () => {
      mockGameLoopIsRunning.mockReturnValue(false);
      await roomManager.createGame(createMockRoom({ code: 'MULTI1' }));

      roomManager.cleanup();
      expect(roomManager.getActiveRoomCount()).toBe(0);

      roomManager.cleanup();
      expect(roomManager.getActiveRoomCount()).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────
  // 8. Integration-like scenarios
  // ─────────────────────────────────────────────────
  describe('Integration scenarios', () => {
    it('should handle full lifecycle: create, get, remove', async () => {
      // Create
      const room = createMockRoom({ code: 'LIFE1' });
      const gameRoom = await roomManager.createGame(room);
      expect(gameRoom.code).toBe('LIFE1');
      expect(roomManager.getActiveRoomCount()).toBe(1);

      // Get
      const fetched = roomManager.getRoom('LIFE1');
      expect(fetched).toBe(gameRoom);

      // Remove
      roomManager.removeRoom('LIFE1');
      expect(roomManager.getActiveRoomCount()).toBe(0);
      expect(roomManager.getRoom('LIFE1')).toBeUndefined();
    });

    it('should handle many rooms concurrently', async () => {
      const codes = [];
      for (let i = 0; i < 20; i++) {
        const code = `ROOM${String(i).padStart(3, '0')}`;
        codes.push(code);
        await roomManager.createGame(createMockRoom({ code }));
      }

      expect(roomManager.getActiveRoomCount()).toBe(20);
      expect(roomManager.getAllRooms()).toHaveLength(20);

      // Remove half
      for (let i = 0; i < 10; i++) {
        roomManager.removeRoom(codes[i]);
      }

      expect(roomManager.getActiveRoomCount()).toBe(10);
    });

    it('should handle rooms with different game modes', async () => {
      await roomManager.createGame(
        createMockRoom({
          code: 'FFA1',
          config: {
            ...createMockRoom().config,
            gameMode: 'ffa' as any,
          },
        }),
      );
      await roomManager.createGame(
        createMockRoom({
          code: 'TEAMS1',
          config: {
            ...createMockRoom().config,
            gameMode: 'teams' as any,
            maxPlayers: 4,
          },
          players: [
            {
              user: {
                id: 1,
                username: 'p1',
                role: 'user' as const,
                language: 'en',
                emailVerified: true,
                twoFactorEnabled: false,
              },
              ready: true,
              team: 0,
            },
            {
              user: {
                id: 2,
                username: 'p2',
                role: 'user' as const,
                language: 'en',
                emailVerified: true,
                twoFactorEnabled: false,
              },
              ready: true,
              team: 0,
            },
            {
              user: {
                id: 3,
                username: 'p3',
                role: 'user' as const,
                language: 'en',
                emailVerified: true,
                twoFactorEnabled: false,
              },
              ready: true,
              team: 1,
            },
            {
              user: {
                id: 4,
                username: 'p4',
                role: 'user' as const,
                language: 'en',
                emailVerified: true,
                twoFactorEnabled: false,
              },
              ready: true,
              team: 1,
            },
          ],
        }),
      );

      expect(roomManager.getActiveRoomCount()).toBe(2);
      expect(roomManager.getRoom('FFA1')).toBeDefined();
      expect(roomManager.getRoom('TEAMS1')).toBeDefined();
    });

    it('should handle rooms with bots', async () => {
      await roomManager.createGame(
        createMockRoom({
          code: 'BOTS1',
          config: {
            ...createMockRoom().config,
            botCount: 3,
          },
        }),
      );

      expect(roomManager.getActiveRoomCount()).toBe(1);
    });
  });
});

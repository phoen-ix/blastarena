import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

// --- Mock setup (jest.mock is hoisted before imports) ---

const mockExecute = jest.fn<AnyFn>();
/** Statements issued on the transaction connection, in order. */
const mockConnExecute = jest.fn<AnyFn>();
const mockWithTransaction = jest.fn<AnyFn>(async (fn: AnyFn) => fn({ execute: mockConnExecute }));
jest.mock('../../../backend/src/db/connection', () => ({
  query: jest.fn(),
  execute: mockExecute,
  withTransaction: mockWithTransaction,
}));

const mockProcessMatchElo = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/elo', () => ({
  processMatchElo: mockProcessMatchElo,
}));
const mockEvaluateAfterGame = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/achievements', () => ({
  evaluateAfterGame: mockEvaluateAfterGame,
}));
const mockCheckLevelMilestoneUnlocks = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/cosmetics', () => ({
  getPlayerCosmeticsForGame: jest.fn<AnyFn>().mockResolvedValue(new Map()),
  checkLevelMilestoneUnlocks: mockCheckLevelMilestoneUnlocks,
}));
jest.mock('../../../backend/src/services/challenges', () => ({
  getActiveChallenge: jest.fn<AnyFn>().mockResolvedValue(null),
  recordChallengeResult: jest.fn(),
}));

const mockUpdateRoomStatus = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/lobby', () => ({
  updateRoomStatus: mockUpdateRoomStatus,
  createRoom: jest.fn(),
  getRoom: jest.fn(),
  deleteRoom: jest.fn(),
  getRoomList: jest.fn(),
}));

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../../backend/src/services/settings', () => ({
  isRecordingEnabled: jest.fn<AnyFn>().mockResolvedValue(false),
  getSetting: jest.fn(),
  setSetting: jest.fn(),
}));

const mockGameLoopStart = jest.fn();
const mockGameLoopStop = jest.fn();
const mockGameLoopIsRunning = jest.fn().mockReturnValue(false);
// getTickRate/setTickRate are used by checkBotOnlySpeedup, which every leave/disconnect path
// reaches. Default to the normal rate so the speed-up branch behaves as it does in a live room.
// Lazy: jest.mock is hoisted above the imports, so TICK_RATE is not initialised yet at
// module-eval time — only when the mock is actually called.
const mockGameLoopGetTickRate = jest.fn(() => TICK_RATE);
const mockGameLoopSetTickRate = jest.fn();
jest.mock('../../../backend/src/game/GameLoop', () => ({
  GameLoop: jest.fn().mockImplementation(() => ({
    start: mockGameLoopStart,
    stop: mockGameLoopStop,
    isRunning: mockGameLoopIsRunning,
    getTickRate: mockGameLoopGetTickRate,
    setTickRate: mockGameLoopSetTickRate,
  })),
}));

jest.mock('../../../backend/src/utils/replayRecorder', () => ({
  ReplayRecorder: jest.fn().mockImplementation(() => ({
    setMatchId: jest.fn(),
    recordTick: jest.fn(),
    finalize: jest.fn(),
  })),
}));

// A permissive stand-in: GameLogger has ~20 log* methods and the code under test calls whichever
// suits its path (logKill, logPlayerDisconnectKill, close, …). Enumerating them by hand just means
// the next test to exercise a new path fails on a missing mock rather than on its own assertion.
jest.mock('../../../backend/src/utils/gameLogger', () => ({
  GameLogger: jest.fn().mockImplementation(() => {
    const stubs = new Map<string, unknown>();
    return new Proxy({ replayRecorder: null } as Record<string, unknown>, {
      get(target: Record<string, unknown>, prop: string) {
        if (prop in target) return target[prop];
        if (prop === 'then') return undefined; // never look thenable to an await
        if (!stubs.has(prop)) stubs.set(prop, jest.fn());
        return stubs.get(prop);
      },
      set(target: Record<string, unknown>, prop: string, value: unknown) {
        target[prop] = value;
        return true;
      },
    });
  }),
}));

import { GameRoom } from '../../../backend/src/game/GameRoom';
import { GameStateManager } from '../../../backend/src/game/GameState';
import { TICK_RATE } from '@blast-arena/shared';

// --- Helpers ---

function createMockRoom(configOverrides: Record<string, unknown> = {}) {
  return {
    code: 'ABC123',
    name: 'Test Room',
    host: { id: 1, username: 'host', role: 'user' as const },
    players: [
      {
        user: { id: 1, username: 'host', role: 'user' as const },
        ready: true,
        team: null,
      },
      {
        user: { id: 2, username: 'player2', role: 'user' as const },
        ready: true,
        team: null,
      },
    ],
    config: {
      gameMode: 'ffa' as const,
      maxPlayers: 8,
      mapWidth: 15,
      mapHeight: 13,
      mapSeed: 12345,
      roundTime: 180,
      wallDensity: 0.65,
      powerUpDropRate: 0.3,
      enabledPowerUps: ['bomb_up', 'fire_up', 'speed_up', 'shield', 'kick'] as string[],
      botCount: 0,
      botDifficulty: 'normal' as const,
      botTeams: {} as Record<string, unknown>,
      friendlyFire: true,
      hazardTiles: false,
      enableMapEvents: false,
      reinforcedWalls: false,
      recordGame: false,
      ...configOverrides,
    },
    status: 'waiting' as const,
    createdAt: new Date(),
  };
}

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

describe('GameRoom', () => {
  let mockIo: any;
  let mockTo: jest.Mock;
  let mockEmit: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    const ioSetup = createMockIo();
    mockIo = ioSetup.io;
    mockTo = ioSetup.mockTo;
    mockEmit = ioSetup.mockEmit;
    mockExecute.mockResolvedValue({ insertId: 1, affectedRows: 1 });
    mockUpdateRoomStatus.mockResolvedValue(undefined);
    mockConnExecute.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT')
        ? [
            [
              { user_id: 1, total_xp: 90, level: 1 },
              { user_id: 2, total_xp: 0, level: 1 },
            ],
          ]
        : [{ affectedRows: 1 }],
    );
    mockProcessMatchElo.mockResolvedValue([]);
    mockEvaluateAfterGame.mockResolvedValue({ achievements: [], cosmetics: [] });
    mockCheckLevelMilestoneUnlocks.mockResolvedValue([]);
  });

  describe('constructor', () => {
    it('should create instance without error', () => {
      const room = createMockRoom();
      const gameRoom = new GameRoom(mockIo, room as any);

      expect(gameRoom).toBeDefined();
    });

    it('should expose room code via code property', () => {
      const room = createMockRoom();
      const gameRoom = new GameRoom(mockIo, room as any);

      expect(gameRoom.code).toBe('ABC123');
    });
  });

  describe('handleInput', () => {
    it('should accept player input without throwing', () => {
      const room = createMockRoom();
      const gameRoom = new GameRoom(mockIo, room as any);

      expect(() => {
        gameRoom.handleInput(1, { seq: 1, direction: 'right', action: null, tick: 0 });
      }).not.toThrow();
    });
  });

  describe('handlePlayerDisconnect', () => {
    it('should record disconnect without throwing', () => {
      const room = createMockRoom();
      const gameRoom = new GameRoom(mockIo, room as any);

      expect(() => {
        gameRoom.handlePlayerDisconnect(1);
      }).not.toThrow();
    });
  });

  describe('handlePlayerReconnect', () => {
    it('should return false when player was not disconnected', () => {
      const room = createMockRoom();
      const gameRoom = new GameRoom(mockIo, room as any);

      const result = gameRoom.handlePlayerReconnect(1);

      expect(result).toBe(false);
    });

    it('should return false for unknown player ID', () => {
      const room = createMockRoom();
      const gameRoom = new GameRoom(mockIo, room as any);

      const result = gameRoom.handlePlayerReconnect(999);

      expect(result).toBe(false);
    });
  });

  describe('start', () => {
    it('should call execute to create match record', async () => {
      const room = createMockRoom();
      const gameRoom = new GameRoom(mockIo, room as any);

      await gameRoom.start();

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO matches'),
        expect.arrayContaining(['ABC123', 'ffa']),
      );
    });

    it('should insert match_players for human players', async () => {
      const room = createMockRoom();
      const gameRoom = new GameRoom(mockIo, room as any);

      await gameRoom.start();

      // One multi-row INSERT for both humans. (audit GAME-END-BATCH-1)
      const matchPlayerCalls = mockExecute.mock.calls.filter(
        (call) => typeof call[0] === 'string' && (call[0] as string).includes('match_players'),
      );
      expect(matchPlayerCalls.length).toBe(1);
      expect((matchPlayerCalls[0][0] as string).match(/\(\?, \?, \?\)/g)).toHaveLength(2);
      const params = matchPlayerCalls[0][1] as unknown[];
      expect(params).toHaveLength(6);
      expect(params.filter((v) => v === 1 || v === 2)).toEqual(expect.arrayContaining([1, 2]));
    });

    it('should emit game:start event via io.to()', async () => {
      const room = createMockRoom();
      const gameRoom = new GameRoom(mockIo, room as any);

      await gameRoom.start();

      expect(mockTo).toHaveBeenCalledWith('room:ABC123');
      expect(mockEmit).toHaveBeenCalledWith('game:start', expect.any(Object));
    });

    it('should start the game loop', async () => {
      const room = createMockRoom();
      const gameRoom = new GameRoom(mockIo, room as any);

      await gameRoom.start();

      expect(mockGameLoopStart).toHaveBeenCalled();
    });

    it('should update room status to playing', async () => {
      const room = createMockRoom();
      const gameRoom = new GameRoom(mockIo, room as any);

      await gameRoom.start();

      expect(mockUpdateRoomStatus).toHaveBeenCalledWith('ABC123', 'playing');
    });
  });

  describe('bots', () => {
    it('should assign negative IDs to bot players', () => {
      const room = createMockRoom({ botCount: 2 });
      const gameRoom = new GameRoom(mockIo, room as any);

      const state = gameRoom.getFullState();
      const botPlayers = state.players.filter((p) => p.id < 0);

      expect(botPlayers.length).toBe(2);
      expect(botPlayers[0].id).toBe(-1);
      expect(botPlayers[1].id).toBe(-2);
    });

    it('should add bots as players with bot names', () => {
      const room = createMockRoom({ botCount: 1 });
      const gameRoom = new GameRoom(mockIo, room as any);

      const state = gameRoom.getFullState();
      const botPlayers = state.players.filter((p) => p.id < 0);

      expect(botPlayers.length).toBe(1);
      expect(botPlayers[0].username).toBe('Bomber Bot');
      expect(botPlayers[0].isBot).toBe(true);
    });

    it('should not insert match_players for bots during start', async () => {
      const room = createMockRoom({ botCount: 2 });
      const gameRoom = new GameRoom(mockIo, room as any);

      await gameRoom.start();

      const matchPlayerCalls = mockExecute.mock.calls.filter(
        (call) => typeof call[0] === 'string' && (call[0] as string).includes('match_players'),
      );
      // One statement with 2 value tuples (humans only), not 4 (2 humans + 2 bots)
      expect(matchPlayerCalls.length).toBe(1);
      expect((matchPlayerCalls[0][0] as string).match(/\(\?, \?, \?\)/g)).toHaveLength(2);
      const botIds = (matchPlayerCalls[0][1] as unknown[]).filter(
        (v) => typeof v === 'number' && v < 0,
      );
      expect(botIds).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────
  // Abandoned matches
  // ─────────────────────────────────────────────────
  // A match everyone walked out of should not touch anyone's rating, XP or achievements. The
  // previous incarnation of this compared finishReason against a literal assigned nowhere, so the
  // status could never be 'aborted' and every guard around it was unreachable. The trigger is now
  // real departure bookkeeping. (audit MATCH-ABORTED-1)
  describe('isAbandoned', () => {
    interface Abandonable {
      isAbandoned(): boolean;
      departedHumans: Set<number>;
      handlePlayerLeave(id: number): void;
      handlePlayerReconnect(id: number): boolean;
      handlePlayerDisconnect(id: number): void;
    }

    // Players are added by start(), not the constructor — building a room without it makes
    // every assertion here vacuously true.
    async function makeRoom() {
      mockGameLoopIsRunning.mockReturnValue(true);
      const gameRoom = new GameRoom(mockIo, createMockRoom() as any);
      await gameRoom.start();
      return gameRoom as unknown as Abandonable & { gameState: any };
    }

    /** Ids of the humans start() actually put in the game state. */
    function humansOf(gr: { gameState: any }): number[] {
      return [...gr.gameState.players.values()].filter((p: any) => !p.isBot).map((p: any) => p.id);
    }

    it('is false while a human is still playing', async () => {
      const gr = await makeRoom();
      expect(humansOf(gr).length).toBeGreaterThan(0); // guard against a vacuous pass
      expect(gr.isAbandoned()).toBe(false);
    });

    it('is false when humans died in normal play', async () => {
      const gr = await makeRoom();
      for (const p of gr.gameState.players.values()) p.alive = false;
      // Nobody departed — they were killed. This is a real finish, not an abandonment.
      expect(gr.isAbandoned()).toBe(false);
    });

    it('is true once every human has explicitly left', async () => {
      const gr = await makeRoom();
      const humanIds = humansOf(gr);
      expect(humanIds.length).toBeGreaterThan(0);

      for (const id of humanIds) gr.handlePlayerLeave(id);
      expect(gr.isAbandoned()).toBe(true);
    });

    it('is false while even one human remains', async () => {
      const gr = await makeRoom();
      const humanIds = humansOf(gr);

      gr.handlePlayerLeave(humanIds[0]);
      expect(gr.isAbandoned()).toBe(false);
    });

    it('counts a disconnect whose grace period expired', async () => {
      const gr = await makeRoom();
      const humanIds = humansOf(gr);

      // Simulate grace expiry the way checkDisconnectGracePeriods does.
      for (const id of humanIds) gr.departedHumans.add(id);
      expect(gr.isAbandoned()).toBe(true);
    });

    it('un-departs a player who reconnects', async () => {
      const gr = await makeRoom();
      const humanIds = humansOf(gr);

      for (const id of humanIds) gr.handlePlayerLeave(id);
      expect(gr.isAbandoned()).toBe(true);

      gr.handlePlayerReconnect(humanIds[0]);
      expect(gr.isAbandoned()).toBe(false);
    });

    it('is false for a room with no humans at all', async () => {
      const gr = await makeRoom();
      for (const p of gr.gameState.players.values()) p.isBot = true;
      expect(gr.isAbandoned()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────
  // Game over persistence
  // ─────────────────────────────────────────────────
  // The post-match writes used to be ~5 sequential round-trips per player with no transaction, and
  // the whole handler ran fire-and-forget from GameLoop with its last await outside the try/catch.
  // (audit GAME-END-BATCH-1, GAME-OVER-ASYNC-1)
  describe('game over persistence', () => {
    async function finishGame(gameRoom: GameRoom): Promise<void> {
      const gr = gameRoom as unknown as {
        gameState: GameStateManager;
        onGameOver(): Promise<void>;
      };
      const [p1, p2] = [...gr.gameState.players.values()];
      p1.kills = 3;
      p1.placement = 1;
      p2.alive = false;
      p2.placement = 2;
      gr.gameState.winnerId = p1.id;
      await gr.onGameOver();
    }

    it('writes the match rows and the stats in two transactions with batched statements', async () => {
      const gameRoom = new GameRoom(mockIo, createMockRoom() as any);
      await gameRoom.start();
      mockConnExecute.mockClear();

      await finishGame(gameRoom);

      expect(mockWithTransaction).toHaveBeenCalledTimes(2);
      const sqls = mockConnExecute.mock.calls.map((c) => (c[0] as string).replace(/\s+/g, ' '));
      expect(sqls[0]).toMatch(/^UPDATE matches SET status = \?/);
      expect(sqls[1]).toMatch(/^INSERT INTO match_players/);
      expect(sqls[1]).toContain('ON DUPLICATE KEY UPDATE');
      expect(sqls[1].match(/\(\?, \?, \?, \?, \?, \?, \?, \?, \?\)/g)).toHaveLength(2);
      expect(sqls[2]).toMatch(/^SELECT user_id, total_xp, level FROM user_stats .* FOR UPDATE$/);
      const statUpdates = sqls.filter((q) => q.startsWith('UPDATE user_stats'));
      expect(statUpdates).toHaveLength(2);
      // XP and level are folded into the cumulative-stats UPDATE — no second read/write pair.
      for (const q of statUpdates) {
        expect(q).toContain('total_matches = total_matches + 1');
        expect(q).toContain('total_xp = ?');
        expect(q).toContain('level = ?');
      }
      expect(mockExecute.mock.calls.some((c) => (c[0] as string).includes('user_stats'))).toBe(
        false,
      );
    });

    it('runs Elo before the stats increment and evaluates achievements for every human', async () => {
      const order: string[] = [];
      mockProcessMatchElo.mockImplementation(async () => {
        order.push('elo');
        return [];
      });
      mockWithTransaction.mockImplementation(async (fn: AnyFn) => {
        order.push('tx');
        return fn({ execute: mockConnExecute });
      });
      const gameRoom = new GameRoom(mockIo, createMockRoom() as any);
      await gameRoom.start();

      await finishGame(gameRoom);

      expect(order).toEqual(['tx', 'elo', 'tx']);
      expect(mockEvaluateAfterGame).toHaveBeenCalledTimes(2);
      expect(mockEmit).toHaveBeenCalledWith('game:over', expect.objectContaining({ winnerId: 1 }));
      expect(mockEmit).toHaveBeenCalledWith(
        'game:xpUpdate',
        expect.arrayContaining([expect.objectContaining({ userId: 1, oldLevel: 1 })]),
      );
      expect(mockUpdateRoomStatus).toHaveBeenCalledWith('ABC123', 'finished');
    });

    it('still marks the room finished when the DB writes fail, and never rejects', async () => {
      mockWithTransaction.mockRejectedValueOnce(new Error('db down'));
      const gameRoom = new GameRoom(mockIo, createMockRoom() as any);
      await gameRoom.start();

      await expect(finishGame(gameRoom)).resolves.toBeUndefined();

      expect(mockUpdateRoomStatus).toHaveBeenCalledWith('ABC123', 'finished');
    });

    it('never rejects when the room status update fails', async () => {
      const gameRoom = new GameRoom(mockIo, createMockRoom() as any);
      await gameRoom.start();
      mockUpdateRoomStatus.mockRejectedValueOnce(new Error('redis down'));

      await expect(finishGame(gameRoom)).resolves.toBeUndefined();
    });
  });
});

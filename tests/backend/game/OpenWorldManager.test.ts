import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

// --- Mock setup (jest.mock is hoisted before imports) ---

jest.mock('../../../backend/src/db/connection', () => ({
  query: jest.fn(),
  execute: jest.fn<AnyFn>().mockResolvedValue(undefined),
}));

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockSettings = {
  enabled: true,
  mapWidth: 21,
  mapHeight: 21,
  wallDensity: 0.3,
  roundTime: 300,
  maxPlayers: 32,
  respawnDelay: 3,
  afkTimeoutSeconds: 60,
  guestAccess: true,
};

jest.mock('../../../backend/src/services/settings', () => ({
  isOpenWorldEnabled: jest.fn<AnyFn>().mockResolvedValue(true),
  getOpenWorldSettings: jest.fn<AnyFn>().mockResolvedValue(mockSettings),
}));

// Capture the per-tick callback so tests can drive ticks without a real timer loop
const mockTickRef: { current: ((state: unknown) => void) | null } = { current: null };
jest.mock('../../../backend/src/game/GameLoop', () => ({
  GameLoop: jest.fn().mockImplementation((...args: unknown[]) => {
    mockTickRef.current = args[1] as (state: unknown) => void;
    return { start: jest.fn(), stop: jest.fn(), isRunning: jest.fn().mockReturnValue(true) };
  }),
}));

jest.mock('../../../backend/src/utils/replayRecorder', () => ({
  ReplayRecorder: jest.fn().mockImplementation(() => ({
    setSessionId: jest.fn(),
    recordTick: jest.fn(),
    finalize: jest.fn(),
  })),
}));

jest.mock('../../../backend/src/utils/gameLogger', () => ({
  GameLogger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    logGameOver: jest.fn(),
  })),
}));

import { openWorldManager } from '../../../backend/src/game/OpenWorldManager';
import { GameStateManager } from '../../../backend/src/game/GameState';
import { KillCause, OpenWorldScoreEntry } from '@blast-arena/shared';

interface EmittedEvent {
  room: string;
  event: string;
  payload: unknown;
}

/** Minimal socket.io server double: records every `io.to(room).emit(event, payload)`. */
function createIoDouble() {
  const emitted: EmittedEvent[] = [];
  let currentRoom = '';
  const io = {
    to(room: string) {
      currentRoom = room;
      return io;
    },
    emit(event: string, payload: unknown) {
      emitted.push({ room: currentRoom, event, payload });
      return true;
    },
    sockets: { sockets: new Map() },
  };
  return { io, emitted };
}

/** The private game state the manager drives — reached directly to stage kill events. */
function internalState(): GameStateManager {
  return (openWorldManager as unknown as { gameState: GameStateManager }).gameState;
}

function eventsOfType(emitted: EmittedEvent[], event: string): unknown[] {
  return emitted.filter((e) => e.event === event).map((e) => e.payload);
}

describe('OpenWorldManager', () => {
  let io: ReturnType<typeof createIoDouble>['io'];
  let emitted: EmittedEvent[];

  beforeEach(async () => {
    const double = createIoDouble();
    io = double.io;
    emitted = double.emitted;
    mockTickRef.current = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await openWorldManager.init(io as any);
  });

  afterEach(() => {
    openWorldManager.shutdown();
  });

  describe('getLeaderboard', () => {
    it('returns every player sorted by score, then kills — not just the top 10', () => {
      for (let i = 0; i < 12; i++) {
        openWorldManager.handleJoin(`sock${i}`, i + 1, `Player${i}`, false);
      }
      const board = openWorldManager.getLeaderboard();
      expect(board).toHaveLength(12);

      // Give one late joiner the top score and another a mid score
      const players = (
        openWorldManager as unknown as {
          players: Map<number, { score: number; kills: number; deaths: number }>;
        }
      ).players;
      players.get(12)!.score = 10;
      players.get(12)!.kills = 5;
      players.get(3)!.score = 4;
      players.get(3)!.kills = 2;

      const sorted = openWorldManager.getLeaderboard();
      expect(sorted[0]).toMatchObject({ playerId: 12, score: 10, kills: 5 });
      expect(sorted[1]).toMatchObject({ playerId: 3, score: 4, kills: 2 });
      expect(sorted).toHaveLength(12);
    });

    it('breaks score ties by kill count', () => {
      openWorldManager.handleJoin('a', 1, 'Alice', false);
      openWorldManager.handleJoin('b', 2, 'Bob', false);
      const players = (
        openWorldManager as unknown as { players: Map<number, { score: number; kills: number }> }
      ).players;
      players.get(1)!.score = 4;
      players.get(1)!.kills = 2;
      players.get(2)!.score = 4;
      players.get(2)!.kills = 3;

      expect(openWorldManager.getLeaderboard().map((e) => e.playerId)).toEqual([2, 1]);
    });
  });

  describe('broadcastInfo', () => {
    it('includes the round number, player count and standings', () => {
      openWorldManager.handleJoin('a', 1, 'Alice', false);
      emitted.length = 0;

      openWorldManager.broadcastInfo();

      const infos = eventsOfType(emitted, 'openworld:info') as {
        playerCount: number;
        maxPlayers: number;
        roundNumber: number;
        leaderboard: OpenWorldScoreEntry[];
      }[];
      expect(infos).toHaveLength(1);
      expect(infos[0].playerCount).toBe(1);
      expect(infos[0].maxPlayers).toBe(mockSettings.maxPlayers);
      expect(infos[0].roundNumber).toBe(1);
      expect(infos[0].leaderboard).toEqual([
        { playerId: 1, username: 'Alice', kills: 0, deaths: 0, score: 0, isGuest: false },
      ]);
      expect(emitted.every((e) => e.room === 'openworld')).toBe(true);
    });

    it('fires on leave so the remaining players see the updated board', () => {
      openWorldManager.handleJoin('a', 1, 'Alice', false);
      openWorldManager.handleJoin('b', 2, 'Bob', false);
      emitted.length = 0;

      openWorldManager.handleLeave('b');

      const infos = eventsOfType(emitted, 'openworld:info') as {
        playerCount: number;
        leaderboard: OpenWorldScoreEntry[];
      }[];
      expect(infos).toHaveLength(1);
      expect(infos[0].playerCount).toBe(1);
      expect(infos[0].leaderboard.map((e) => e.playerId)).toEqual([1]);
    });
  });

  describe('kill scoring', () => {
    function tickWithDeath(playerId: number, killerId: number | null, cause: KillCause = 'bomb') {
      const state = internalState();
      state.tickEvents.playerDied.push({ playerId, killerId, cause });
      mockTickRef.current!(state.toTickState());
    }

    it('emits a score update for both the killer and the victim', () => {
      openWorldManager.handleJoin('a', 1, 'Alice', false);
      openWorldManager.handleJoin('b', 2, 'Bob', false);
      emitted.length = 0;

      tickWithDeath(2, 1);

      const updates = eventsOfType(emitted, 'openworld:scoreUpdate') as OpenWorldScoreEntry[];
      expect(updates).toHaveLength(2);
      expect(updates[0]).toMatchObject({ playerId: 1, kills: 1, deaths: 0, score: 2 });
      expect(updates[1]).toMatchObject({ playerId: 2, kills: 0, deaths: 1, score: 0 });
    });

    it('emits a score update for a self-kill without crediting a killer', () => {
      openWorldManager.handleJoin('a', 1, 'Alice', false);
      const players = (openWorldManager as unknown as { players: Map<number, { score: number }> })
        .players;
      players.get(1)!.score = 4;
      emitted.length = 0;

      tickWithDeath(1, 1, 'self');

      const updates = eventsOfType(emitted, 'openworld:scoreUpdate') as OpenWorldScoreEntry[];
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({ playerId: 1, kills: 0, deaths: 1, score: 3 });
    });

    it('never drives a score below zero', () => {
      openWorldManager.handleJoin('a', 1, 'Alice', false);
      emitted.length = 0;

      tickWithDeath(1, null, 'lava');

      const updates = eventsOfType(emitted, 'openworld:scoreUpdate') as OpenWorldScoreEntry[];
      expect(updates[0]).toMatchObject({ playerId: 1, deaths: 1, score: 0 });
    });
  });

  describe('getStatus', () => {
    it('carries the standings for the lobby view, which is outside the socket room', () => {
      openWorldManager.handleJoin('a', 1, 'Alice', false);
      const status = openWorldManager.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.roundNumber).toBe(1);
      expect(status.leaderboard).toEqual([
        { playerId: 1, username: 'Alice', kills: 0, deaths: 0, score: 0, isGuest: false },
      ]);
    });
  });
});

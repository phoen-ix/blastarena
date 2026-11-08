import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

type AnyFn = (...args: any[]) => any;

/**
 * sim:start validates its payload with the same schema as POST /admin/simulations. It used to hand
 * the raw socket payload to startBatch.
 */

const mockStartBatch = vi.hoisted(() => vi.fn<AnyFn>());
const mockLogAdminAction = vi.hoisted(() => vi.fn<AnyFn>());
// The fake socket.io Server keeps the connection listener so a test can connect a fake socket.
const captured = vi.hoisted(() => ({ onConnection: null as AnyFn | null }));

vi.mock('socket.io', () => ({
  Server: class {
    sockets = { sockets: new Map(), adapter: { rooms: new Map() } };
    use() {}
    on(event: string, fn: AnyFn) {
      if (event === 'connection') captured.onConnection = fn;
    }
    to() {
      return { emit: () => {} };
    }
    emit() {}
  },
}));
vi.mock('../../../backend/src/config', () => ({
  getConfig: () => ({ APP_URL: 'http://localhost' }),
}));
vi.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../backend/src/db/connection', () => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock('../../../backend/src/game/registry', () => ({
  setRegistry: vi.fn(),
  getSimulationManager: () => ({ startBatch: mockStartBatch, cleanup: vi.fn() }),
  getCampaignGameManager: vi.fn(),
  getIO: vi.fn(),
}));
vi.mock('../../../backend/src/game/OpenWorldManager', () => ({
  openWorldManager: { init: vi.fn(async () => {}), shutdown: vi.fn() },
}));
vi.mock('../../../backend/src/services/admin-audit', () => ({
  logAdminAction: mockLogAdminAction,
}));
vi.mock('../../../backend/src/services/presence', () => ({
  setPresenceBatch: vi.fn(async () => {}),
  refreshPresenceBatch: vi.fn(async () => {}),
}));
vi.mock('../../../backend/src/handlers/friendHandlers', () => ({
  setupFriendHandlers: vi.fn(),
  notifyFriendsOnline: vi.fn(),
  notifyFriendsOffline: vi.fn(),
  cleanupFriendLimiters: vi.fn(),
}));
vi.mock('../../../backend/src/handlers/partyHandlers', () => ({
  setupPartyHandlers: vi.fn(),
  schedulePartyLeave: vi.fn(),
  cleanupPartyLimiters: vi.fn(),
}));
vi.mock('../../../backend/src/handlers/lobbyHandlers', () => ({
  setupLobbyHandlers: vi.fn(),
  cleanupLobbyLimiters: vi.fn(),
}));
vi.mock('../../../backend/src/handlers/dmHandlers', () => ({
  setupDMHandlers: vi.fn(),
  cleanupDMLimiters: vi.fn(),
}));
vi.mock('../../../backend/src/services/party', () => ({ getPlayerParty: vi.fn(async () => null) }));
vi.mock('../../../backend/src/services/lobby', () => ({ getPlayerRoom: vi.fn(async () => null) }));

import { createSocketServer } from '../../../backend/src/socket';

const VALID = {
  gameMode: 'ffa',
  botCount: 4,
  botDifficulty: 'normal',
  mapWidth: 15,
  mapHeight: 13,
  roundTime: 180,
  wallDensity: 0.6,
  enabledPowerUps: ['bomb_up', 'fire_up'],
  powerUpDropRate: 0.3,
  friendlyFire: true,
  hazardTiles: false,
  reinforcedWalls: false,
  enableMapEvents: false,
  totalGames: 10,
  speed: 'fast',
  logVerbosity: 'normal',
};

let simStart: AnyFn;

beforeAll(() => {
  vi.useFakeTimers(); // createSocketServer starts cleanup/presence intervals
  createSocketServer({} as any);
  vi.useRealTimers();
  const handlers: Record<string, AnyFn> = {};
  captured.onConnection!({
    id: 'socket-1',
    data: { userId: 1, username: 'admin', role: 'admin' },
    handshake: { headers: {}, address: '127.0.0.1' },
    on: (event: string, fn: AnyFn) => (handlers[event] = fn),
    use: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    emit: vi.fn(),
  });
  simStart = handlers['sim:start'];
});

beforeEach(() => {
  vi.clearAllMocks();
  mockStartBatch.mockReturnValue({ batchId: 'sim_1' });
});

describe('sim:start payload validation', () => {
  it('starts a batch for a valid config and logs it', async () => {
    const callback = vi.fn();
    await simStart({ ...VALID, extra: 'dropped' }, callback);
    expect(mockStartBatch).toHaveBeenCalledWith(VALID, 1);
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      1,
      'simulation_start',
      'simulation',
      0,
      JSON.stringify({ batchId: 'sim_1', gameMode: 'ffa', totalGames: 10 }),
    );
    expect(callback).toHaveBeenCalledWith({ success: true, batchId: 'sim_1' });
  });

  it.each([
    ['a missing field', { ...VALID, totalGames: undefined }],
    ['totalGames above 1000', { ...VALID, totalGames: 1_000_000 }],
    ['an unknown game mode', { ...VALID, gameMode: 'nope' }],
    ['a wrong type', { ...VALID, botCount: '4' }],
    ['a non-object payload', 'x'],
    ['null', null],
  ])('rejects %s: error ack, no batch, nothing logged', async (_label, payload) => {
    const callback = vi.fn();
    await simStart(payload, callback);
    expect(callback).toHaveBeenCalledWith({ success: false, error: 'Invalid input' });
    expect(mockStartBatch).not.toHaveBeenCalled();
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });
});

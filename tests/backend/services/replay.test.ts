import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockQuery = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
}));

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const mockExistsSync = jest.fn<AnyFn>();
const mockReaddirSync = jest.fn<AnyFn>();
const mockStatSync = jest.fn<AnyFn>();
const mockReadFileSync = jest.fn<AnyFn>();
const mockUnlinkSync = jest.fn<AnyFn>();
const mockAccess = jest.fn<AnyFn>();
const mockReaddir = jest.fn<AnyFn>();
const mockStat = jest.fn<AnyFn>();
jest.mock('fs', () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
  statSync: mockStatSync,
  readFileSync: mockReadFileSync,
  unlinkSync: mockUnlinkSync,
  promises: {
    access: mockAccess,
    readdir: mockReaddir,
    stat: mockStat,
  },
}));

const mockGunzip = jest.fn<AnyFn>();
jest.mock('zlib', () => ({
  gunzip: mockGunzip,
}));

jest.mock('util', () => ({
  promisify: () => mockGunzip,
}));

import {
  listReplays,
  getReplay,
  deleteReplay,
  hasReplay,
  getReplayPlacements,
} from '../../../backend/src/services/replay';
import { logger } from '../../../backend/src/utils/logger';

// --- Helper factories ---

function makeMatchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    room_code: 'ABCD',
    game_mode: 'ffa',
    duration: 120,
    player_count: 4,
    winner_username: 'Player1',
    started_at: new Date('2026-03-15T10:00:00Z'),
    ...overrides,
  };
}

function makeReplayData(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    matchId: 1,
    roomCode: 'ABCD',
    gameMode: 'ffa',
    config: { mapWidth: 15, mapHeight: 13, roundTime: 180 },
    gameOver: {
      winnerId: 1,
      winnerTeam: null,
      reason: 'last_standing',
      placements: [
        {
          userId: 1,
          username: 'Player1',
          isBot: false,
          placement: 1,
          kills: 3,
          selfKills: 0,
          team: null,
          alive: true,
        },
        {
          userId: 2,
          username: 'Player2',
          isBot: false,
          placement: 2,
          kills: 1,
          selfKills: 1,
          team: null,
          alive: false,
        },
      ],
    },
    map: { width: 15, height: 13, tiles: [] },
    totalTicks: 2400,
    tickRate: 20,
    frames: [],
    log: [],
    ...overrides,
  };
}

describe('Replay Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listReplays', () => {
    it('should return empty when replay dir does not exist', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));

      const result = await listReplays();

      expect(result).toEqual({ replays: [], total: 0 });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should return empty when dir has no replay files', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue(['readme.txt', 'notes.json']);

      const result = await listReplays();

      expect(result).toEqual({ replays: [], total: 0 });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should return empty when files do not match expected filename pattern', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue(['bad_name.replay.json.gz', 'abc_test.replay.json.gz']);

      const result = await listReplays();

      expect(result).toEqual({ replays: [], total: 0 });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should query DB and return replay list for valid files', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue(['1_room1.replay.json.gz', '2_room2.replay.json.gz']);
      mockStat.mockResolvedValue({ size: 2048 });

      const row1 = makeMatchRow({ id: 1 });
      const row2 = makeMatchRow({ id: 2, room_code: 'EFGH', winner_username: 'Player2' });
      mockQuery.mockResolvedValue([row1, row2]);

      const result = await listReplays();

      expect(result.total).toBe(2);
      expect(result.replays).toHaveLength(2);
      expect(result.replays[0].matchId).toBe(1);
      expect(result.replays[0].roomCode).toBe('ABCD');
      expect(result.replays[0].fileSizeKB).toBe(2);
      expect(result.replays[1].matchId).toBe(2);
      expect(result.replays[1].roomCode).toBe('EFGH');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE m.id IN'),
        expect.arrayContaining([1, 2]),
      );
    });

    it('should compute file size in KB correctly', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue(['5_game.replay.json.gz']);
      mockStat.mockResolvedValue({ size: 5632 }); // 5632 / 1024 = 5.5 -> rounds to 6

      mockQuery.mockResolvedValue([makeMatchRow({ id: 5 })]);

      const result = await listReplays();

      expect(result.replays[0].fileSizeKB).toBe(6);
    });

    it('should paginate results correctly', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue([
        '1_a.replay.json.gz',
        '2_b.replay.json.gz',
        '3_c.replay.json.gz',
      ]);
      mockStat.mockResolvedValue({ size: 1024 });

      const rows = [makeMatchRow({ id: 1 }), makeMatchRow({ id: 2 }), makeMatchRow({ id: 3 })];
      mockQuery.mockResolvedValue(rows);

      // Page 2 with limit 1 should return only the second item
      const result = await listReplays(2, 1);

      expect(result.total).toBe(3);
      expect(result.replays).toHaveLength(1);
      expect(result.replays[0].matchId).toBe(2);
    });

    it('should return empty page when offset exceeds total', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue(['1_a.replay.json.gz']);
      mockStat.mockResolvedValue({ size: 1024 });
      mockQuery.mockResolvedValue([makeMatchRow({ id: 1 })]);

      const result = await listReplays(5, 10);

      expect(result.total).toBe(1);
      expect(result.replays).toHaveLength(0);
    });

    it('should convert Date started_at to ISO string', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue(['1_a.replay.json.gz']);
      mockStat.mockResolvedValue({ size: 1024 });

      const date = new Date('2026-03-15T12:30:00Z');
      mockQuery.mockResolvedValue([makeMatchRow({ id: 1, started_at: date })]);

      const result = await listReplays();

      expect(result.replays[0].createdAt).toBe(date.toISOString());
    });

    it('should convert non-Date started_at to string', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue(['1_a.replay.json.gz']);
      mockStat.mockResolvedValue({ size: 1024 });

      mockQuery.mockResolvedValue([makeMatchRow({ id: 1, started_at: '2026-03-15' })]);

      const result = await listReplays();

      expect(result.replays[0].createdAt).toBe('2026-03-15');
    });

    it('should use 0 for null duration', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue(['1_a.replay.json.gz']);
      mockStat.mockResolvedValue({ size: 1024 });

      mockQuery.mockResolvedValue([makeMatchRow({ id: 1, duration: null })]);

      const result = await listReplays();

      expect(result.replays[0].duration).toBe(0);
    });

    it('should use default page=1 and limit=20', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue(
        Array.from({ length: 25 }, (_, i) => `${i + 1}_g.replay.json.gz`),
      );
      mockStat.mockResolvedValue({ size: 512 });

      const rows = Array.from({ length: 25 }, (_, i) => makeMatchRow({ id: i + 1 }));
      mockQuery.mockResolvedValue(rows);

      const result = await listReplays();

      expect(result.total).toBe(25);
      expect(result.replays).toHaveLength(20);
    });
  });

  describe('getReplay', () => {
    it('should return parsed replay data when file exists', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['42_room.replay.json.gz']);

      const replayData = makeReplayData({ matchId: 42 });
      const jsonBuffer = Buffer.from(JSON.stringify(replayData));
      mockReadFileSync.mockReturnValue(Buffer.from('compressed'));
      mockGunzip.mockResolvedValue(jsonBuffer);

      const result = await getReplay(42);

      expect(result).toEqual(replayData);
      expect(mockReadFileSync).toHaveBeenCalled();
      expect(mockGunzip).toHaveBeenCalledWith(Buffer.from('compressed'));
    });

    it('should return null when replay file is not found', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      const result = await getReplay(999);

      expect(result).toBeNull();
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it('should return null when replay dir does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await getReplay(1);

      expect(result).toBeNull();
    });

    it('should return null and log error on decompression failure', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['1_room.replay.json.gz']);
      mockReadFileSync.mockReturnValue(Buffer.from('corrupted'));
      mockGunzip.mockRejectedValue(new Error('decompression failed'));

      const result = await getReplay(1);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ matchId: 1 }),
        'Failed to read replay file',
      );
    });

    it('should return null and log error on invalid JSON', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['1_room.replay.json.gz']);
      mockReadFileSync.mockReturnValue(Buffer.from('data'));
      mockGunzip.mockResolvedValue(Buffer.from('not valid json {{{'));

      const result = await getReplay(1);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ matchId: 1 }),
        'Failed to read replay file',
      );
    });
  });

  describe('deleteReplay', () => {
    it('should delete file and return true when file exists', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['10_game.replay.json.gz']);

      const result = deleteReplay(10);

      expect(result).toBe(true);
      expect(mockUnlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('10_game.replay.json.gz'),
      );
    });

    it('should return false when file is not found', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      const result = deleteReplay(999);

      expect(result).toBe(false);
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('should return false when replay dir does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = deleteReplay(1);

      expect(result).toBe(false);
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('should return false and log error when unlink throws', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['5_room.replay.json.gz']);
      mockUnlinkSync.mockImplementation(() => {
        throw new Error('permission denied');
      });

      const result = deleteReplay(5);

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ matchId: 5 }),
        'Failed to delete replay file',
      );
    });
  });

  describe('hasReplay', () => {
    it('should return true when replay file exists', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['7_abc.replay.json.gz']);

      expect(hasReplay(7)).toBe(true);
    });

    it('should return false when replay file does not exist', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['8_abc.replay.json.gz']);

      expect(hasReplay(99)).toBe(false);
    });

    it('should return false when replay dir does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      expect(hasReplay(1)).toBe(false);
    });
  });

  describe('getReplayPlacements', () => {
    it('should return placements from replay data', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['3_room.replay.json.gz']);

      const replayData = makeReplayData({ matchId: 3 });
      mockReadFileSync.mockReturnValue(Buffer.from('compressed'));
      mockGunzip.mockResolvedValue(Buffer.from(JSON.stringify(replayData)));

      const result = await getReplayPlacements(3);

      expect(result).toEqual(replayData.gameOver.placements);
      expect(result).toHaveLength(2);
      expect(result![0].username).toBe('Player1');
    });

    it('should return null when replay file does not exist', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      const result = await getReplayPlacements(999);

      expect(result).toBeNull();
    });

    it('should return null when gameOver is missing', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['4_room.replay.json.gz']);

      const replayData = makeReplayData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (replayData as any).gameOver;
      mockReadFileSync.mockReturnValue(Buffer.from('data'));
      mockGunzip.mockResolvedValue(Buffer.from(JSON.stringify(replayData)));

      const result = await getReplayPlacements(4);

      expect(result).toBeNull();
    });

    it('should return null when gameOver.placements is missing', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['4_room.replay.json.gz']);

      const replayData = makeReplayData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (replayData as any).gameOver = { winnerId: null, reason: 'timeout' };
      mockReadFileSync.mockReturnValue(Buffer.from('data'));
      mockGunzip.mockResolvedValue(Buffer.from(JSON.stringify(replayData)));

      const result = await getReplayPlacements(4);

      expect(result).toBeNull();
    });

    it('should return null and log error on read failure', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['6_room.replay.json.gz']);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('read error');
      });

      const result = await getReplayPlacements(6);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ matchId: 6 }),
        'Failed to read replay placements',
      );
    });

    it('should return null and log error on decompression failure', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['6_room.replay.json.gz']);
      mockReadFileSync.mockReturnValue(Buffer.from('data'));
      mockGunzip.mockRejectedValue(new Error('gunzip failed'));

      const result = await getReplayPlacements(6);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ matchId: 6 }),
        'Failed to read replay placements',
      );
    });
  });

  describe('findReplayFile (via public functions)', () => {
    it('should match file by matchId prefix', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        '10_first.replay.json.gz',
        '100_second.replay.json.gz',
        '1_third.replay.json.gz',
      ]);

      // matchId 10 should match "10_" prefix, not "100_" or "1_"
      expect(hasReplay(10)).toBe(true);
      expect(hasReplay(100)).toBe(true);
      expect(hasReplay(1)).toBe(true);
    });

    it('should not match file without .replay.json.gz extension', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['5_game.json', '5_game.txt']);

      expect(hasReplay(5)).toBe(false);
    });

    it('should not match file with prefix that is not followed by underscore', () => {
      mockExistsSync.mockReturnValue(true);
      // "12abc.replay.json.gz" starts with "12" but not "12_"
      mockReaddirSync.mockReturnValue(['12abc.replay.json.gz']);

      expect(hasReplay(12)).toBe(false);
    });
  });
});

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
const mockUnlink = jest.fn<AnyFn>();
const mockAccess = jest.fn<AnyFn>();
const mockReaddir = jest.fn<AnyFn>();
const mockStat = jest.fn<AnyFn>();
jest.mock('fs', () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
  statSync: mockStatSync,
  readFileSync: mockReadFileSync,
  unlinkSync: mockUnlink,
  promises: {
    access: mockAccess,
    readdir: mockReaddir,
    stat: mockStat,
    unlink: mockUnlink,
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
  invalidateReplayIndex,
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
    // The directory listing is cached for a few seconds so a bulk delete does not re-scan;
    // each test needs a clean index.
    invalidateReplayIndex();
    mockReaddir.mockResolvedValue([]);
    mockUnlink.mockResolvedValue(undefined);
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

    // Pagination now happens BEFORE the query: match ids come from the directory listing, are
    // sorted newest-first and sliced, and only that page's ids are sent to the database. The old
    // shape statted every file and built a `WHERE m.id IN (?,…)` over the entire directory just to
    // return one page. (audit REPLAY-LIST-1)
    it('should paginate before querying, asking the DB only for the page', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue([
        '1_a.replay.json.gz',
        '2_b.replay.json.gz',
        '3_c.replay.json.gz',
      ]);
      mockStat.mockResolvedValue({ size: 1024 });
      mockQuery.mockResolvedValue([makeMatchRow({ id: 2 })]);

      // Ids sort descending (3, 2, 1), so page 2 at limit 1 is id 2.
      const result = await listReplays(2, 1);

      expect(result.total).toBe(3);
      expect(result.replays).toHaveLength(1);
      expect(result.replays[0].matchId).toBe(2);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE m.id IN'), [2]);
    });

    it('should stat only the files on the requested page', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue(
        Array.from({ length: 50 }, (_, i) => `${i + 1}_g.replay.json.gz`),
      );
      mockStat.mockResolvedValue({ size: 1024 });
      mockQuery.mockResolvedValue([makeMatchRow({ id: 50 })]);

      await listReplays(1, 1);

      // One page entry -> exactly one stat, not fifty.
      expect(mockStat).toHaveBeenCalledTimes(1);
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

      // Newest 20 of 25, i.e. ids 25 down to 6.
      const pageIds = Array.from({ length: 20 }, (_, i) => 25 - i);
      mockQuery.mockResolvedValue(pageIds.map((id) => makeMatchRow({ id })));

      const result = await listReplays();

      expect(result.total).toBe(25);
      expect(result.replays).toHaveLength(20);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE m.id IN'), pageIds);
    });
  });

  describe('getReplay', () => {
    it('should return parsed replay data when file exists', async () => {
      mockReaddir.mockResolvedValue(['42_room.replay.json.gz']);

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
      mockReaddir.mockResolvedValue([]);

      const result = await getReplay(999);

      expect(result).toBeNull();
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it('should return null when replay dir does not exist', async () => {
      mockReaddir.mockRejectedValue(new Error('ENOENT'));

      const result = await getReplay(1);

      expect(result).toBeNull();
    });

    it('should return null and log error on decompression failure', async () => {
      mockReaddir.mockResolvedValue(['1_room.replay.json.gz']);
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
      mockReaddir.mockResolvedValue(['1_room.replay.json.gz']);
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
    it('should delete file and return true when file exists', async () => {
      mockReaddir.mockResolvedValue(['10_game.replay.json.gz']);

      const result = await deleteReplay(10);

      expect(result).toBe(true);
      expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('10_game.replay.json.gz'));
    });

    it('should return false when file is not found', async () => {
      mockReaddir.mockResolvedValue([]);

      const result = await deleteReplay(999);

      expect(result).toBe(false);
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('should return false when replay dir does not exist', async () => {
      mockReaddir.mockRejectedValue(new Error('ENOENT'));

      const result = await deleteReplay(1);

      expect(result).toBe(false);
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('should return false and log error when unlink throws', async () => {
      mockReaddir.mockResolvedValue(['5_room.replay.json.gz']);
      mockUnlink.mockImplementation(() => {
        throw new Error('permission denied');
      });

      const result = await deleteReplay(5);

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ matchId: 5 }),
        'Failed to delete replay file',
      );
    });
  });

  describe('hasReplay', () => {
    it('should return true when replay file exists', async () => {
      mockReaddir.mockResolvedValue(['7_abc.replay.json.gz']);

      expect(await hasReplay(7)).toBe(true);
    });

    it('should return false when replay file does not exist', async () => {
      mockReaddir.mockResolvedValue(['8_abc.replay.json.gz']);

      expect(await hasReplay(99)).toBe(false);
    });

    it('should return false when replay dir does not exist', async () => {
      mockReaddir.mockRejectedValue(new Error('ENOENT'));

      expect(await hasReplay(1)).toBe(false);
    });
  });

  describe('getReplayPlacements', () => {
    it('should return placements from replay data', async () => {
      mockReaddir.mockResolvedValue(['3_room.replay.json.gz']);

      const replayData = makeReplayData({ matchId: 3 });
      mockReadFileSync.mockReturnValue(Buffer.from('compressed'));
      mockGunzip.mockResolvedValue(Buffer.from(JSON.stringify(replayData)));

      const result = await getReplayPlacements(3);

      expect(result).toEqual(replayData.gameOver.placements);
      expect(result).toHaveLength(2);
      expect(result![0].username).toBe('Player1');
    });

    it('should return null when replay file does not exist', async () => {
      mockReaddir.mockResolvedValue([]);

      const result = await getReplayPlacements(999);

      expect(result).toBeNull();
    });

    it('should return null when gameOver is missing', async () => {
      mockReaddir.mockResolvedValue(['4_room.replay.json.gz']);

      const replayData = makeReplayData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (replayData as any).gameOver;
      mockReadFileSync.mockReturnValue(Buffer.from('data'));
      mockGunzip.mockResolvedValue(Buffer.from(JSON.stringify(replayData)));

      const result = await getReplayPlacements(4);

      expect(result).toBeNull();
    });

    it('should return null when gameOver.placements is missing', async () => {
      mockReaddir.mockResolvedValue(['4_room.replay.json.gz']);

      const replayData = makeReplayData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (replayData as any).gameOver = { winnerId: null, reason: 'timeout' };
      mockReadFileSync.mockReturnValue(Buffer.from('data'));
      mockGunzip.mockResolvedValue(Buffer.from(JSON.stringify(replayData)));

      const result = await getReplayPlacements(4);

      expect(result).toBeNull();
    });

    it('should return null and log error on read failure', async () => {
      mockReaddir.mockResolvedValue(['6_room.replay.json.gz']);
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
      mockReaddir.mockResolvedValue(['6_room.replay.json.gz']);
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
    it('should match file by matchId prefix', async () => {
      mockReaddir.mockResolvedValue([
        '10_first.replay.json.gz',
        '100_second.replay.json.gz',
        '1_third.replay.json.gz',
      ]);

      // matchId 10 should match "10_" prefix, not "100_" or "1_"
      expect(await hasReplay(10)).toBe(true);
      expect(await hasReplay(100)).toBe(true);
      expect(await hasReplay(1)).toBe(true);
    });

    it('should not match file without .replay.json.gz extension', async () => {
      mockReaddir.mockResolvedValue(['5_game.json', '5_game.txt']);

      expect(await hasReplay(5)).toBe(false);
    });

    it('should not match file with prefix that is not followed by underscore', async () => {
      // "12abc.replay.json.gz" starts with "12" but not "12_"
      mockReaddir.mockResolvedValue(['12abc.replay.json.gz']);

      expect(await hasReplay(12)).toBe(false);
    });
  });

  // Regression: every lookup used to call fs.readdirSync(REPLAY_DIR) — a synchronous read of the
  // whole directory on the thread running the 20Hz game loop. DELETE /admin/matches made it
  // quadratic, calling deleteReplay once per match (up to 100k). (audit REPLAY-SCAN-1)
  describe('directory index', () => {
    it('reads the directory once for a bulk delete, not once per match', async () => {
      const files = Array.from({ length: 200 }, (_, i) => `${i + 1}_room.replay.json.gz`);
      mockReaddir.mockResolvedValue(files);

      for (let id = 1; id <= 200; id++) {
        expect(await deleteReplay(id)).toBe(true);
      }

      expect(mockUnlink).toHaveBeenCalledTimes(200);
      expect(mockReaddir).toHaveBeenCalledTimes(1);
    });

    it('never uses the synchronous directory API', async () => {
      mockReaddir.mockResolvedValue(['7_room.replay.json.gz']);
      await hasReplay(7);
      expect(mockReaddirSync).not.toHaveBeenCalled();
    });

    it('stops reporting a replay once it has been deleted', async () => {
      mockReaddir.mockResolvedValue(['7_room.replay.json.gz']);
      expect(await hasReplay(7)).toBe(true);
      expect(await deleteReplay(7)).toBe(true);
      expect(await hasReplay(7)).toBe(false);
      // Still a single scan — the index was updated in place.
      expect(mockReaddir).toHaveBeenCalledTimes(1);
    });

    it('re-reads the directory after invalidation', async () => {
      mockReaddir.mockResolvedValue(['7_room.replay.json.gz']);
      await hasReplay(7);
      invalidateReplayIndex();
      await hasReplay(7);
      expect(mockReaddir).toHaveBeenCalledTimes(2);
    });
  });
});

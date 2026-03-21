import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();
const mockWithTransaction = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
  withTransaction: mockWithTransaction,
}));

import {
  getActiveSeason,
  getSeasons,
  getSeasonById,
  createSeason,
  updateSeason,
  deleteSeason,
  activateSeason,
  endSeason,
  getUserSeasonHistory,
} from '../../../backend/src/services/season';

describe('Season Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWithTransaction.mockImplementation(async (fn: AnyFn) => {
      const conn = {
        query: jest.fn<AnyFn>(),
        execute: jest.fn<AnyFn>(),
      };
      return fn(conn);
    });
  });

  // ── getActiveSeason ─────────────────────────────────────────────────

  describe('getActiveSeason', () => {
    it('should return season when an active season exists', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 1,
          name: 'Season 1',
          start_date: new Date('2026-01-01'),
          end_date: new Date('2026-03-31'),
          is_active: true,
        },
      ]);

      const result = await getActiveSeason();

      expect(result).toEqual({
        id: 1,
        name: 'Season 1',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        isActive: true,
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM seasons WHERE is_active = TRUE'),
      );
    });

    it('should return null when no active season exists', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getActiveSeason();

      expect(result).toBeNull();
    });
  });

  // ── getSeasons ──────────────────────────────────────────────────────

  describe('getSeasons', () => {
    it('should return paginated seasons with correct total', async () => {
      mockQuery
        .mockResolvedValueOnce([
          {
            id: 2,
            name: 'Season 2',
            start_date: new Date('2026-04-01'),
            end_date: new Date('2026-06-30'),
            is_active: true,
          },
          {
            id: 1,
            name: 'Season 1',
            start_date: new Date('2026-01-01'),
            end_date: new Date('2026-03-31'),
            is_active: false,
          },
        ])
        .mockResolvedValueOnce([{ total: 5 }]);

      const result = await getSeasons(1, 2);

      expect(result.seasons).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.seasons[0]).toEqual({
        id: 2,
        name: 'Season 2',
        startDate: '2026-04-01',
        endDate: '2026-06-30',
        isActive: true,
      });
      expect(result.seasons[1]).toEqual({
        id: 1,
        name: 'Season 1',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        isActive: false,
      });
    });

    it('should calculate correct offset for page 2', async () => {
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]);

      await getSeasons(2, 10);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ? OFFSET ?'),
        [10, 10],
      );
    });

    it('should return empty array when no seasons exist', async () => {
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]);

      const result = await getSeasons();

      expect(result).toEqual({ seasons: [], total: 0 });
    });
  });

  // ── getSeasonById ───────────────────────────────────────────────────

  describe('getSeasonById', () => {
    it('should return season when found', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 3,
          name: 'Season 3',
          start_date: new Date('2026-07-01'),
          end_date: new Date('2026-09-30'),
          is_active: false,
        },
      ]);

      const result = await getSeasonById(3);

      expect(result).toEqual({
        id: 3,
        name: 'Season 3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        isActive: false,
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM seasons WHERE id = ?'),
        [3],
      );
    });

    it('should return null when season not found', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getSeasonById(999);

      expect(result).toBeNull();
    });
  });

  // ── createSeason ────────────────────────────────────────────────────

  describe('createSeason', () => {
    it('should create a season and return it with isActive false', async () => {
      mockExecute.mockResolvedValue({ insertId: 10 });

      const result = await createSeason('New Season', '2026-04-01', '2026-06-30');

      expect(result).toEqual({
        id: 10,
        name: 'New Season',
        startDate: '2026-04-01',
        endDate: '2026-06-30',
        isActive: false,
      });
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO seasons'),
        ['New Season', '2026-04-01', '2026-06-30'],
      );
    });

    it('should throw when end date is before start date', async () => {
      await expect(
        createSeason('Bad Season', '2026-06-30', '2026-01-01'),
      ).rejects.toThrow('End date must be after start date');

      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should throw when end date equals start date', async () => {
      await expect(
        createSeason('Equal Dates', '2026-06-01', '2026-06-01'),
      ).rejects.toThrow('End date must be after start date');

      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ── updateSeason ────────────────────────────────────────────────────

  describe('updateSeason', () => {
    it('should update name only', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateSeason(1, { name: 'Renamed' });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('name = ?'),
        ['Renamed', 1],
      );
    });

    it('should update startDate only', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateSeason(2, { startDate: '2026-05-01' });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('start_date = ?'),
        ['2026-05-01', 2],
      );
    });

    it('should update endDate only', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateSeason(3, { endDate: '2026-12-31' });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('end_date = ?'),
        ['2026-12-31', 3],
      );
    });

    it('should update multiple fields at once', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateSeason(1, { name: 'Updated', startDate: '2026-02-01', endDate: '2026-08-01' });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('SET'),
        ['Updated', '2026-02-01', '2026-08-01', 1],
      );
    });

    it('should not call execute when updates object is empty', async () => {
      await updateSeason(1, {});

      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ── deleteSeason ────────────────────────────────────────────────────

  describe('deleteSeason', () => {
    it('should call delete with the correct id', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await deleteSeason(5);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM seasons WHERE id = ?'),
        [5],
      );
    });
  });

  // ── activateSeason ──────────────────────────────────────────────────

  describe('activateSeason', () => {
    it('should use withTransaction to deactivate all and activate target', async () => {
      const connExecute = jest.fn<AnyFn>();
      connExecute.mockResolvedValue({ affectedRows: 1 });
      mockWithTransaction.mockImplementation(async (fn: AnyFn) =>
        fn({ query: jest.fn<AnyFn>(), execute: connExecute }),
      );

      await activateSeason(7);

      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      expect(connExecute).toHaveBeenCalledTimes(3);

      // First call: deactivate all seasons
      expect(connExecute.mock.calls[0][0]).toContain(
        'UPDATE seasons SET is_active = FALSE',
      );

      // Second call: activate target season
      expect(connExecute.mock.calls[1][0]).toContain(
        'UPDATE seasons SET is_active = TRUE WHERE id = ?',
      );
      expect(connExecute.mock.calls[1][1]).toEqual([7]);

      // Third call: create season_elo rows
      expect(connExecute.mock.calls[2][0]).toContain('INSERT IGNORE INTO season_elo');
      expect(connExecute.mock.calls[2][1]).toEqual([7]);
    });
  });

  // ── endSeason ───────────────────────────────────────────────────────

  describe('endSeason', () => {
    it('should hard reset elo to 1000', async () => {
      const connExecute = jest.fn<AnyFn>();
      connExecute.mockResolvedValue({ affectedRows: 1 });
      mockWithTransaction.mockImplementation(async (fn: AnyFn) =>
        fn({ query: jest.fn<AnyFn>(), execute: connExecute }),
      );

      await endSeason(3, 'hard');

      expect(mockWithTransaction).toHaveBeenCalledTimes(1);

      // First call: deactivate season
      expect(connExecute.mock.calls[0][0]).toContain(
        'UPDATE seasons SET is_active = FALSE WHERE id = ?',
      );
      expect(connExecute.mock.calls[0][1]).toEqual([3]);

      // Second call: hard reset
      expect(connExecute.mock.calls[1][0]).toContain(
        'UPDATE user_stats SET elo_rating = 1000',
      );

      // Third call: update peak_elo
      expect(connExecute.mock.calls[2][0]).toContain('GREATEST(peak_elo, elo_rating)');
    });

    it('should soft reset elo with 0.5 compression factor', async () => {
      const connExecute = jest.fn<AnyFn>();
      connExecute.mockResolvedValue({ affectedRows: 1 });
      mockWithTransaction.mockImplementation(async (fn: AnyFn) =>
        fn({ query: jest.fn<AnyFn>(), execute: connExecute }),
      );

      await endSeason(4, 'soft');

      expect(mockWithTransaction).toHaveBeenCalledTimes(1);

      // First call: deactivate season
      expect(connExecute.mock.calls[0][0]).toContain(
        'UPDATE seasons SET is_active = FALSE WHERE id = ?',
      );
      expect(connExecute.mock.calls[0][1]).toEqual([4]);

      // Second call: soft compression
      expect(connExecute.mock.calls[1][0]).toContain('(elo_rating - 1000) * 0.5');

      // Third call: update peak_elo
      expect(connExecute.mock.calls[2][0]).toContain('GREATEST(peak_elo, elo_rating)');
    });
  });

  // ── getUserSeasonHistory ────────────────────────────────────────────

  describe('getUserSeasonHistory', () => {
    it('should map rows to season history objects', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 2,
          name: 'Season 2',
          start_date: new Date('2026-04-01'),
          end_date: new Date('2026-06-30'),
          is_active: false,
          elo_rating: 1250,
          peak_elo: 1300,
          matches_played: 42,
        },
        {
          id: 1,
          name: 'Season 1',
          start_date: new Date('2026-01-01'),
          end_date: new Date('2026-03-31'),
          is_active: false,
          elo_rating: 1100,
          peak_elo: 1200,
          matches_played: 30,
        },
      ]);

      const result = await getUserSeasonHistory(5);

      expect(result).toEqual([
        {
          seasonId: 2,
          seasonName: 'Season 2',
          finalElo: 1250,
          peakElo: 1300,
          matchesPlayed: 42,
        },
        {
          seasonId: 1,
          seasonName: 'Season 1',
          finalElo: 1100,
          peakElo: 1200,
          matchesPlayed: 30,
        },
      ]);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('JOIN seasons'),
        [5],
      );
    });

    it('should return empty array when user has no season history', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getUserSeasonHistory(999);

      expect(result).toEqual([]);
    });
  });
});

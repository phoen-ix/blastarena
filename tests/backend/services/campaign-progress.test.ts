import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
}));

import {
  getUserState,
  getProgress,
  getAllProgress,
  recordAttempt,
  recordCompletion,
  updateCarriedPowerups,
  updateCurrentLevel,
} from '../../../backend/src/services/campaign-progress';

describe('Campaign Progress Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserState', () => {
    it('should return default state when no row exists', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getUserState(1);

      expect(result).toEqual({
        currentWorldId: null,
        currentLevelId: null,
        carriedPowerups: null,
        totalLevelsCompleted: 0,
        totalStars: 0,
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM campaign_user_state WHERE user_id = ?'),
        [1],
      );
    });

    it('should map row fields to CampaignUserState when row exists', async () => {
      mockQuery.mockResolvedValue([
        {
          user_id: 42,
          current_world_id: 2,
          current_level_id: 5,
          carried_powerups: null,
          total_levels_completed: 3,
          total_stars: 7,
        },
      ]);

      const result = await getUserState(42);

      expect(result).toEqual({
        currentWorldId: 2,
        currentLevelId: 5,
        carriedPowerups: null,
        totalLevelsCompleted: 3,
        totalStars: 7,
      });
    });

    it('should parse carried_powerups when it is a JSON string', async () => {
      const powerups = { bombUp: 2, fireUp: 1, shield: true };
      mockQuery.mockResolvedValue([
        {
          user_id: 10,
          current_world_id: 1,
          current_level_id: 3,
          carried_powerups: JSON.stringify(powerups),
          total_levels_completed: 1,
          total_stars: 2,
        },
      ]);

      const result = await getUserState(10);

      expect(result.carriedPowerups).toEqual(powerups);
    });

    it('should return carried_powerups as-is when it is already an object', async () => {
      const powerups = { speedUp: 3, kick: true };
      mockQuery.mockResolvedValue([
        {
          user_id: 10,
          current_world_id: null,
          current_level_id: null,
          carried_powerups: powerups,
          total_levels_completed: 0,
          total_stars: 0,
        },
      ]);

      const result = await getUserState(10);

      expect(result.carriedPowerups).toEqual(powerups);
    });

    it('should return null carriedPowerups when carried_powerups is empty string', async () => {
      mockQuery.mockResolvedValue([
        {
          user_id: 10,
          current_world_id: null,
          current_level_id: null,
          carried_powerups: '',
          total_levels_completed: 0,
          total_stars: 0,
        },
      ]);

      const result = await getUserState(10);

      // Empty string is falsy, so carriedPowerups should be null
      expect(result.carriedPowerups).toBeNull();
    });
  });

  describe('getProgress', () => {
    it('should return null when no progress row exists', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getProgress(1, 10);

      expect(result).toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM campaign_progress WHERE user_id = ? AND level_id = ?'),
        [1, 10],
      );
    });

    it('should map row fields to LevelProgress when row exists', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 1,
          user_id: 5,
          level_id: 12,
          completed: 1,
          best_time_seconds: 45,
          stars: 3,
          attempts: 7,
          completed_at: new Date('2025-01-01'),
          updated_at: new Date('2025-01-01'),
        },
      ]);

      const result = await getProgress(5, 12);

      expect(result).toEqual({
        levelId: 12,
        completed: true,
        bestTimeSeconds: 45,
        stars: 3,
        attempts: 7,
      });
    });

    it('should convert completed=0 to false', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 2,
          user_id: 5,
          level_id: 8,
          completed: 0,
          best_time_seconds: null,
          stars: 0,
          attempts: 3,
          completed_at: null,
          updated_at: new Date(),
        },
      ]);

      const result = await getProgress(5, 8);

      expect(result).not.toBeNull();
      expect(result!.completed).toBe(false);
      expect(result!.bestTimeSeconds).toBeNull();
    });

    it('should convert truthy completed value to true', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 3,
          user_id: 7,
          level_id: 1,
          completed: true,
          best_time_seconds: 30,
          stars: 2,
          attempts: 5,
          completed_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const result = await getProgress(7, 1);

      expect(result!.completed).toBe(true);
    });
  });

  describe('getAllProgress', () => {
    it('should return empty array when no progress rows exist', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getAllProgress(1);

      expect(result).toEqual([]);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM campaign_progress WHERE user_id = ?'),
        [1],
      );
    });

    it('should map all rows to LevelProgress objects', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 1,
          user_id: 3,
          level_id: 1,
          completed: 1,
          best_time_seconds: 20,
          stars: 3,
          attempts: 2,
          completed_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 2,
          user_id: 3,
          level_id: 2,
          completed: 0,
          best_time_seconds: null,
          stars: 0,
          attempts: 5,
          completed_at: null,
          updated_at: new Date(),
        },
        {
          id: 3,
          user_id: 3,
          level_id: 3,
          completed: 1,
          best_time_seconds: 60,
          stars: 1,
          attempts: 10,
          completed_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const result = await getAllProgress(3);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        levelId: 1,
        completed: true,
        bestTimeSeconds: 20,
        stars: 3,
        attempts: 2,
      });
      expect(result[1]).toEqual({
        levelId: 2,
        completed: false,
        bestTimeSeconds: null,
        stars: 0,
        attempts: 5,
      });
      expect(result[2]).toEqual({
        levelId: 3,
        completed: true,
        bestTimeSeconds: 60,
        stars: 1,
        attempts: 10,
      });
    });
  });

  describe('recordAttempt', () => {
    it('should execute INSERT ON DUPLICATE KEY UPDATE for attempts', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await recordAttempt(5, 12);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO campaign_progress'),
        [5, 12],
      );
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('ON DUPLICATE KEY UPDATE attempts = attempts + 1'),
        [5, 12],
      );
    });

    it('should pass correct userId and levelId parameters', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await recordAttempt(99, 42);

      const [, params] = mockExecute.mock.calls[0];
      expect(params).toEqual([99, 42]);
    });
  });

  describe('recordCompletion', () => {
    it('should award 3 stars when deaths is 0', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const stars = await recordCompletion(1, 10, 30, 0);

      expect(stars).toBe(3);
    });

    it('should award 2 stars when deaths > 0 but time is under par', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const stars = await recordCompletion(1, 10, 25, 2, 30);

      expect(stars).toBe(2);
    });

    it('should award 2 stars when deaths > 0 and time equals par exactly', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const stars = await recordCompletion(1, 10, 30, 1, 30);

      expect(stars).toBe(2);
    });

    it('should award 1 star when deaths > 0 and time exceeds par', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const stars = await recordCompletion(1, 10, 50, 3, 30);

      expect(stars).toBe(1);
    });

    it('should award 1 star when deaths > 0 and no par time is set', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const stars = await recordCompletion(1, 10, 30, 2);

      expect(stars).toBe(1);
    });

    it('should award 1 star when deaths > 0 and parTime is 0', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const stars = await recordCompletion(1, 10, 30, 5, 0);

      expect(stars).toBe(1);
    });

    it('should prioritize 3 stars (zero deaths) over par time eligibility', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      // Zero deaths AND under par — should still be 3 stars, not 2
      const stars = await recordCompletion(1, 10, 10, 0, 30);

      expect(stars).toBe(3);
    });

    it('should call execute twice: once for progress upsert, once for user state upsert', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await recordCompletion(5, 10, 40, 0);

      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it('should upsert progress with correct parameters', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await recordCompletion(5, 10, 40, 2, 60);

      // First call: progress upsert
      const [progressSql, progressParams] = mockExecute.mock.calls[0];
      expect(progressSql).toContain('INSERT INTO campaign_progress');
      expect(progressSql).toContain('ON DUPLICATE KEY UPDATE');
      expect(progressSql).toContain('completed = TRUE');
      expect(progressSql).toContain('GREATEST(stars');
      expect(progressParams).toEqual([5, 10, 40, 2]); // userId, levelId, timeSeconds, stars
    });

    it('should upsert user state totals with correct parameters', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await recordCompletion(5, 10, 40, 0); // 3 stars

      // Second call: user state upsert
      const [stateSql, stateParams] = mockExecute.mock.calls[1];
      expect(stateSql).toContain('INSERT INTO campaign_user_state');
      expect(stateSql).toContain('total_levels_completed');
      expect(stateSql).toContain('total_stars');
      expect(stateParams).toEqual([5, 3, 5, 5]); // userId, stars, userId, userId
    });

    it('should return the calculated star count', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const result1 = await recordCompletion(1, 1, 100, 0);
      expect(result1).toBe(3);

      const result2 = await recordCompletion(1, 2, 20, 1, 30);
      expect(result2).toBe(2);

      const result3 = await recordCompletion(1, 3, 50, 5);
      expect(result3).toBe(1);
    });
  });

  describe('updateCarriedPowerups', () => {
    it('should store JSON.stringify of powerups when non-null', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });
      const powerups = { bombUp: 2, fireUp: 1, shield: true };

      await updateCarriedPowerups(7, powerups);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO campaign_user_state'),
        [7, JSON.stringify(powerups)],
      );
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('ON DUPLICATE KEY UPDATE carried_powerups'),
        [7, JSON.stringify(powerups)],
      );
    });

    it('should store null when powerups is null', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateCarriedPowerups(7, null);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO campaign_user_state'),
        [7, null],
      );
    });

    it('should handle powerups with all fields populated', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });
      const powerups = {
        bombUp: 3,
        fireUp: 2,
        speedUp: 1,
        shield: true,
        kick: true,
        pierceBomb: true,
        remoteBomb: true,
        lineBomb: true,
      };

      await updateCarriedPowerups(1, powerups);

      const [, params] = mockExecute.mock.calls[0];
      expect(params[1]).toBe(JSON.stringify(powerups));
      // Verify round-trip parse
      expect(JSON.parse(params[1])).toEqual(powerups);
    });

    it('should handle powerups with only partial fields', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });
      const powerups = { speedUp: 2 };

      await updateCarriedPowerups(1, powerups);

      const [, params] = mockExecute.mock.calls[0];
      expect(JSON.parse(params[1])).toEqual({ speedUp: 2 });
    });
  });

  describe('updateCurrentLevel', () => {
    it('should upsert current world and level IDs', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateCurrentLevel(5, 2, 10);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO campaign_user_state'),
        [5, 2, 10],
      );
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('ON DUPLICATE KEY UPDATE current_world_id'),
        [5, 2, 10],
      );
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('current_level_id'),
        [5, 2, 10],
      );
    });

    it('should handle null worldId and levelId', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateCurrentLevel(5, null, null);

      const [, params] = mockExecute.mock.calls[0];
      expect(params).toEqual([5, null, null]);
    });

    it('should handle null worldId with non-null levelId', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateCurrentLevel(5, null, 3);

      const [, params] = mockExecute.mock.calls[0];
      expect(params).toEqual([5, null, 3]);
    });

    it('should pass correct userId', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateCurrentLevel(99, 1, 1);

      const [, params] = mockExecute.mock.calls[0];
      expect(params[0]).toBe(99);
    });
  });
});

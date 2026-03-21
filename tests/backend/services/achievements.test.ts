import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
}));

const mockUnlockCosmetic = jest.fn<AnyFn>();
const mockGetCosmeticById = jest.fn<AnyFn>();
const mockCheckCampaignStarUnlocks = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/cosmetics', () => ({
  unlockCosmetic: mockUnlockCosmetic,
  getCosmeticById: mockGetCosmeticById,
  checkCampaignStarUnlocks: mockCheckCampaignStarUnlocks,
}));

import {
  getAllAchievements,
  getAchievementById,
  createAchievement,
  updateAchievement,
  deleteAchievement,
  getUserAchievements,
  getUserAchievementsPublic,
  evaluateAfterGame,
  evaluateAfterCampaign,
} from '../../../backend/src/services/achievements';
import { GameAchievementData } from '@blast-arena/shared';

// --- Helper factories ---

function makeAchievementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'First Blood',
    description: 'Get your first kill',
    icon: '🏆',
    category: 'combat',
    condition_type: 'per_game',
    condition_config: JSON.stringify({ stat: 'kills', threshold: 1 }),
    reward_type: 'none',
    reward_id: null,
    is_active: true,
    sort_order: 0,
    created_at: new Date('2026-01-10T00:00:00Z'),
    updated_at: new Date('2026-01-10T00:00:00Z'),
    ...overrides,
  };
}

function makeUserAchievementRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 1,
    achievement_id: 10,
    unlocked_at: new Date('2026-02-01T12:00:00Z'),
    progress: null,
    updated_at: new Date('2026-02-01T12:00:00Z'),
    ...overrides,
  };
}

function makeGameData(overrides: Partial<GameAchievementData> = {}): GameAchievementData {
  return {
    userId: 1,
    gameMode: 'ffa',
    isWinner: false,
    kills: 0,
    deaths: 1,
    selfKills: 0,
    bombsPlaced: 5,
    powerupsCollected: 2,
    survivedSeconds: 60,
    placement: 3,
    playerCount: 4,
    ...overrides,
  };
}

function makeCosmetic(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    name: 'Gold Color',
    type: 'color',
    config: { hex: '#ffd700' },
    rarity: 'rare',
    unlockType: 'achievement',
    unlockRequirement: null,
    isActive: true,
    sortOrder: 0,
    ...overrides,
  };
}

describe('Achievements Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==================== getAllAchievements ====================

  describe('getAllAchievements', () => {
    it('should return all achievements when activeOnly is false', async () => {
      const row = makeAchievementRow();
      mockQuery.mockResolvedValue([row]);

      const result = await getAllAchievements();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        name: 'First Blood',
        description: 'Get your first kill',
        icon: '🏆',
        category: 'combat',
        conditionType: 'per_game',
        conditionConfig: { stat: 'kills', threshold: 1 },
        rewardType: 'none',
        rewardId: null,
        isActive: true,
        sortOrder: 0,
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.not.stringContaining('WHERE is_active = TRUE'),
      );
    });

    it('should filter active-only achievements when activeOnly is true', async () => {
      mockQuery.mockResolvedValue([]);

      await getAllAchievements(true);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE is_active = TRUE'),
      );
    });

    it('should parse condition_config JSON string into object', async () => {
      const config = { stat: 'total_wins', threshold: 50 };
      const row = makeAchievementRow({ condition_config: JSON.stringify(config) });
      mockQuery.mockResolvedValue([row]);

      const result = await getAllAchievements();

      expect(result[0].conditionConfig).toEqual(config);
    });

    it('should handle condition_config that is already an object', async () => {
      const config = { stat: 'total_kills', threshold: 100 };
      const row = makeAchievementRow({ condition_config: config });
      mockQuery.mockResolvedValue([row]);

      const result = await getAllAchievements();

      expect(result[0].conditionConfig).toEqual(config);
    });
  });

  // ==================== getAchievementById ====================

  describe('getAchievementById', () => {
    it('should return achievement when found', async () => {
      const row = makeAchievementRow({ id: 5 });
      mockQuery.mockResolvedValue([row]);

      const result = await getAchievementById(5);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(5);
      expect(result!.name).toBe('First Blood');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ?'),
        [5],
      );
    });

    it('should return null when not found', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getAchievementById(999);

      expect(result).toBeNull();
    });
  });

  // ==================== createAchievement ====================

  describe('createAchievement', () => {
    it('should insert and return the created achievement', async () => {
      const newRow = makeAchievementRow({ id: 10, name: 'Bomb Master' });
      mockExecute.mockResolvedValueOnce({ insertId: 10 });
      mockQuery.mockResolvedValueOnce([newRow]); // getAchievementById call

      const result = await createAchievement({
        name: 'Bomb Master',
        description: 'Place 100 bombs',
        conditionType: 'cumulative',
        conditionConfig: { stat: 'total_bombs', threshold: 100 },
      });

      expect(result.id).toBe(10);
      expect(result.name).toBe('Bomb Master');
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO achievements'),
        [
          'Bomb Master',
          'Place 100 bombs',
          '🏆',
          'general',
          'cumulative',
          JSON.stringify({ stat: 'total_bombs', threshold: 100 }),
          'none',
          null,
          0,
        ],
      );
    });

    it('should use provided optional values', async () => {
      const newRow = makeAchievementRow({ id: 11 });
      mockExecute.mockResolvedValueOnce({ insertId: 11 });
      mockQuery.mockResolvedValueOnce([newRow]);

      await createAchievement({
        name: 'Special',
        description: 'A special achievement',
        icon: '⭐',
        category: 'special',
        conditionType: 'per_game',
        conditionConfig: { stat: 'kills', threshold: 5 },
        rewardType: 'cosmetic',
        rewardId: 42,
        sortOrder: 10,
      });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO achievements'),
        [
          'Special',
          'A special achievement',
          '⭐',
          'special',
          'per_game',
          JSON.stringify({ stat: 'kills', threshold: 5 }),
          'cosmetic',
          42,
          10,
        ],
      );
    });
  });

  // ==================== updateAchievement ====================

  describe('updateAchievement', () => {
    it('should build SET clause for provided fields', async () => {
      mockExecute.mockResolvedValueOnce({});

      await updateAchievement(1, { name: 'Updated', description: 'New desc' });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE achievements SET'),
        ['Updated', 'New desc', 1],
      );
    });

    it('should handle conditionConfig by stringifying JSON', async () => {
      mockExecute.mockResolvedValueOnce({});

      await updateAchievement(2, { conditionConfig: { stat: 'kills', threshold: 10 } });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('condition_config = ?'),
        [JSON.stringify({ stat: 'kills', threshold: 10 }), 2],
      );
    });

    it('should not execute when no fields are provided', async () => {
      await updateAchievement(1, {});

      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should handle isActive and sortOrder fields', async () => {
      mockExecute.mockResolvedValueOnce({});

      await updateAchievement(3, { isActive: false, sortOrder: 5 });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('is_active = ?'),
        [false, 5, 3],
      );
    });
  });

  // ==================== deleteAchievement ====================

  describe('deleteAchievement', () => {
    it('should execute DELETE query with id', async () => {
      mockExecute.mockResolvedValueOnce({});

      await deleteAchievement(7);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM achievements WHERE id = ?'),
        [7],
      );
    });
  });

  // ==================== getUserAchievements ====================

  describe('getUserAchievements', () => {
    it('should map rows to UserAchievement objects', async () => {
      const row = makeUserAchievementRow({
        achievement_id: 10,
        unlocked_at: new Date('2026-02-01T12:00:00Z'),
        progress: JSON.stringify({ current: 5 }),
      });
      mockQuery.mockResolvedValue([row]);

      const result = await getUserAchievements(1);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        achievementId: 10,
        unlockedAt: '2026-02-01T12:00:00.000Z',
        progress: { current: 5 },
      });
    });

    it('should handle null unlocked_at and null progress', async () => {
      const row = makeUserAchievementRow({
        unlocked_at: null,
        progress: null,
      });
      mockQuery.mockResolvedValue([row]);

      const result = await getUserAchievements(1);

      expect(result[0].unlockedAt).toBeNull();
      expect(result[0].progress).toBeNull();
    });

    it('should handle progress that is already an object', async () => {
      const row = makeUserAchievementRow({
        progress: { current: 3, target: 10 },
      });
      mockQuery.mockResolvedValue([row]);

      const result = await getUserAchievements(1);

      expect(result[0].progress).toEqual({ current: 3, target: 10 });
    });
  });

  // ==================== getUserAchievementsPublic ====================

  describe('getUserAchievementsPublic', () => {
    it('should return joined achievement data', async () => {
      const row = {
        ...makeUserAchievementRow({ unlocked_at: new Date('2026-03-01T00:00:00Z') }),
        name: 'First Blood',
        description: 'Get your first kill',
        icon: '🏆',
        category: 'combat',
        condition_type: 'per_game',
        condition_config: JSON.stringify({ stat: 'kills', threshold: 1 }),
        reward_type: 'none',
        reward_id: null,
        is_active: true,
        sort_order: 0,
      };
      mockQuery.mockResolvedValue([row]);

      const result = await getUserAchievementsPublic(1);

      expect(result).toHaveLength(1);
      expect(result[0].unlockedAt).toBe('2026-03-01T00:00:00.000Z');
      expect(result[0].achievement.name).toBe('First Blood');
      expect(result[0].achievement.conditionType).toBe('per_game');
      expect(result[0].achievement.conditionConfig).toEqual({ stat: 'kills', threshold: 1 });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('JOIN achievements'),
        [1],
      );
    });
  });

  // ==================== evaluateAfterGame ====================

  describe('evaluateAfterGame', () => {
    describe('cumulative condition', () => {
      it('should unlock when cumulative stat meets threshold', async () => {
        const achRow = makeAchievementRow({
          id: 1,
          condition_type: 'cumulative',
          condition_config: JSON.stringify({ stat: 'total_kills', threshold: 50 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]); // achievements LEFT JOIN
        mockQuery.mockResolvedValueOnce([{ total_kills: 75, total_wins: 0, total_matches: 0, total_deaths: 0, total_bombs: 0, total_powerups: 0, total_playtime: 0, win_streak: 0, best_win_streak: 0 }]); // user_stats
        mockExecute.mockResolvedValueOnce({}); // INSERT user_achievements

        const result = await evaluateAfterGame(makeGameData({ userId: 1 }));

        expect(result.achievements).toHaveLength(1);
        expect(result.achievements[0].id).toBe(1);
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO user_achievements'),
          [1, 1],
        );
      });

      it('should not unlock when cumulative stat is below threshold', async () => {
        const achRow = makeAchievementRow({
          condition_type: 'cumulative',
          condition_config: JSON.stringify({ stat: 'total_kills', threshold: 100 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockQuery.mockResolvedValueOnce([{ total_kills: 50, total_wins: 0, total_matches: 0, total_deaths: 0, total_bombs: 0, total_powerups: 0, total_playtime: 0, win_streak: 0, best_win_streak: 0 }]);

        const result = await evaluateAfterGame(makeGameData());

        expect(result.achievements).toHaveLength(0);
        expect(mockExecute).not.toHaveBeenCalled();
      });

      it('should not unlock when user_stats row is missing', async () => {
        const achRow = makeAchievementRow({
          condition_type: 'cumulative',
          condition_config: JSON.stringify({ stat: 'total_wins', threshold: 1 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockQuery.mockResolvedValueOnce([]); // no user_stats row

        const result = await evaluateAfterGame(makeGameData());

        expect(result.achievements).toHaveLength(0);
      });
    });

    describe('per_game condition', () => {
      it('should unlock when game stat meets threshold with default >= operator', async () => {
        const achRow = makeAchievementRow({
          id: 2,
          condition_type: 'per_game',
          condition_config: JSON.stringify({ stat: 'kills', threshold: 3 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockExecute.mockResolvedValueOnce({});

        const result = await evaluateAfterGame(makeGameData({ kills: 5 }));

        expect(result.achievements).toHaveLength(1);
        expect(result.achievements[0].id).toBe(2);
      });

      it('should not unlock when game stat is below threshold', async () => {
        const achRow = makeAchievementRow({
          condition_type: 'per_game',
          condition_config: JSON.stringify({ stat: 'kills', threshold: 10 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);

        const result = await evaluateAfterGame(makeGameData({ kills: 3 }));

        expect(result.achievements).toHaveLength(0);
      });

      it('should support <= operator', async () => {
        const achRow = makeAchievementRow({
          id: 3,
          condition_type: 'per_game',
          condition_config: JSON.stringify({ stat: 'deaths', operator: '<=', threshold: 0 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockExecute.mockResolvedValueOnce({});

        const result = await evaluateAfterGame(makeGameData({ deaths: 0 }));

        expect(result.achievements).toHaveLength(1);
        expect(result.achievements[0].id).toBe(3);
      });

      it('should support == operator', async () => {
        const achRow = makeAchievementRow({
          id: 4,
          condition_type: 'per_game',
          condition_config: JSON.stringify({ stat: 'placement', operator: '==', threshold: 1 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockExecute.mockResolvedValueOnce({});

        const result = await evaluateAfterGame(makeGameData({ placement: 1 }));

        expect(result.achievements).toHaveLength(1);
      });

      it('should fail == operator when value does not match', async () => {
        const achRow = makeAchievementRow({
          condition_type: 'per_game',
          condition_config: JSON.stringify({ stat: 'placement', operator: '==', threshold: 1 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);

        const result = await evaluateAfterGame(makeGameData({ placement: 2 }));

        expect(result.achievements).toHaveLength(0);
      });

      it('should support > operator', async () => {
        const achRow = makeAchievementRow({
          id: 5,
          condition_type: 'per_game',
          condition_config: JSON.stringify({ stat: 'bombs_placed', operator: '>', threshold: 10 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockExecute.mockResolvedValueOnce({});

        const result = await evaluateAfterGame(makeGameData({ bombsPlaced: 15 }));

        expect(result.achievements).toHaveLength(1);
      });

      it('should support < operator', async () => {
        const achRow = makeAchievementRow({
          id: 6,
          condition_type: 'per_game',
          condition_config: JSON.stringify({ stat: 'survived_seconds', operator: '<', threshold: 10 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockExecute.mockResolvedValueOnce({});

        const result = await evaluateAfterGame(makeGameData({ survivedSeconds: 5 }));

        expect(result.achievements).toHaveLength(1);
      });

      it('should handle is_winner boolean mapped to 1/0', async () => {
        const achRow = makeAchievementRow({
          id: 7,
          condition_type: 'per_game',
          condition_config: JSON.stringify({ stat: 'is_winner', operator: '==', threshold: 1 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockExecute.mockResolvedValueOnce({});

        const result = await evaluateAfterGame(makeGameData({ isWinner: true }));

        expect(result.achievements).toHaveLength(1);
      });
    });

    describe('mode_specific condition', () => {
      it('should unlock when mode matches and stat meets threshold', async () => {
        const achRow = makeAchievementRow({
          id: 8,
          condition_type: 'mode_specific',
          condition_config: JSON.stringify({ mode: 'ffa', stat: 'wins', threshold: 5 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]); // achievements LEFT JOIN
        mockQuery.mockResolvedValueOnce([{ total: 7 }]); // match_players COUNT
        mockExecute.mockResolvedValueOnce({}); // INSERT

        const result = await evaluateAfterGame(makeGameData({ gameMode: 'ffa' }));

        expect(result.achievements).toHaveLength(1);
        expect(result.achievements[0].id).toBe(8);
        expect(mockQuery).toHaveBeenCalledTimes(2);
      });

      it('should not evaluate when game mode does not match', async () => {
        const achRow = makeAchievementRow({
          condition_type: 'mode_specific',
          condition_config: JSON.stringify({ mode: 'teams', stat: 'wins', threshold: 1 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);

        const result = await evaluateAfterGame(makeGameData({ gameMode: 'ffa' }));

        expect(result.achievements).toHaveLength(0);
        // Only 1 query (the achievements fetch), no mode_specific query
        expect(mockQuery).toHaveBeenCalledTimes(1);
      });

      it('should check matches stat for mode_specific', async () => {
        const achRow = makeAchievementRow({
          id: 9,
          condition_type: 'mode_specific',
          condition_config: JSON.stringify({ mode: 'battle_royale', stat: 'matches', threshold: 10 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockQuery.mockResolvedValueOnce([{ total: 15 }]);
        mockExecute.mockResolvedValueOnce({});

        const result = await evaluateAfterGame(makeGameData({ gameMode: 'battle_royale' }));

        expect(result.achievements).toHaveLength(1);
        expect(mockQuery.mock.calls[1][0]).toContain('game_mode');
      });

      it('should check kills stat for mode_specific', async () => {
        const achRow = makeAchievementRow({
          id: 10,
          condition_type: 'mode_specific',
          condition_config: JSON.stringify({ mode: 'deathmatch', stat: 'kills', threshold: 50 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockQuery.mockResolvedValueOnce([{ total: 60 }]);
        mockExecute.mockResolvedValueOnce({});

        const result = await evaluateAfterGame(makeGameData({ gameMode: 'deathmatch' }));

        expect(result.achievements).toHaveLength(1);
        expect(mockQuery.mock.calls[1][0]).toContain('SUM(mp.kills)');
      });

      it('should not unlock when mode_specific stat is below threshold', async () => {
        const achRow = makeAchievementRow({
          condition_type: 'mode_specific',
          condition_config: JSON.stringify({ mode: 'ffa', stat: 'wins', threshold: 10 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockQuery.mockResolvedValueOnce([{ total: 3 }]);

        const result = await evaluateAfterGame(makeGameData({ gameMode: 'ffa' }));

        expect(result.achievements).toHaveLength(0);
        expect(mockExecute).not.toHaveBeenCalled();
      });
    });

    describe('reward unlock', () => {
      it('should call unlockCosmetic and getCosmeticById when reward_type is cosmetic', async () => {
        const cosmetic = makeCosmetic();
        const achRow = makeAchievementRow({
          id: 20,
          condition_type: 'per_game',
          condition_config: JSON.stringify({ stat: 'kills', threshold: 1 }),
          reward_type: 'cosmetic',
          reward_id: 100,
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockExecute.mockResolvedValueOnce({}); // INSERT user_achievements
        mockUnlockCosmetic.mockResolvedValueOnce(undefined);
        mockGetCosmeticById.mockResolvedValueOnce(cosmetic);

        const result = await evaluateAfterGame(makeGameData({ kills: 5 }));

        expect(result.achievements).toHaveLength(1);
        expect(result.rewards).toHaveLength(1);
        expect(result.rewards[0]).toEqual(cosmetic);
        expect(mockUnlockCosmetic).toHaveBeenCalledWith(1, 100);
        expect(mockGetCosmeticById).toHaveBeenCalledWith(100);
      });

      it('should not include reward when cosmetic is not found', async () => {
        const achRow = makeAchievementRow({
          id: 21,
          condition_type: 'per_game',
          condition_config: JSON.stringify({ stat: 'kills', threshold: 1 }),
          reward_type: 'cosmetic',
          reward_id: 999,
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockExecute.mockResolvedValueOnce({});
        mockUnlockCosmetic.mockResolvedValueOnce(undefined);
        mockGetCosmeticById.mockResolvedValueOnce(null);

        const result = await evaluateAfterGame(makeGameData({ kills: 5 }));

        expect(result.achievements).toHaveLength(1);
        expect(result.rewards).toHaveLength(0);
        expect(mockUnlockCosmetic).toHaveBeenCalledWith(1, 999);
      });

      it('should not call unlockCosmetic when reward_type is none', async () => {
        const achRow = makeAchievementRow({
          id: 22,
          condition_type: 'per_game',
          condition_config: JSON.stringify({ stat: 'kills', threshold: 1 }),
          reward_type: 'none',
          reward_id: null,
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockExecute.mockResolvedValueOnce({});

        const result = await evaluateAfterGame(makeGameData({ kills: 5 }));

        expect(result.achievements).toHaveLength(1);
        expect(result.rewards).toHaveLength(0);
        expect(mockUnlockCosmetic).not.toHaveBeenCalled();
      });
    });

    describe('no unlocks', () => {
      it('should return empty arrays when no achievements are available', async () => {
        mockQuery.mockResolvedValueOnce([]); // no achievements

        const result = await evaluateAfterGame(makeGameData());

        expect(result.achievements).toHaveLength(0);
        expect(result.rewards).toHaveLength(0);
        expect(mockExecute).not.toHaveBeenCalled();
      });

      it('should return empty arrays when no conditions are met', async () => {
        const achRow = makeAchievementRow({
          condition_type: 'per_game',
          condition_config: JSON.stringify({ stat: 'kills', threshold: 100 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);

        const result = await evaluateAfterGame(makeGameData({ kills: 0 }));

        expect(result.achievements).toHaveLength(0);
        expect(result.rewards).toHaveLength(0);
        expect(mockExecute).not.toHaveBeenCalled();
      });
    });

    describe('multiple achievements', () => {
      it('should evaluate and unlock multiple matching achievements', async () => {
        const ach1 = makeAchievementRow({
          id: 30,
          condition_type: 'per_game',
          condition_config: JSON.stringify({ stat: 'kills', threshold: 1 }),
        });
        const ach2 = makeAchievementRow({
          id: 31,
          name: 'Survivor',
          condition_type: 'per_game',
          condition_config: JSON.stringify({ stat: 'survived_seconds', threshold: 30 }),
        });
        const ach3 = makeAchievementRow({
          id: 32,
          name: 'Hard to get',
          condition_type: 'per_game',
          condition_config: JSON.stringify({ stat: 'kills', threshold: 50 }),
        });
        mockQuery.mockResolvedValueOnce([ach1, ach2, ach3]);
        mockExecute.mockResolvedValueOnce({}); // ach1 INSERT
        mockExecute.mockResolvedValueOnce({}); // ach2 INSERT

        const result = await evaluateAfterGame(makeGameData({ kills: 5, survivedSeconds: 60 }));

        expect(result.achievements).toHaveLength(2);
        expect(result.achievements.map((a) => a.id)).toEqual([30, 31]);
        expect(mockExecute).toHaveBeenCalledTimes(2);
      });
    });
  });

  // ==================== evaluateAfterCampaign ====================

  describe('evaluateAfterCampaign', () => {
    describe('total_stars condition', () => {
      it('should unlock when total stars meet threshold', async () => {
        const achRow = makeAchievementRow({
          id: 40,
          condition_type: 'campaign',
          condition_config: JSON.stringify({ subType: 'total_stars', threshold: 10 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]); // campaign achievements
        mockQuery.mockResolvedValueOnce([{ total_stars: 15 }]); // campaign_user_state
        mockExecute.mockResolvedValueOnce({}); // INSERT
        mockCheckCampaignStarUnlocks.mockResolvedValueOnce([]);

        const result = await evaluateAfterCampaign(1, 15, 5, 2);

        expect(result.achievements).toHaveLength(1);
        expect(result.achievements[0].id).toBe(40);
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO user_achievements'),
          [1, 40],
        );
      });

      it('should not unlock when total stars are below threshold', async () => {
        const achRow = makeAchievementRow({
          id: 41,
          condition_type: 'campaign',
          condition_config: JSON.stringify({ subType: 'total_stars', threshold: 50 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockQuery.mockResolvedValueOnce([{ total_stars: 10 }]);
        mockCheckCampaignStarUnlocks.mockResolvedValueOnce([]);

        const result = await evaluateAfterCampaign(1, 10, 5, 2);

        expect(result.achievements).toHaveLength(0);
      });

      it('should handle missing campaign_user_state row', async () => {
        const achRow = makeAchievementRow({
          condition_type: 'campaign',
          condition_config: JSON.stringify({ subType: 'total_stars', threshold: 1 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockQuery.mockResolvedValueOnce([]); // no user state
        mockCheckCampaignStarUnlocks.mockResolvedValueOnce([]);

        const result = await evaluateAfterCampaign(1, 0, 5, 2);

        expect(result.achievements).toHaveLength(0);
      });
    });

    describe('world_complete condition', () => {
      it('should unlock when all published levels in world are completed', async () => {
        const achRow = makeAchievementRow({
          id: 42,
          condition_type: 'campaign',
          condition_config: JSON.stringify({ subType: 'world_complete', worldId: 3 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]); // campaign achievements
        mockQuery.mockResolvedValueOnce([{ total: 5 }]); // total published levels
        mockQuery.mockResolvedValueOnce([{ total: 5 }]); // completed levels
        mockExecute.mockResolvedValueOnce({}); // INSERT
        mockCheckCampaignStarUnlocks.mockResolvedValueOnce([]);

        const result = await evaluateAfterCampaign(1, 20, 10, 3);

        expect(result.achievements).toHaveLength(1);
        expect(result.achievements[0].id).toBe(42);
      });

      it('should not unlock when some levels are incomplete', async () => {
        const achRow = makeAchievementRow({
          condition_type: 'campaign',
          condition_config: JSON.stringify({ subType: 'world_complete', worldId: 3 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockQuery.mockResolvedValueOnce([{ total: 5 }]); // 5 published
        mockQuery.mockResolvedValueOnce([{ total: 3 }]); // only 3 completed
        mockCheckCampaignStarUnlocks.mockResolvedValueOnce([]);

        const result = await evaluateAfterCampaign(1, 20, 10, 3);

        expect(result.achievements).toHaveLength(0);
      });

      it('should not unlock when world has no published levels', async () => {
        const achRow = makeAchievementRow({
          condition_type: 'campaign',
          condition_config: JSON.stringify({ subType: 'world_complete', worldId: 99 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockQuery.mockResolvedValueOnce([{ total: 0 }]); // no levels
        mockQuery.mockResolvedValueOnce([{ total: 0 }]);
        mockCheckCampaignStarUnlocks.mockResolvedValueOnce([]);

        const result = await evaluateAfterCampaign(1, 0, 10, 99);

        expect(result.achievements).toHaveLength(0);
      });
    });

    describe('levels_completed condition', () => {
      it('should unlock when total levels completed meets threshold', async () => {
        const achRow = makeAchievementRow({
          id: 45,
          condition_type: 'campaign',
          condition_config: JSON.stringify({ subType: 'levels_completed', threshold: 5 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockQuery.mockResolvedValueOnce([{ total_levels_completed: 8 }]);
        mockExecute.mockResolvedValueOnce({});
        mockCheckCampaignStarUnlocks.mockResolvedValueOnce([]);

        const result = await evaluateAfterCampaign(1, 10, 5, 2);

        expect(result.achievements).toHaveLength(1);
        expect(result.achievements[0].id).toBe(45);
      });
    });

    describe('checkCampaignStarUnlocks', () => {
      it('should call checkCampaignStarUnlocks with userId and totalStars', async () => {
        mockQuery.mockResolvedValueOnce([]); // no achievements
        mockCheckCampaignStarUnlocks.mockResolvedValueOnce([]);

        await evaluateAfterCampaign(7, 25, 5, 2);

        expect(mockCheckCampaignStarUnlocks).toHaveBeenCalledWith(7, 25);
      });

      it('should call checkCampaignStarUnlocks even when achievements are unlocked', async () => {
        const achRow = makeAchievementRow({
          id: 50,
          condition_type: 'campaign',
          condition_config: JSON.stringify({ subType: 'total_stars', threshold: 1 }),
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockQuery.mockResolvedValueOnce([{ total_stars: 10 }]);
        mockExecute.mockResolvedValueOnce({});
        mockCheckCampaignStarUnlocks.mockResolvedValueOnce([]);

        await evaluateAfterCampaign(1, 10, 5, 2);

        expect(mockCheckCampaignStarUnlocks).toHaveBeenCalledWith(1, 10);
      });
    });

    describe('campaign reward unlock', () => {
      it('should call unlockCosmetic for campaign achievements with cosmetic rewards', async () => {
        const cosmetic = makeCosmetic({ id: 200 });
        const achRow = makeAchievementRow({
          id: 55,
          condition_type: 'campaign',
          condition_config: JSON.stringify({ subType: 'total_stars', threshold: 5 }),
          reward_type: 'cosmetic',
          reward_id: 200,
        });
        mockQuery.mockResolvedValueOnce([achRow]);
        mockQuery.mockResolvedValueOnce([{ total_stars: 10 }]);
        mockExecute.mockResolvedValueOnce({});
        mockUnlockCosmetic.mockResolvedValueOnce(undefined);
        mockGetCosmeticById.mockResolvedValueOnce(cosmetic);
        mockCheckCampaignStarUnlocks.mockResolvedValueOnce([]);

        const result = await evaluateAfterCampaign(1, 10, 5, 2);

        expect(result.achievements).toHaveLength(1);
        expect(result.rewards).toHaveLength(1);
        expect(result.rewards[0].id).toBe(200);
        expect(mockUnlockCosmetic).toHaveBeenCalledWith(1, 200);
      });
    });
  });
});

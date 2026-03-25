import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
}));

const mockGetSetting = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/settings', () => ({
  getSetting: mockGetSetting,
}));

const mockGetActiveSeason = jest.fn<AnyFn>();
const mockGetSeasonById = jest.fn<AnyFn>();
const mockGetUserSeasonHistory = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/season', () => ({
  getActiveSeason: mockGetActiveSeason,
  getSeasonById: mockGetSeasonById,
  getUserSeasonHistory: mockGetUserSeasonHistory,
}));

const mockGetEquippedCosmetics = jest.fn<AnyFn>();
const mockGetPlayerCosmeticsForGame = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/cosmetics', () => ({
  getEquippedCosmetics: mockGetEquippedCosmetics,
  getPlayerCosmeticsForGame: mockGetPlayerCosmeticsForGame,
}));

const mockGetUserAchievementsPublic = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/achievements', () => ({
  getUserAchievementsPublic: mockGetUserAchievementsPublic,
}));

import {
  getRankForElo,
  getRankConfig,
  getLeaderboard,
  getPublicProfile,
  getUserRank,
} from '../../../backend/src/services/leaderboard';
import { DEFAULT_RANK_CONFIG, RankConfig } from '@blast-arena/shared';

describe('Leaderboard Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActiveSeason.mockResolvedValue(null);
    mockGetSeasonById.mockResolvedValue(null);
    mockGetUserSeasonHistory.mockResolvedValue([]);
    mockGetUserAchievementsPublic.mockResolvedValue([]);
    mockGetEquippedCosmetics.mockResolvedValue({});
    mockGetPlayerCosmeticsForGame.mockResolvedValue(new Map());
    mockGetSetting.mockResolvedValue(null);
  });

  // ── getRankForElo ───────────────────────────────────────────────────

  describe('getRankForElo', () => {
    it('should return Bronze III for elo 0 with sub-tiers', () => {
      const result = getRankForElo(0, DEFAULT_RANK_CONFIG);
      expect(result).toEqual({ name: 'Bronze III', color: '#cd7f32' });
    });

    it('should return Bronze II for mid-range Bronze elo', () => {
      // Bronze: 0-999, range=1000, thirdSize=ceil(1000/3)=334
      // posInTier=400 >= 334 => II
      const result = getRankForElo(400, DEFAULT_RANK_CONFIG);
      expect(result).toEqual({ name: 'Bronze II', color: '#cd7f32' });
    });

    it('should return Bronze I for top-range Bronze elo', () => {
      // thirdSize=334, posInTier=999 >= 334*2=668 => I
      const result = getRankForElo(999, DEFAULT_RANK_CONFIG);
      expect(result).toEqual({ name: 'Bronze I', color: '#cd7f32' });
    });

    it('should return Silver III for elo 1000', () => {
      const result = getRankForElo(1000, DEFAULT_RANK_CONFIG);
      expect(result).toEqual({ name: 'Silver III', color: '#c0c0c0' });
    });

    it('should return Gold for elo 1200', () => {
      const result = getRankForElo(1200, DEFAULT_RANK_CONFIG);
      expect(result.name).toContain('Gold');
      expect(result.color).toBe('#ffd700');
    });

    it('should return Platinum for elo 1400', () => {
      const result = getRankForElo(1400, DEFAULT_RANK_CONFIG);
      expect(result.name).toContain('Platinum');
      expect(result.color).toBe('#00d4aa');
    });

    it('should return Diamond for elo 1600', () => {
      const result = getRankForElo(1600, DEFAULT_RANK_CONFIG);
      expect(result.name).toContain('Diamond');
      expect(result.color).toBe('#448aff');
    });

    it('should return Champion for elo 1800', () => {
      const result = getRankForElo(1800, DEFAULT_RANK_CONFIG);
      expect(result.name).toContain('Champion');
      expect(result.color).toBe('#ff3355');
    });

    it('should return Champion I for very high elo', () => {
      // Champion: 1800-99999, range=98200, thirdSize=ceil(98200/3)=32734
      // posInTier=98199 >= 32734*2=65468 => I
      const result = getRankForElo(99999, DEFAULT_RANK_CONFIG);
      expect(result).toEqual({ name: 'Champion I', color: '#ff3355' });
    });

    it('should not append sub-tier suffix when subTiersEnabled is false', () => {
      const config: RankConfig = {
        tiers: DEFAULT_RANK_CONFIG.tiers,
        subTiersEnabled: false,
      };

      const result = getRankForElo(500, config);
      expect(result).toEqual({ name: 'Bronze', color: '#cd7f32' });
    });

    it('should return tier name without I/II/III suffix when sub-tiers disabled', () => {
      const config: RankConfig = {
        tiers: DEFAULT_RANK_CONFIG.tiers,
        subTiersEnabled: false,
      };

      const result = getRankForElo(1500, config);
      expect(result).toEqual({ name: 'Platinum', color: '#00d4aa' });
    });

    it('should fallback to lowest tier when elo does not match any range', () => {
      const config: RankConfig = {
        tiers: [
          { name: 'Low', minElo: 100, maxElo: 200, color: '#aaa' },
          { name: 'High', minElo: 300, maxElo: 400, color: '#bbb' },
        ],
        subTiersEnabled: false,
      };

      // elo 50 does not match any tier
      const result = getRankForElo(50, config);
      expect(result).toEqual({ name: 'Low', color: '#aaa' });
    });

    it('should fallback to lowest tier for negative elo', () => {
      const result = getRankForElo(-100, DEFAULT_RANK_CONFIG);
      expect(result).toEqual({ name: 'Bronze', color: '#cd7f32' });
    });

    it('should handle single-tier config', () => {
      const config: RankConfig = {
        tiers: [{ name: 'Everyone', minElo: 0, maxElo: 99999, color: '#fff' }],
        subTiersEnabled: false,
      };

      const result = getRankForElo(1500, config);
      expect(result).toEqual({ name: 'Everyone', color: '#fff' });
    });
  });

  // ── getRankConfig ─────────────────────────────────────────────────

  describe('getRankConfig', () => {
    it('should return parsed JSON from settings when valid', async () => {
      const customConfig: RankConfig = {
        tiers: [{ name: 'Custom', minElo: 0, maxElo: 5000, color: '#123456' }],
        subTiersEnabled: false,
      };
      mockGetSetting.mockResolvedValue(JSON.stringify(customConfig));

      const result = await getRankConfig();

      expect(result).toEqual(customConfig);
      expect(mockGetSetting).toHaveBeenCalledWith('rank_tiers');
    });

    it('should return DEFAULT_RANK_CONFIG when setting is null', async () => {
      mockGetSetting.mockResolvedValue(null);

      const result = await getRankConfig();

      expect(result).toEqual(DEFAULT_RANK_CONFIG);
    });

    it('should return DEFAULT_RANK_CONFIG on invalid JSON', async () => {
      mockGetSetting.mockResolvedValue('{not valid json!!!');

      const result = await getRankConfig();

      expect(result).toEqual(DEFAULT_RANK_CONFIG);
    });

    it('should return DEFAULT_RANK_CONFIG when setting is empty string', async () => {
      mockGetSetting.mockResolvedValue('');

      const result = await getRankConfig();

      expect(result).toEqual(DEFAULT_RANK_CONFIG);
    });
  });

  // ── getLeaderboard ────────────────────────────────────────────────

  describe('getLeaderboard', () => {
    const leaderboardRow = (overrides: Record<string, unknown> = {}) => ({
      user_id: 1,
      username: 'player1',
      elo_rating: 1500,
      peak_elo: 1600,
      matches_played: 50,
      total_wins: 30,
      total_kills: 100,
      total_xp: 0,
      level: 1,
      ...overrides,
    });

    it('should return paginated entries with default page and limit', async () => {
      mockGetSetting.mockResolvedValue(null); // uses DEFAULT_RANK_CONFIG

      const rows = [
        leaderboardRow(),
        leaderboardRow({ user_id: 2, username: 'player2', elo_rating: 1400 }),
      ];
      mockQuery
        .mockResolvedValueOnce(rows) // data rows
        .mockResolvedValueOnce([{ total: 2 }]); // count

      const result = await getLeaderboard({});

      expect(result.page).toBe(1);
      expect(result.limit).toBe(25);
      expect(result.total).toBe(2);
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].rank).toBe(1);
      expect(result.entries[0].userId).toBe(1);
      expect(result.entries[0].username).toBe('player1');
      expect(result.entries[0].eloRating).toBe(1500);
      expect(result.entries[0].rankTier).toContain('Platinum');
      expect(result.entries[1].rank).toBe(2);
    });

    it('should respect page and limit parameters', async () => {
      mockGetSetting.mockResolvedValue(null);

      const row = leaderboardRow({ user_id: 3, username: 'player3' });
      mockQuery.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ total: 15 }]);

      const result = await getLeaderboard({ page: 2, limit: 5 });

      expect(result.page).toBe(2);
      expect(result.limit).toBe(5);
      expect(result.total).toBe(15);
      expect(result.entries[0].rank).toBe(6); // offset=(2-1)*5=5, rank=5+0+1=6
    });

    it('should cap limit to 100', async () => {
      mockGetSetting.mockResolvedValue(null);

      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);

      const result = await getLeaderboard({ limit: 999 });

      expect(result.limit).toBe(100);
    });

    it('should query season_elo when seasonId is provided', async () => {
      mockGetSetting.mockResolvedValue(null);
      const season = {
        id: 5,
        name: 'Season 5',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        isActive: false,
      };
      mockGetSeasonById.mockResolvedValue(season);

      mockQuery.mockResolvedValueOnce([leaderboardRow()]).mockResolvedValueOnce([{ total: 1 }]);

      const result = await getLeaderboard({ seasonId: 5 });

      expect(mockGetSeasonById).toHaveBeenCalledWith(5);
      expect(result.season).toEqual(season);
      expect(result.entries).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM season_elo se'),
        [5, 25, 0],
      );
    });

    it('should use active season when no seasonId is given and active season exists', async () => {
      mockGetSetting.mockResolvedValue(null);
      const activeSeason = {
        id: 3,
        name: 'Season 3',
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        isActive: true,
      };
      mockGetActiveSeason.mockResolvedValue(activeSeason);

      mockQuery.mockResolvedValueOnce([leaderboardRow()]).mockResolvedValueOnce([{ total: 1 }]);

      const result = await getLeaderboard({});

      expect(result.season).toEqual(activeSeason);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM season_elo se'),
        [3, 25, 0],
      );
    });

    it('should use user_stats when no seasonId and no active season', async () => {
      mockGetSetting.mockResolvedValue(null);
      mockGetActiveSeason.mockResolvedValue(null);

      mockQuery.mockResolvedValueOnce([leaderboardRow()]).mockResolvedValueOnce([{ total: 1 }]);

      const result = await getLeaderboard({});

      expect(result.season).toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM user_stats us'),
        [25, 0],
      );
    });

    it('should return empty entries when no rows match', async () => {
      mockGetSetting.mockResolvedValue(null);

      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);

      const result = await getLeaderboard({});

      expect(result.entries).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should assign rank tier and color to each entry', async () => {
      mockGetSetting.mockResolvedValue(null);

      mockQuery
        .mockResolvedValueOnce([
          leaderboardRow({ elo_rating: 1800 }),
          leaderboardRow({ user_id: 2, username: 'p2', elo_rating: 500 }),
        ])
        .mockResolvedValueOnce([{ total: 2 }]);

      const result = await getLeaderboard({});

      expect(result.entries[0].rankTier).toContain('Champion');
      expect(result.entries[0].rankColor).toBe('#ff3355');
      expect(result.entries[1].rankTier).toContain('Bronze');
      expect(result.entries[1].rankColor).toBe('#cd7f32');
    });
  });

  // ── getPublicProfile ──────────────────────────────────────────────

  describe('getPublicProfile', () => {
    const profileRow = (overrides: Record<string, unknown> = {}) => ({
      id: 42,
      username: 'testuser',
      role: 'user',
      created_at: new Date('2025-06-15T10:00:00Z'),
      is_profile_public: true,
      total_matches: 100,
      total_wins: 55,
      total_kills: 250,
      total_deaths: 80,
      elo_rating: 1350,
      peak_elo: 1500,
      win_streak: 3,
      best_win_streak: 8,
      total_xp: 0,
      level: 1,
      ...overrides,
    });

    it('should return full profile for a public user', async () => {
      mockQuery.mockResolvedValueOnce([profileRow()]);
      mockGetSetting.mockResolvedValue(null);
      mockGetUserSeasonHistory.mockResolvedValue([
        { seasonId: 1, seasonName: 'Season 1', finalElo: 1300, peakElo: 1400, matchesPlayed: 20 },
      ]);
      mockGetUserAchievementsPublic.mockResolvedValue([{ id: 1, name: 'First Win' }]);
      mockGetEquippedCosmetics.mockResolvedValue({ trail: 'fire' });

      const result = await getPublicProfile(42);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(42);
      expect(result!.username).toBe('testuser');
      expect(result!.role).toBe('user');
      expect(result!.createdAt).toBe('2025-06-15T10:00:00.000Z');
      expect(result!.stats).toEqual({
        totalMatches: 100,
        totalWins: 55,
        totalKills: 250,
        totalDeaths: 80,
        eloRating: 1350,
        peakElo: 1500,
        winStreak: 3,
        bestWinStreak: 8,
        level: 1,
        totalXp: 0,
      });
      expect(result!.rankTier).toContain('Gold');
      expect(result!.rankColor).toBe('#ffd700');
      expect(result!.seasonHistory).toEqual([
        { seasonId: 1, seasonName: 'Season 1', finalElo: 1300, peakElo: 1400, matchesPlayed: 20 },
      ]);
      expect(result!.achievements).toEqual([{ id: 1, name: 'First Win' }]);
      expect(result!.equippedCosmetics).toEqual({ trail: 'fire' });
    });

    it('should return null when user is not found (deactivated or nonexistent)', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getPublicProfile(999);

      expect(result).toBeNull();
    });

    it('should return null when user profile is private', async () => {
      mockQuery.mockResolvedValueOnce([profileRow({ is_profile_public: false })]);

      const result = await getPublicProfile(42);

      expect(result).toBeNull();
    });

    it('should query with the correct user id', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await getPublicProfile(77);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE u.id = ? AND u.is_deactivated = 0'),
        [77],
      );
    });

    it('should call dependent services with the user id', async () => {
      mockQuery.mockResolvedValueOnce([profileRow()]);
      mockGetSetting.mockResolvedValue(null);

      await getPublicProfile(42);

      expect(mockGetUserSeasonHistory).toHaveBeenCalledWith(42);
      expect(mockGetUserAchievementsPublic).toHaveBeenCalledWith(42);
      expect(mockGetEquippedCosmetics).toHaveBeenCalledWith(42);
    });

    it('should not call dependent services when user is not found', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await getPublicProfile(1);

      expect(mockGetUserSeasonHistory).not.toHaveBeenCalled();
      expect(mockGetUserAchievementsPublic).not.toHaveBeenCalled();
      expect(mockGetEquippedCosmetics).not.toHaveBeenCalled();
    });

    it('should not call dependent services when profile is private', async () => {
      mockQuery.mockResolvedValueOnce([profileRow({ is_profile_public: false })]);

      await getPublicProfile(42);

      expect(mockGetUserSeasonHistory).not.toHaveBeenCalled();
      expect(mockGetUserAchievementsPublic).not.toHaveBeenCalled();
      expect(mockGetEquippedCosmetics).not.toHaveBeenCalled();
    });

    it('should return empty season history when user has none', async () => {
      mockQuery.mockResolvedValueOnce([profileRow()]);
      mockGetSetting.mockResolvedValue(null);
      mockGetUserSeasonHistory.mockResolvedValue([]);

      const result = await getPublicProfile(42);

      expect(result!.seasonHistory).toEqual([]);
    });
  });

  // ── getUserRank ───────────────────────────────────────────────────

  describe('getUserRank', () => {
    it('should return rank info from user_stats', async () => {
      mockQuery.mockResolvedValueOnce([{ elo_rating: 1500, peak_elo: 1650 }]);
      mockGetSetting.mockResolvedValue(null);
      mockGetActiveSeason.mockResolvedValue(null);

      const result = await getUserRank(1);

      expect(result.eloRating).toBe(1500);
      expect(result.peakElo).toBe(1650);
      expect(result.rankTier).toContain('Platinum');
      expect(result.rankColor).toBe('#00d4aa');
      expect(result.seasonElo).toBeNull();
    });

    it('should default to elo 1000 when no user_stats row exists', async () => {
      mockQuery.mockResolvedValueOnce([]); // no user_stats
      mockGetSetting.mockResolvedValue(null);
      mockGetActiveSeason.mockResolvedValue(null);

      const result = await getUserRank(1);

      expect(result.eloRating).toBe(1000);
      expect(result.peakElo).toBe(1000);
      expect(result.rankTier).toContain('Silver');
      expect(result.rankColor).toBe('#c0c0c0');
      expect(result.seasonElo).toBeNull();
    });

    it('should include seasonElo when active season exists and user has season elo', async () => {
      mockQuery
        .mockResolvedValueOnce([{ elo_rating: 1400, peak_elo: 1500 }]) // user_stats
        .mockResolvedValueOnce([{ elo_rating: 1350 }]); // season_elo
      mockGetSetting.mockResolvedValue(null);
      mockGetActiveSeason.mockResolvedValue({
        id: 2,
        name: 'Season 2',
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        isActive: true,
      });

      const result = await getUserRank(10);

      expect(result.eloRating).toBe(1400);
      expect(result.seasonElo).toBe(1350);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM season_elo WHERE user_id = ? AND season_id = ?'),
        [10, 2],
      );
    });

    it('should return seasonElo null when active season exists but user has no season elo', async () => {
      mockQuery
        .mockResolvedValueOnce([{ elo_rating: 1200, peak_elo: 1300 }]) // user_stats
        .mockResolvedValueOnce([]); // no season_elo
      mockGetSetting.mockResolvedValue(null);
      mockGetActiveSeason.mockResolvedValue({
        id: 1,
        name: 'Season 1',
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        isActive: true,
      });

      const result = await getUserRank(10);

      expect(result.eloRating).toBe(1200);
      expect(result.seasonElo).toBeNull();
    });

    it('should query user_stats with correct user id', async () => {
      mockQuery.mockResolvedValueOnce([{ elo_rating: 1000, peak_elo: 1000 }]);
      mockGetSetting.mockResolvedValue(null);
      mockGetActiveSeason.mockResolvedValue(null);

      await getUserRank(55);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM user_stats WHERE user_id = ?'),
        [55],
      );
    });

    it('should use custom rank config from settings', async () => {
      const customConfig: RankConfig = {
        tiers: [
          { name: 'Noob', minElo: 0, maxElo: 1500, color: '#111' },
          { name: 'Pro', minElo: 1501, maxElo: 99999, color: '#222' },
        ],
        subTiersEnabled: false,
      };
      mockQuery.mockResolvedValueOnce([{ elo_rating: 1200, peak_elo: 1300 }]);
      mockGetSetting.mockResolvedValue(JSON.stringify(customConfig));
      mockGetActiveSeason.mockResolvedValue(null);

      const result = await getUserRank(1);

      expect(result.rankTier).toBe('Noob');
      expect(result.rankColor).toBe('#111');
    });
  });
});

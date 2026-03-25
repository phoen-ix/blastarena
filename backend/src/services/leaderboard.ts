import { query } from '../db/connection';
import {
  LeaderboardEntry,
  LeaderboardResponse,
  PublicProfile,
  RankConfig,
  DEFAULT_RANK_CONFIG,
  Season,
} from '@blast-arena/shared';
import { PublicProfileRow, CountRow } from '../db/types';
import { RowDataPacket } from 'mysql2';
import * as seasonService from './season';
import * as cosmeticsService from './cosmetics';
import * as achievementsService from './achievements';
import { getSetting } from './settings';

export function getRankForElo(elo: number, config: RankConfig): { name: string; color: string } {
  const sorted = [...config.tiers].sort((a, b) => b.minElo - a.minElo);

  for (const tier of sorted) {
    if (elo >= tier.minElo && elo <= tier.maxElo) {
      let name = tier.name;

      if (config.subTiersEnabled) {
        const range = tier.maxElo - tier.minElo + 1;
        const thirdSize = Math.ceil(range / 3);
        const posInTier = elo - tier.minElo;

        if (posInTier >= thirdSize * 2) {
          name += ' I';
        } else if (posInTier >= thirdSize) {
          name += ' II';
        } else {
          name += ' III';
        }
      }

      return { name, color: tier.color };
    }
  }

  // Fallback to lowest tier
  const lowest = config.tiers.reduce((a, b) => (a.minElo < b.minElo ? a : b), config.tiers[0]);
  return { name: lowest.name, color: lowest.color };
}

export async function getRankConfig(): Promise<RankConfig> {
  const value = await getSetting('rank_tiers');
  if (!value) return DEFAULT_RANK_CONFIG;
  try {
    return JSON.parse(value) as RankConfig;
  } catch {
    return DEFAULT_RANK_CONFIG;
  }
}

interface LeaderboardRow extends RowDataPacket {
  user_id: number;
  username: string;
  elo_rating: number;
  peak_elo: number;
  matches_played: number;
  total_wins: number;
  total_kills: number;
  total_xp: number;
  level: number;
}

export async function getLeaderboard(opts: {
  page?: number;
  limit?: number;
  seasonId?: number;
}): Promise<LeaderboardResponse> {
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 25, 100);
  const offset = (page - 1) * limit;
  const rankConfig = await getRankConfig();

  let season: Season | null = null;
  let rows: LeaderboardRow[];
  let total: number;

  if (opts.seasonId) {
    season = await seasonService.getSeasonById(opts.seasonId);
    const [dataRows, countRows] = await Promise.all([
      query<LeaderboardRow[]>(
        `SELECT se.user_id, u.username, se.elo_rating, se.peak_elo, se.matches_played,
                COALESCE(us.total_wins, 0) as total_wins, COALESCE(us.total_kills, 0) as total_kills,
                COALESCE(us.total_xp, 0) as total_xp, COALESCE(us.level, 1) as level
         FROM season_elo se
         JOIN users u ON u.id = se.user_id
         LEFT JOIN user_stats us ON us.user_id = se.user_id
         WHERE se.season_id = ? AND u.is_deactivated = 0 AND u.is_profile_public = 1
         ORDER BY se.elo_rating DESC
         LIMIT ? OFFSET ?`,
        [opts.seasonId, limit, offset],
      ),
      query<CountRow[]>(
        `SELECT COUNT(*) as total FROM season_elo se
         JOIN users u ON u.id = se.user_id
         WHERE se.season_id = ? AND u.is_deactivated = 0 AND u.is_profile_public = 1`,
        [opts.seasonId],
      ),
    ]);
    rows = dataRows;
    total = countRows[0].total;
  } else {
    // Current/global leaderboard from user_stats
    const activeSeason = await seasonService.getActiveSeason();
    season = activeSeason;

    if (activeSeason) {
      const [dataRows, countRows] = await Promise.all([
        query<LeaderboardRow[]>(
          `SELECT se.user_id, u.username, se.elo_rating, se.peak_elo, se.matches_played,
                  COALESCE(us.total_wins, 0) as total_wins, COALESCE(us.total_kills, 0) as total_kills,
                  COALESCE(us.total_xp, 0) as total_xp, COALESCE(us.level, 1) as level
           FROM season_elo se
           JOIN users u ON u.id = se.user_id
           LEFT JOIN user_stats us ON us.user_id = se.user_id
           WHERE se.season_id = ? AND u.is_deactivated = 0 AND u.is_profile_public = 1
           ORDER BY se.elo_rating DESC
           LIMIT ? OFFSET ?`,
          [activeSeason.id, limit, offset],
        ),
        query<CountRow[]>(
          `SELECT COUNT(*) as total FROM season_elo se
           JOIN users u ON u.id = se.user_id
           WHERE se.season_id = ? AND u.is_deactivated = 0 AND u.is_profile_public = 1`,
          [activeSeason.id],
        ),
      ]);
      rows = dataRows;
      total = countRows[0].total;
    } else {
      const [dataRows, countRows] = await Promise.all([
        query<LeaderboardRow[]>(
          `SELECT us.user_id, u.username, us.elo_rating, us.peak_elo,
                  us.total_matches as matches_played,
                  COALESCE(us.total_wins, 0) as total_wins, COALESCE(us.total_kills, 0) as total_kills,
                  COALESCE(us.total_xp, 0) as total_xp, COALESCE(us.level, 1) as level
           FROM user_stats us
           JOIN users u ON u.id = us.user_id
           WHERE u.is_deactivated = 0 AND u.is_profile_public = 1
           ORDER BY us.elo_rating DESC
           LIMIT ? OFFSET ?`,
          [limit, offset],
        ),
        query<CountRow[]>(
          `SELECT COUNT(*) as total FROM user_stats us
           JOIN users u ON u.id = us.user_id
           WHERE u.is_deactivated = 0 AND u.is_profile_public = 1`,
        ),
      ]);
      rows = dataRows;
      total = countRows[0].total;
    }
  }

  const entries: LeaderboardEntry[] = rows.map((row, i) => {
    const rank = getRankForElo(row.elo_rating, rankConfig);
    return {
      rank: offset + i + 1,
      userId: row.user_id,
      username: row.username,
      eloRating: row.elo_rating,
      peakElo: row.peak_elo,
      matchesPlayed: row.matches_played,
      totalWins: row.total_wins,
      totalKills: row.total_kills,
      rankTier: rank.name,
      rankColor: rank.color,
      level: row.level || 1,
      totalXp: row.total_xp || 0,
    };
  });

  return { entries, total, page, limit, season };
}

export async function getPublicProfile(userId: number): Promise<PublicProfile | null> {
  const rows = await query<PublicProfileRow[]>(
    `SELECT u.id, u.username, u.role, u.created_at, u.is_profile_public,
            COALESCE(us.total_matches, 0) as total_matches,
            COALESCE(us.total_wins, 0) as total_wins,
            COALESCE(us.total_kills, 0) as total_kills,
            COALESCE(us.total_deaths, 0) as total_deaths,
            COALESCE(us.elo_rating, 1000) as elo_rating,
            COALESCE(us.peak_elo, 1000) as peak_elo,
            COALESCE(us.win_streak, 0) as win_streak,
            COALESCE(us.best_win_streak, 0) as best_win_streak,
            COALESCE(us.total_xp, 0) as total_xp,
            COALESCE(us.level, 1) as level
     FROM users u
     LEFT JOIN user_stats us ON us.user_id = u.id
     WHERE u.id = ? AND u.is_deactivated = 0`,
    [userId],
  );

  if (rows.length === 0) return null;
  const row = rows[0];

  if (!row.is_profile_public) return null;

  const rankConfig = await getRankConfig();
  const rank = getRankForElo(row.elo_rating, rankConfig);

  const [seasonHistory, achievements, equippedCosmetics, cosmeticDataMap] = await Promise.all([
    seasonService.getUserSeasonHistory(userId),
    achievementsService.getUserAchievementsPublic(userId),
    cosmeticsService.getEquippedCosmetics(userId),
    cosmeticsService.getPlayerCosmeticsForGame([userId]),
  ]);

  return {
    id: row.id,
    username: row.username,
    role: row.role,
    createdAt: row.created_at.toISOString(),
    stats: {
      totalMatches: row.total_matches,
      totalWins: row.total_wins,
      totalKills: row.total_kills,
      totalDeaths: row.total_deaths,
      eloRating: row.elo_rating,
      peakElo: row.peak_elo,
      winStreak: row.win_streak,
      bestWinStreak: row.best_win_streak,
      level: row.level || 1,
      totalXp: row.total_xp || 0,
    },
    rankTier: rank.name,
    rankColor: rank.color,
    seasonHistory: seasonHistory.map((s) => ({
      seasonId: s.seasonId,
      seasonName: s.seasonName,
      finalElo: s.finalElo,
      peakElo: s.peakElo,
      matchesPlayed: s.matchesPlayed,
    })),
    achievements,
    equippedCosmetics,
    cosmeticData: cosmeticDataMap.get(userId),
  };
}

export async function getUserRank(userId: number): Promise<{
  eloRating: number;
  peakElo: number;
  rankTier: string;
  rankColor: string;
  seasonElo: number | null;
  level: number;
  totalXp: number;
}> {
  interface EloRow extends RowDataPacket {
    elo_rating: number;
    peak_elo: number;
    level: number;
    total_xp: number;
  }

  const rows = await query<EloRow[]>(
    'SELECT elo_rating, peak_elo, level, total_xp FROM user_stats WHERE user_id = ?',
    [userId],
  );

  const elo = rows.length > 0 ? rows[0].elo_rating : 1000;
  const peakElo = rows.length > 0 ? rows[0].peak_elo : 1000;
  const rankConfig = await getRankConfig();
  const rank = getRankForElo(elo, rankConfig);

  // Check active season elo
  let seasonElo: number | null = null;
  const activeSeason = await seasonService.getActiveSeason();
  if (activeSeason) {
    interface SeasonEloVal extends RowDataPacket {
      elo_rating: number;
    }
    const seRows = await query<SeasonEloVal[]>(
      'SELECT elo_rating FROM season_elo WHERE user_id = ? AND season_id = ?',
      [userId, activeSeason.id],
    );
    if (seRows.length > 0) seasonElo = seRows[0].elo_rating;
  }

  const level = rows.length > 0 ? rows[0].level || 1 : 1;
  const totalXp = rows.length > 0 ? rows[0].total_xp || 0 : 0;

  return {
    eloRating: elo,
    peakElo,
    rankTier: rank.name,
    rankColor: rank.color,
    seasonElo,
    level,
    totalXp,
  };
}

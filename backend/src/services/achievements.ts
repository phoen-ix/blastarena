import { query, execute } from '../db/connection';
import {
  Achievement,
  AchievementConditionType,
  AchievementRewardType,
  AchievementProgress,
  AchievementUnlockEvent,
  GameAchievementData,
  UserAchievement,
  UserAchievementPublic,
  Cosmetic,
} from '@blast-arena/shared';
import { AchievementRow, UserAchievementRow, CountRow } from '../db/types';
import { RowDataPacket } from 'mysql2';
import * as cosmeticsService from './cosmetics';

function toAchievement(row: AchievementRow): Achievement {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    category: row.category,
    conditionType: row.condition_type as AchievementConditionType,
    conditionConfig:
      typeof row.condition_config === 'string'
        ? JSON.parse(row.condition_config)
        : row.condition_config,
    rewardType: row.reward_type as AchievementRewardType,
    rewardId: row.reward_id,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

export async function getAllAchievements(activeOnly: boolean = false): Promise<Achievement[]> {
  const whereClause = activeOnly ? 'WHERE is_active = TRUE' : '';
  const rows = await query<AchievementRow[]>(
    `SELECT * FROM achievements ${whereClause} ORDER BY category, sort_order, id`,
  );
  return rows.map(toAchievement);
}

export async function getAchievementById(id: number): Promise<Achievement | null> {
  const rows = await query<AchievementRow[]>('SELECT * FROM achievements WHERE id = ?', [id]);
  return rows.length > 0 ? toAchievement(rows[0]) : null;
}

export async function createAchievement(data: {
  name: string;
  description: string;
  icon?: string;
  category?: string;
  conditionType: AchievementConditionType;
  conditionConfig: Record<string, unknown>;
  rewardType?: AchievementRewardType;
  rewardId?: number | null;
  sortOrder?: number;
}): Promise<Achievement> {
  const result = await execute(
    `INSERT INTO achievements (name, description, icon, category, condition_type, condition_config, reward_type, reward_id, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name,
      data.description,
      data.icon ?? '🏆',
      data.category ?? 'general',
      data.conditionType,
      JSON.stringify(data.conditionConfig),
      data.rewardType ?? 'none',
      data.rewardId ?? null,
      data.sortOrder ?? 0,
    ],
  );

  return (await getAchievementById(result.insertId))!;
}

export async function updateAchievement(
  id: number,
  data: Partial<{
    name: string;
    description: string;
    icon: string;
    category: string;
    conditionType: AchievementConditionType;
    conditionConfig: Record<string, unknown>;
    rewardType: AchievementRewardType;
    rewardId: number | null;
    isActive: boolean;
    sortOrder: number;
  }>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (data.name !== undefined) {
    sets.push('name = ?');
    params.push(data.name);
  }
  if (data.description !== undefined) {
    sets.push('description = ?');
    params.push(data.description);
  }
  if (data.icon !== undefined) {
    sets.push('icon = ?');
    params.push(data.icon);
  }
  if (data.category !== undefined) {
    sets.push('category = ?');
    params.push(data.category);
  }
  if (data.conditionType !== undefined) {
    sets.push('condition_type = ?');
    params.push(data.conditionType);
  }
  if (data.conditionConfig !== undefined) {
    sets.push('condition_config = ?');
    params.push(JSON.stringify(data.conditionConfig));
  }
  if (data.rewardType !== undefined) {
    sets.push('reward_type = ?');
    params.push(data.rewardType);
  }
  if (data.rewardId !== undefined) {
    sets.push('reward_id = ?');
    params.push(data.rewardId);
  }
  if (data.isActive !== undefined) {
    sets.push('is_active = ?');
    params.push(data.isActive);
  }
  if (data.sortOrder !== undefined) {
    sets.push('sort_order = ?');
    params.push(data.sortOrder);
  }

  if (sets.length === 0) return;
  params.push(id);
  await execute(`UPDATE achievements SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteAchievement(id: number): Promise<void> {
  await execute('DELETE FROM achievements WHERE id = ?', [id]);
}

export async function getUserAchievements(userId: number): Promise<UserAchievement[]> {
  const rows = await query<UserAchievementRow[]>(
    `SELECT * FROM user_achievements WHERE user_id = ?`,
    [userId],
  );
  return rows.map((r) => ({
    achievementId: r.achievement_id,
    unlockedAt: r.unlocked_at ? r.unlocked_at.toISOString() : null,
    progress: r.progress
      ? typeof r.progress === 'string'
        ? JSON.parse(r.progress)
        : r.progress
      : null,
  }));
}

export async function getUserAchievementsPublic(userId: number): Promise<UserAchievementPublic[]> {
  const rows = await query<UserAchievementRow[]>(
    `SELECT ua.*, a.name, a.description, a.icon, a.category,
            a.condition_type, a.condition_config, a.reward_type, a.reward_id, a.is_active, a.sort_order
     FROM user_achievements ua
     JOIN achievements a ON a.id = ua.achievement_id
     WHERE ua.user_id = ? AND ua.unlocked_at IS NOT NULL
     ORDER BY ua.unlocked_at DESC`,
    [userId],
  );

  return rows.map((r) => ({
    achievement: {
      id: r.achievement_id,
      name: r.name!,
      description: r.description!,
      icon: r.icon!,
      category: r.category!,
      conditionType: r.condition_type as AchievementConditionType,
      conditionConfig:
        typeof r.condition_config === 'string'
          ? JSON.parse(r.condition_config!)
          : r.condition_config,
      rewardType: r.reward_type as AchievementRewardType,
      rewardId: r.reward_id ?? null,
      isActive: r.is_active!,
      sortOrder: r.sort_order!,
    },
    unlockedAt: r.unlocked_at!.toISOString(),
  }));
}

interface StatsRow extends RowDataPacket {
  total_matches: number;
  total_wins: number;
  total_kills: number;
  total_deaths: number;
  total_bombs: number;
  total_powerups: number;
  total_playtime: number;
  win_streak: number;
  best_win_streak: number;
}

/**
 * @param row the caller's already-loaded user_stats row.
 *
 * This used to run `SELECT * FROM user_stats` itself, once per cumulative achievement — with ~50
 * active achievements and eight players, a single match-end fired hundreds of identical queries.
 * (audit ACHIEVEMENT-NPLUS1-1)
 */
function checkCumulative(row: StatsRow | undefined, config: Record<string, unknown>): boolean {
  const stat = config.stat as string;
  const threshold = config.threshold as number;
  if (!stat || threshold === undefined) return false;
  if (!row) return false;

  const statMap: Record<string, number> = {
    total_matches: row.total_matches,
    total_wins: row.total_wins,
    total_kills: row.total_kills,
    total_deaths: row.total_deaths,
    total_bombs: row.total_bombs,
    total_powerups: row.total_powerups,
    total_playtime: row.total_playtime,
    win_streak: row.win_streak,
    best_win_streak: row.best_win_streak,
  };

  return (statMap[stat] ?? 0) >= threshold;
}

function checkPerGame(gameData: GameAchievementData, config: Record<string, unknown>): boolean {
  const stat = config.stat as string;
  const operator = (config.operator as string) ?? '>=';
  const threshold = config.threshold as number;
  if (!stat || threshold === undefined) return false;

  const dataMap: Record<string, number | boolean> = {
    kills: gameData.kills,
    deaths: gameData.deaths,
    self_kills: gameData.selfKills,
    bombs_placed: gameData.bombsPlaced,
    powerups_collected: gameData.powerupsCollected,
    survived_seconds: gameData.survivedSeconds,
    placement: gameData.placement,
    player_count: gameData.playerCount,
    is_winner: gameData.isWinner,
  };

  const value = dataMap[stat];
  if (value === undefined) return false;
  const numValue = typeof value === 'boolean' ? (value ? 1 : 0) : value;

  switch (operator) {
    case '>=':
      return numValue >= threshold;
    case '<=':
      return numValue <= threshold;
    case '==':
      return numValue === threshold;
    case '>':
      return numValue > threshold;
    case '<':
      return numValue < threshold;
    default:
      return numValue >= threshold;
  }
}

/**
 * @param totals memo for this evaluation, keyed `stat:mode`.
 *
 * Several achievements share the same (stat, mode) pair — "10 FFA wins", "50 FFA wins", "100 FFA
 * wins" — and each used to run its own aggregate over matches ⋈ match_players. One query per
 * distinct pair is enough. (audit ACHIEVEMENT-NPLUS1-1)
 */
async function checkModeSpecific(
  userId: number,
  gameData: GameAchievementData,
  config: Record<string, unknown>,
  totals: Map<string, number>,
): Promise<boolean> {
  const mode = config.mode as string;
  const stat = config.stat as string;
  const threshold = config.threshold as number;
  if (!mode || !stat || threshold === undefined) return false;

  // Only evaluate if this game matches the mode
  if (gameData.gameMode !== mode) return false;

  const cacheKey = `${stat}:${mode}`;
  const cached = totals.get(cacheKey);
  if (cached !== undefined) return cached >= threshold;

  interface SumRow extends RowDataPacket {
    total: number;
  }

  let total: number | null = null;
  if (stat === 'wins') {
    const [row] = await query<CountRow[]>(
      `SELECT COUNT(*) as total FROM matches m
       JOIN match_players mp ON mp.match_id = m.id
       WHERE mp.user_id = ? AND m.game_mode = ? AND mp.placement = 1`,
      [userId, mode],
    );
    total = row.total;
  } else if (stat === 'matches') {
    const [row] = await query<CountRow[]>(
      `SELECT COUNT(*) as total FROM matches m
       JOIN match_players mp ON mp.match_id = m.id
       WHERE mp.user_id = ? AND m.game_mode = ?`,
      [userId, mode],
    );
    total = row.total;
  } else if (stat === 'kills') {
    const [row] = await query<SumRow[]>(
      `SELECT COALESCE(SUM(mp.kills), 0) as total FROM matches m
       JOIN match_players mp ON mp.match_id = m.id
       WHERE mp.user_id = ? AND m.game_mode = ?`,
      [userId, mode],
    );
    total = row.total;
  }

  if (total === null) return false;
  totals.set(cacheKey, total);
  return total >= threshold;
}

async function checkCampaign(userId: number, config: Record<string, unknown>): Promise<boolean> {
  const subType = config.subType as string;
  const threshold = config.threshold as number;

  if (subType === 'total_stars') {
    interface StarRow extends RowDataPacket {
      total_stars: number;
    }
    const [row] = await query<StarRow[]>(
      'SELECT total_stars FROM campaign_user_state WHERE user_id = ?',
      [userId],
    );
    return (row?.total_stars ?? 0) >= (threshold ?? 0);
  }

  if (subType === 'levels_completed') {
    interface LevelRow extends RowDataPacket {
      total_levels_completed: number;
    }
    const [row] = await query<LevelRow[]>(
      'SELECT total_levels_completed FROM campaign_user_state WHERE user_id = ?',
      [userId],
    );
    return (row?.total_levels_completed ?? 0) >= (threshold ?? 0);
  }

  if (subType === 'world_complete') {
    const worldId = config.worldId as number;
    if (!worldId) return false;
    // Check if all published levels in world are completed
    const [totalRow] = await query<CountRow[]>(
      'SELECT COUNT(*) as total FROM campaign_levels WHERE world_id = ? AND is_published = TRUE',
      [worldId],
    );
    const [completedRow] = await query<CountRow[]>(
      `SELECT COUNT(*) as total FROM campaign_progress cp
       JOIN campaign_levels cl ON cl.id = cp.level_id
       WHERE cp.user_id = ? AND cl.world_id = ? AND cp.completed = TRUE`,
      [userId, worldId],
    );
    return totalRow.total > 0 && completedRow.total >= totalRow.total;
  }

  return false;
}

export async function evaluateAfterGame(
  gameData: GameAchievementData,
): Promise<AchievementUnlockEvent> {
  const userId = gameData.userId;

  // Fetch active achievements NOT yet unlocked by this user
  const achievements = await query<AchievementRow[]>(
    `SELECT a.* FROM achievements a
     LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = ?
     WHERE a.is_active = TRUE AND a.condition_type != 'campaign'
       AND (ua.unlocked_at IS NULL OR ua.user_id IS NULL)`,
    [userId],
  );

  const newlyUnlocked: Achievement[] = [];
  const rewards: Cosmetic[] = [];

  // Loaded once and shared across every cumulative check, and one aggregate per distinct
  // (stat, mode) pair rather than one per achievement. (audit ACHIEVEMENT-NPLUS1-1)
  let statsRow: StatsRow | undefined;
  let statsLoaded = false;
  const modeTotals = new Map<string, number>();

  for (const row of achievements) {
    const achievement = toAchievement(row);
    let met = false;

    switch (achievement.conditionType) {
      case 'cumulative': {
        if (!statsLoaded) {
          [statsRow] = await query<StatsRow[]>('SELECT * FROM user_stats WHERE user_id = ?', [
            userId,
          ]);
          statsLoaded = true;
        }
        met = checkCumulative(statsRow, achievement.conditionConfig);
        break;
      }
      case 'per_game':
        met = checkPerGame(gameData, achievement.conditionConfig);
        break;
      case 'mode_specific':
        met = await checkModeSpecific(userId, gameData, achievement.conditionConfig, modeTotals);
        break;
    }

    if (met) {
      await execute(
        `INSERT INTO user_achievements (user_id, achievement_id, unlocked_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE unlocked_at = COALESCE(unlocked_at, NOW())`,
        [userId, achievement.id],
      );
      newlyUnlocked.push(achievement);

      if (achievement.rewardType === 'cosmetic' && achievement.rewardId) {
        await cosmeticsService.unlockCosmetic(userId, achievement.rewardId);
        const cosmetic = await cosmeticsService.getCosmeticById(achievement.rewardId);
        if (cosmetic) rewards.push(cosmetic);
      }
    }
  }

  return { achievements: newlyUnlocked, rewards };
}

export async function evaluateAfterCampaign(
  userId: number,
  totalStars: number,
  _levelId: number,
  _worldId: number,
): Promise<AchievementUnlockEvent> {
  // Fetch active campaign achievements NOT yet unlocked
  const achievements = await query<AchievementRow[]>(
    `SELECT a.* FROM achievements a
     LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = ?
     WHERE a.is_active = TRUE AND a.condition_type = 'campaign'
       AND (ua.unlocked_at IS NULL OR ua.user_id IS NULL)`,
    [userId],
  );

  const newlyUnlocked: Achievement[] = [];
  const rewards: Cosmetic[] = [];

  for (const row of achievements) {
    const achievement = toAchievement(row);
    const met = await checkCampaign(userId, achievement.conditionConfig);

    if (met) {
      await execute(
        `INSERT INTO user_achievements (user_id, achievement_id, unlocked_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE unlocked_at = COALESCE(unlocked_at, NOW())`,
        [userId, achievement.id],
      );
      newlyUnlocked.push(achievement);

      if (achievement.rewardType === 'cosmetic' && achievement.rewardId) {
        await cosmeticsService.unlockCosmetic(userId, achievement.rewardId);
        const cosmetic = await cosmeticsService.getCosmeticById(achievement.rewardId);
        if (cosmetic) rewards.push(cosmetic);
      }
    }
  }

  // Also check campaign star cosmetic unlocks
  await cosmeticsService.checkCampaignStarUnlocks(userId, totalStars);

  return { achievements: newlyUnlocked, rewards };
}

export async function getAchievementProgress(userId: number): Promise<AchievementProgress[]> {
  const achievements = await getAllAchievements(true);
  const userAchievements = await getUserAchievements(userId);
  const unlockedMap = new Map<number, string>();
  for (const ua of userAchievements) {
    if (ua.unlockedAt) unlockedMap.set(ua.achievementId, ua.unlockedAt);
  }

  // Fetch user stats once
  interface ProgressStatsRow extends RowDataPacket {
    total_matches: number;
    total_wins: number;
    total_kills: number;
    total_deaths: number;
    total_bombs: number;
    total_powerups: number;
    total_playtime: number;
    win_streak: number;
    best_win_streak: number;
    elo_rating: number;
    peak_elo: number;
    total_xp: number;
    level: number;
  }
  const statsRows = await query<ProgressStatsRow[]>('SELECT * FROM user_stats WHERE user_id = ?', [
    userId,
  ]);
  // Numeric stat lookup by column name (achievement configs reference numeric columns only)
  const stats: Record<string, number | undefined> = statsRows[0] || {};

  // Batch fetch per_game bests
  interface BestRow extends RowDataPacket {
    best_kills: number;
    best_deaths: number;
    best_bombs_placed: number;
    best_powerups_collected: number;
    best_survived_seconds: number;
    best_placement: number;
  }
  const bestRows = await query<BestRow[]>(
    `SELECT MAX(kills) as best_kills, MAX(deaths) as best_deaths,
     MAX(bombs_placed) as best_bombs_placed, MAX(powerups_collected) as best_powerups_collected,
     MAX(survived_seconds) as best_survived_seconds, MIN(placement) as best_placement
     FROM match_players WHERE user_id = ?`,
    [userId],
  );
  const bests: Partial<BestRow> = bestRows[0] || {};

  const results: AchievementProgress[] = [];

  for (const a of achievements) {
    const config = a.conditionConfig;
    const threshold = (config.threshold as number) ?? 0;
    let current = 0;
    const unlocked = unlockedMap.has(a.id);

    if (unlocked) {
      current = threshold;
    } else {
      switch (a.conditionType) {
        case 'cumulative': {
          const stat = config.stat as string;
          current = stats[stat] ?? 0;
          break;
        }
        case 'per_game': {
          const stat = config.stat as string;
          type BestColumn =
            | 'best_kills'
            | 'best_deaths'
            | 'best_bombs_placed'
            | 'best_powerups_collected'
            | 'best_survived_seconds'
            | 'best_placement';
          const colMap: Record<string, BestColumn> = {
            kills: 'best_kills',
            deaths: 'best_deaths',
            bombs_placed: 'best_bombs_placed',
            powerups_collected: 'best_powerups_collected',
            survived_seconds: 'best_survived_seconds',
            placement: 'best_placement',
            self_kills: 'best_kills', // approximate
            is_winner: 'best_placement', // placement 1 = winner
            player_count: 'best_kills', // not meaningful for progress
          };
          const col = colMap[stat];
          if (col) {
            current = bests[col] ?? 0;
          }
          // For is_winner, convert placement to boolean-like
          if (stat === 'is_winner') {
            current = current === 1 ? 1 : 0;
          }
          break;
        }
        case 'mode_specific': {
          const mode = config.mode as string;
          const modeStat = config.stat as string;
          if (modeStat === 'wins') {
            interface CR extends RowDataPacket {
              total: number;
            }
            const [row] = await query<CR[]>(
              `SELECT COUNT(*) as total FROM matches m
               JOIN match_players mp ON mp.match_id = m.id
               WHERE mp.user_id = ? AND m.game_mode = ? AND mp.placement = 1`,
              [userId, mode],
            );
            current = row?.total ?? 0;
          } else if (modeStat === 'matches') {
            interface CR extends RowDataPacket {
              total: number;
            }
            const [row] = await query<CR[]>(
              `SELECT COUNT(*) as total FROM matches m
               JOIN match_players mp ON mp.match_id = m.id
               WHERE mp.user_id = ? AND m.game_mode = ?`,
              [userId, mode],
            );
            current = row?.total ?? 0;
          } else if (modeStat === 'kills') {
            interface SR extends RowDataPacket {
              total: number;
            }
            const [row] = await query<SR[]>(
              `SELECT COALESCE(SUM(mp.kills), 0) as total FROM matches m
               JOIN match_players mp ON mp.match_id = m.id
               WHERE mp.user_id = ? AND m.game_mode = ?`,
              [userId, mode],
            );
            current = row?.total ?? 0;
          }
          break;
        }
        case 'campaign': {
          const subType = config.subType as string;
          if (subType === 'total_stars') {
            interface CR extends RowDataPacket {
              total_stars: number;
            }
            const [row] = await query<CR[]>(
              'SELECT total_stars FROM campaign_user_state WHERE user_id = ?',
              [userId],
            );
            current = row?.total_stars ?? 0;
          } else if (subType === 'levels_completed') {
            interface CR extends RowDataPacket {
              total: number;
            }
            const [row] = await query<CR[]>(
              'SELECT COUNT(*) as total FROM campaign_progress WHERE user_id = ? AND completed = TRUE',
              [userId],
            );
            current = row?.total ?? 0;
          }
          break;
        }
      }
    }

    results.push({
      achievementId: a.id,
      name: a.name,
      description: a.description,
      icon: a.icon,
      category: a.category,
      conditionType: a.conditionType,
      current: Math.min(current, threshold),
      threshold,
      unlocked,
      unlockedAt: unlockedMap.get(a.id) ?? null,
    });
  }

  return results;
}

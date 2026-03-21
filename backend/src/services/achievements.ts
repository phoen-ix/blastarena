import { query, execute } from '../db/connection';
import {
  Achievement,
  AchievementConditionType,
  AchievementRewardType,
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
    conditionConfig: typeof row.condition_config === 'string' ? JSON.parse(row.condition_config) : row.condition_config,
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

  if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
  if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
  if (data.icon !== undefined) { sets.push('icon = ?'); params.push(data.icon); }
  if (data.category !== undefined) { sets.push('category = ?'); params.push(data.category); }
  if (data.conditionType !== undefined) { sets.push('condition_type = ?'); params.push(data.conditionType); }
  if (data.conditionConfig !== undefined) { sets.push('condition_config = ?'); params.push(JSON.stringify(data.conditionConfig)); }
  if (data.rewardType !== undefined) { sets.push('reward_type = ?'); params.push(data.rewardType); }
  if (data.rewardId !== undefined) { sets.push('reward_id = ?'); params.push(data.rewardId); }
  if (data.isActive !== undefined) { sets.push('is_active = ?'); params.push(data.isActive); }
  if (data.sortOrder !== undefined) { sets.push('sort_order = ?'); params.push(data.sortOrder); }

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
    progress: r.progress ? (typeof r.progress === 'string' ? JSON.parse(r.progress) : r.progress) : null,
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
      conditionConfig: typeof r.condition_config === 'string' ? JSON.parse(r.condition_config!) : r.condition_config,
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

async function checkCumulative(
  userId: number,
  config: Record<string, unknown>,
): Promise<boolean> {
  const stat = config.stat as string;
  const threshold = config.threshold as number;
  if (!stat || threshold === undefined) return false;

  const [row] = await query<StatsRow[]>(
    'SELECT * FROM user_stats WHERE user_id = ?',
    [userId],
  );
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

function checkPerGame(
  gameData: GameAchievementData,
  config: Record<string, unknown>,
): boolean {
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
    case '>=': return numValue >= threshold;
    case '<=': return numValue <= threshold;
    case '==': return numValue === threshold;
    case '>': return numValue > threshold;
    case '<': return numValue < threshold;
    default: return numValue >= threshold;
  }
}

async function checkModeSpecific(
  userId: number,
  gameData: GameAchievementData,
  config: Record<string, unknown>,
): Promise<boolean> {
  const mode = config.mode as string;
  const stat = config.stat as string;
  const threshold = config.threshold as number;
  if (!mode || !stat || threshold === undefined) return false;

  // Only evaluate if this game matches the mode
  if (gameData.gameMode !== mode) return false;

  if (stat === 'wins') {
    const [row] = await query<CountRow[]>(
      `SELECT COUNT(*) as total FROM matches m
       JOIN match_players mp ON mp.match_id = m.id
       WHERE mp.user_id = ? AND m.game_mode = ? AND mp.placement = 1`,
      [userId, mode],
    );
    return row.total >= threshold;
  }

  if (stat === 'matches') {
    const [row] = await query<CountRow[]>(
      `SELECT COUNT(*) as total FROM matches m
       JOIN match_players mp ON mp.match_id = m.id
       WHERE mp.user_id = ? AND m.game_mode = ?`,
      [userId, mode],
    );
    return row.total >= threshold;
  }

  if (stat === 'kills') {
    interface SumRow extends RowDataPacket { total: number; }
    const [row] = await query<SumRow[]>(
      `SELECT COALESCE(SUM(mp.kills), 0) as total FROM matches m
       JOIN match_players mp ON mp.match_id = m.id
       WHERE mp.user_id = ? AND m.game_mode = ?`,
      [userId, mode],
    );
    return row.total >= threshold;
  }

  return false;
}

async function checkCampaign(
  userId: number,
  config: Record<string, unknown>,
): Promise<boolean> {
  const subType = config.subType as string;
  const threshold = config.threshold as number;

  if (subType === 'total_stars') {
    interface StarRow extends RowDataPacket { total_stars: number; }
    const [row] = await query<StarRow[]>(
      'SELECT total_stars FROM campaign_user_state WHERE user_id = ?',
      [userId],
    );
    return (row?.total_stars ?? 0) >= (threshold ?? 0);
  }

  if (subType === 'levels_completed') {
    interface LevelRow extends RowDataPacket { total_levels_completed: number; }
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

  for (const row of achievements) {
    const achievement = toAchievement(row);
    let met = false;

    switch (achievement.conditionType) {
      case 'cumulative':
        met = await checkCumulative(userId, achievement.conditionConfig);
        break;
      case 'per_game':
        met = checkPerGame(gameData, achievement.conditionConfig);
        break;
      case 'mode_specific':
        met = await checkModeSpecific(userId, gameData, achievement.conditionConfig);
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
  levelId: number,
  worldId: number,
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

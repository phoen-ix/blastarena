import { CampaignUserState, LevelProgress, StartingPowerUps } from '@blast-arena/shared';
import { query, execute } from '../db/connection';
import { CampaignProgressRow, CampaignUserStateRow } from '../db/types';

export async function getUserState(userId: number): Promise<CampaignUserState> {
  const rows = await query<CampaignUserStateRow[]>(
    `SELECT * FROM campaign_user_state WHERE user_id = ?`,
    [userId],
  );

  if (rows.length === 0) {
    return {
      currentWorldId: null,
      currentLevelId: null,
      carriedPowerups: null,
      totalLevelsCompleted: 0,
      totalStars: 0,
    };
  }

  const row = rows[0];
  return {
    currentWorldId: row.current_world_id,
    currentLevelId: row.current_level_id,
    carriedPowerups: row.carried_powerups
      ? typeof row.carried_powerups === 'string'
        ? JSON.parse(row.carried_powerups)
        : row.carried_powerups
      : null,
    totalLevelsCompleted: row.total_levels_completed,
    totalStars: row.total_stars,
  };
}

export async function getProgress(userId: number, levelId: number): Promise<LevelProgress | null> {
  const rows = await query<CampaignProgressRow[]>(
    `SELECT * FROM campaign_progress WHERE user_id = ? AND level_id = ?`,
    [userId, levelId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    levelId: row.level_id,
    completed: !!row.completed,
    bestTimeSeconds: row.best_time_seconds,
    stars: row.stars,
    attempts: row.attempts,
  };
}

export async function recordAttempt(userId: number, levelId: number): Promise<void> {
  await execute(
    `INSERT INTO campaign_progress (user_id, level_id, attempts)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE attempts = attempts + 1`,
    [userId, levelId],
  );
}

export async function recordCompletion(
  userId: number,
  levelId: number,
  timeSeconds: number,
  deaths: number,
  parTime: number = 0,
): Promise<number> {
  // Stars: 1 = completed, 2 = under par time, 3 = zero deaths
  let stars = 1;
  if (deaths === 0) {
    stars = 3;
  } else if (parTime > 0 && timeSeconds <= parTime) {
    stars = 2;
  }

  // Upsert progress — only improve, never regress
  await execute(
    `INSERT INTO campaign_progress (user_id, level_id, completed, best_time_seconds, stars, completed_at)
     VALUES (?, ?, TRUE, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       completed = TRUE,
       best_time_seconds = CASE
         WHEN best_time_seconds IS NULL THEN VALUES(best_time_seconds)
         WHEN VALUES(best_time_seconds) < best_time_seconds THEN VALUES(best_time_seconds)
         ELSE best_time_seconds
       END,
       stars = GREATEST(stars, VALUES(stars)),
       completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)`,
    [userId, levelId, timeSeconds, stars],
  );

  // Update user state totals
  await execute(
    `INSERT INTO campaign_user_state (user_id, total_levels_completed, total_stars)
     VALUES (?, 1, ?)
     ON DUPLICATE KEY UPDATE
       total_levels_completed = (SELECT COUNT(*) FROM campaign_progress WHERE user_id = ? AND completed = TRUE),
       total_stars = (SELECT COALESCE(SUM(stars), 0) FROM campaign_progress WHERE user_id = ?)`,
    [userId, stars, userId, userId],
  );

  return stars;
}

export async function updateCarriedPowerups(
  userId: number,
  powerups: StartingPowerUps | null,
): Promise<void> {
  await execute(
    `INSERT INTO campaign_user_state (user_id, carried_powerups)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE carried_powerups = VALUES(carried_powerups)`,
    [userId, powerups ? JSON.stringify(powerups) : null],
  );
}

export async function updateCurrentLevel(
  userId: number,
  worldId: number | null,
  levelId: number | null,
): Promise<void> {
  await execute(
    `INSERT INTO campaign_user_state (user_id, current_world_id, current_level_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE current_world_id = VALUES(current_world_id), current_level_id = VALUES(current_level_id)`,
    [userId, worldId, levelId],
  );
}

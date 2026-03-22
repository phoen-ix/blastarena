import { CampaignWorld, CampaignLevel, CampaignLevelSummary } from '@blast-arena/shared';
import { query, execute } from '../db/connection';
import { CampaignWorldRow, CampaignLevelRow, CountRow } from '../db/types';

function worldRowToEntry(row: CampaignWorldRow): CampaignWorld {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    sortOrder: row.sort_order,
    theme: row.theme,
    isPublished: !!row.is_published,
    levelCount: row.level_count ?? undefined,
    completedCount: row.completed_count ?? undefined,
  };
}

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return (value as T) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function levelRowToEntry(row: CampaignLevelRow): CampaignLevel {
  return {
    id: row.id,
    worldId: row.world_id,
    name: row.name,
    description: row.description || '',
    sortOrder: row.sort_order,
    mapWidth: row.map_width,
    mapHeight: row.map_height,
    tiles: safeJsonParse(row.tiles, []),
    fillMode: row.fill_mode,
    wallDensity: Number(row.wall_density),
    playerSpawns: safeJsonParse(row.player_spawns, []),
    enemyPlacements: safeJsonParse(row.enemy_placements, []),
    powerupPlacements: safeJsonParse(row.powerup_placements, []),
    winCondition: row.win_condition as CampaignLevel['winCondition'],
    winConditionConfig: row.win_condition_config
      ? safeJsonParse(row.win_condition_config, null)
      : null,
    lives: row.lives,
    timeLimit: row.time_limit,
    parTime: row.par_time ?? 0,
    carryOverPowerups: !!row.carry_over_powerups,
    startingPowerups: row.starting_powerups ? safeJsonParse(row.starting_powerups, null) : null,
    availablePowerupTypes: row.available_powerup_types
      ? safeJsonParse(row.available_powerup_types, null)
      : null,
    powerupDropRate: Number(row.powerup_drop_rate),
    reinforcedWalls: !!row.reinforced_walls,
    hazardTiles: !!row.hazard_tiles,
    coveredTiles: safeJsonParse(row.covered_tiles, []),
    isPublished: !!row.is_published,
  };
}

function levelRowToSummary(row: CampaignLevelRow): CampaignLevelSummary {
  const placements = safeJsonParse(row.enemy_placements, []);

  return {
    id: row.id,
    worldId: row.world_id,
    name: row.name,
    description: row.description || '',
    sortOrder: row.sort_order,
    mapWidth: row.map_width,
    mapHeight: row.map_height,
    winCondition: row.win_condition as CampaignLevelSummary['winCondition'],
    lives: row.lives,
    timeLimit: row.time_limit,
    parTime: row.par_time ?? 0,
    enemyCount: Array.isArray(placements) ? placements.length : 0,
    isPublished: !!row.is_published,
  };
}

// --- Worlds ---

export async function listWorlds(includeUnpublished = false): Promise<CampaignWorld[]> {
  const sql = includeUnpublished
    ? `SELECT w.*, (SELECT COUNT(*) FROM campaign_levels l WHERE l.world_id = w.id) AS level_count
       FROM campaign_worlds w ORDER BY w.sort_order ASC`
    : `SELECT w.*, (SELECT COUNT(*) FROM campaign_levels l WHERE l.world_id = w.id AND l.is_published = TRUE) AS level_count
       FROM campaign_worlds w WHERE w.is_published = TRUE ORDER BY w.sort_order ASC`;
  const rows = await query<CampaignWorldRow[]>(sql);
  return rows.map(worldRowToEntry);
}

export async function listWorldsWithProgress(userId: number): Promise<CampaignWorld[]> {
  const rows = await query<CampaignWorldRow[]>(
    `SELECT w.*,
       (SELECT COUNT(*) FROM campaign_levels l WHERE l.world_id = w.id AND l.is_published = TRUE) AS level_count,
       (SELECT COUNT(*) FROM campaign_progress p
         INNER JOIN campaign_levels l ON p.level_id = l.id
         WHERE l.world_id = w.id AND p.user_id = ? AND p.completed = TRUE) AS completed_count
     FROM campaign_worlds w WHERE w.is_published = TRUE
     ORDER BY w.sort_order ASC`,
    [userId],
  );
  return rows.map(worldRowToEntry);
}

export async function getWorld(id: number): Promise<CampaignWorld | null> {
  const rows = await query<CampaignWorldRow[]>(
    `SELECT w.*, (SELECT COUNT(*) FROM campaign_levels l WHERE l.world_id = w.id) AS level_count
     FROM campaign_worlds w WHERE w.id = ?`,
    [id],
  );
  return rows.length > 0 ? worldRowToEntry(rows[0]) : null;
}

export async function createWorld(
  name: string,
  description: string,
  theme: string,
  createdBy: number,
): Promise<number> {
  const [maxOrder] = await query<CountRow[]>(
    `SELECT COALESCE(MAX(sort_order), -1) AS total FROM campaign_worlds`,
  );
  const sortOrder = (maxOrder?.total ?? -1) + 1;
  const result = await execute(
    `INSERT INTO campaign_worlds (name, description, theme, sort_order, created_by) VALUES (?, ?, ?, ?, ?)`,
    [name, description, theme, sortOrder, createdBy],
  );
  return result.insertId;
}

export async function updateWorld(
  id: number,
  updates: Partial<{ name: string; description: string; theme: string; isPublished: boolean }>,
): Promise<void> {
  const sets: string[] = [];
  const params: (string | boolean | number)[] = [];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    params.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push('description = ?');
    params.push(updates.description);
  }
  if (updates.theme !== undefined) {
    sets.push('theme = ?');
    params.push(updates.theme);
  }
  if (updates.isPublished !== undefined) {
    sets.push('is_published = ?');
    params.push(updates.isPublished);
  }

  if (sets.length === 0) return;
  params.push(id);
  await execute(`UPDATE campaign_worlds SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteWorld(id: number): Promise<void> {
  await execute(`DELETE FROM campaign_worlds WHERE id = ?`, [id]);
}

export async function reorderWorld(id: number, newOrder: number): Promise<void> {
  await execute(`UPDATE campaign_worlds SET sort_order = ? WHERE id = ?`, [newOrder, id]);
}

// --- Levels ---

export async function listLevels(
  worldId: number,
  includeUnpublished = false,
): Promise<CampaignLevelSummary[]> {
  const sql = includeUnpublished
    ? `SELECT * FROM campaign_levels WHERE world_id = ? ORDER BY sort_order ASC`
    : `SELECT * FROM campaign_levels WHERE world_id = ? AND is_published = TRUE ORDER BY sort_order ASC`;
  const rows = await query<CampaignLevelRow[]>(sql, [worldId]);
  return rows.map(levelRowToSummary);
}

export async function listLevelsWithProgress(
  worldId: number,
  userId: number,
): Promise<CampaignLevelSummary[]> {
  const rows = await query<CampaignLevelRow[]>(
    `SELECT * FROM campaign_levels WHERE world_id = ? AND is_published = TRUE ORDER BY sort_order ASC`,
    [worldId],
  );
  const summaries = rows.map(levelRowToSummary);

  // Fetch progress for all levels in one query
  const levelIds = summaries.map((s) => s.id);
  if (levelIds.length > 0) {
    const placeholders = levelIds.map(() => '?').join(',');
    const progressRows = await query<any[]>(
      `SELECT * FROM campaign_progress WHERE user_id = ? AND level_id IN (${placeholders})`,
      [userId, ...levelIds],
    );
    const progressMap = new Map(progressRows.map((r) => [r.level_id, r]));
    for (const summary of summaries) {
      const p = progressMap.get(summary.id);
      if (p) {
        summary.progress = {
          levelId: p.level_id,
          completed: !!p.completed,
          bestTimeSeconds: p.best_time_seconds,
          stars: p.stars,
          attempts: p.attempts,
        };
      }
    }
  }

  return summaries;
}

export async function getLevel(id: number): Promise<CampaignLevel | null> {
  const rows = await query<CampaignLevelRow[]>(`SELECT * FROM campaign_levels WHERE id = ?`, [id]);
  return rows.length > 0 ? levelRowToEntry(rows[0]) : null;
}

export async function createLevel(
  worldId: number,
  data: Partial<CampaignLevel>,
  createdBy: number,
): Promise<number> {
  const [maxOrder] = await query<CountRow[]>(
    `SELECT COALESCE(MAX(sort_order), -1) AS total FROM campaign_levels WHERE world_id = ?`,
    [worldId],
  );
  const sortOrder = (maxOrder?.total ?? -1) + 1;

  const result = await execute(
    `INSERT INTO campaign_levels
     (world_id, name, description, sort_order, map_width, map_height, tiles, fill_mode, wall_density,
      player_spawns, enemy_placements, powerup_placements, win_condition, win_condition_config,
      lives, time_limit, par_time, carry_over_powerups, starting_powerups, available_powerup_types,
      powerup_drop_rate, reinforced_walls, hazard_tiles, is_published, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      worldId,
      data.name ?? 'Untitled Level',
      data.description ?? '',
      sortOrder,
      data.mapWidth ?? 15,
      data.mapHeight ?? 13,
      JSON.stringify(data.tiles ?? []),
      data.fillMode ?? 'handcrafted',
      data.wallDensity ?? 0.65,
      JSON.stringify(data.playerSpawns ?? []),
      JSON.stringify(data.enemyPlacements ?? []),
      JSON.stringify(data.powerupPlacements ?? []),
      data.winCondition ?? 'kill_all',
      data.winConditionConfig ? JSON.stringify(data.winConditionConfig) : null,
      data.lives ?? 3,
      data.timeLimit ?? 0,
      data.parTime ?? 0,
      data.carryOverPowerups ?? false,
      data.startingPowerups ? JSON.stringify(data.startingPowerups) : null,
      data.availablePowerupTypes ? JSON.stringify(data.availablePowerupTypes) : null,
      data.powerupDropRate ?? 0.3,
      data.reinforcedWalls ?? false,
      data.hazardTiles ?? false,
      data.isPublished ?? false,
      createdBy,
    ],
  );
  return result.insertId;
}

export async function updateLevel(id: number, data: Partial<CampaignLevel>): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];

  const fieldMap: Record<string, string> = {
    name: 'name',
    description: 'description',
    mapWidth: 'map_width',
    mapHeight: 'map_height',
    fillMode: 'fill_mode',
    wallDensity: 'wall_density',
    winCondition: 'win_condition',
    lives: 'lives',
    timeLimit: 'time_limit',
    parTime: 'par_time',
    carryOverPowerups: 'carry_over_powerups',
    powerupDropRate: 'powerup_drop_rate',
    reinforcedWalls: 'reinforced_walls',
    hazardTiles: 'hazard_tiles',
    isPublished: 'is_published',
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    const val = (data as Record<string, unknown>)[key];
    if (val !== undefined) {
      sets.push(`${col} = ?`);
      params.push(val);
    }
  }

  // JSON fields
  const jsonFields: Record<string, string> = {
    tiles: 'tiles',
    playerSpawns: 'player_spawns',
    enemyPlacements: 'enemy_placements',
    powerupPlacements: 'powerup_placements',
    winConditionConfig: 'win_condition_config',
    startingPowerups: 'starting_powerups',
    availablePowerupTypes: 'available_powerup_types',
    coveredTiles: 'covered_tiles',
  };

  for (const [key, col] of Object.entries(jsonFields)) {
    const val = (data as Record<string, unknown>)[key];
    if (val !== undefined) {
      sets.push(`${col} = ?`);
      params.push(val === null ? null : JSON.stringify(val));
    }
  }

  if (sets.length === 0) return;
  params.push(id);
  await execute(`UPDATE campaign_levels SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteLevel(id: number): Promise<void> {
  await execute(`DELETE FROM campaign_levels WHERE id = ?`, [id]);
}

export async function reorderLevel(id: number, newOrder: number): Promise<void> {
  await execute(`UPDATE campaign_levels SET sort_order = ? WHERE id = ?`, [newOrder, id]);
}

/** Get the next level in the same world (for "Next Level" button) */
export async function getNextLevel(currentLevelId: number): Promise<number | null> {
  const currentRows = await query<CampaignLevelRow[]>(
    `SELECT world_id, sort_order FROM campaign_levels WHERE id = ?`,
    [currentLevelId],
  );
  if (currentRows.length === 0) return null;

  const { world_id, sort_order } = currentRows[0];
  const nextRows = await query<CampaignLevelRow[]>(
    `SELECT id FROM campaign_levels WHERE world_id = ? AND sort_order > ? AND is_published = TRUE ORDER BY sort_order ASC LIMIT 1`,
    [world_id, sort_order],
  );
  return nextRows.length > 0 ? nextRows[0].id : null;
}

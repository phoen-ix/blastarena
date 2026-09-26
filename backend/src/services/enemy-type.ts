import { EnemyTypeEntry, EnemyTypeConfig } from '@blast-arena/shared';
import { query, execute } from '../db/connection';
import { CampaignEnemyTypeRow } from '../db/types';

function rowToEntry(row: CampaignEnemyTypeRow): EnemyTypeEntry {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
    isBoss: !!row.is_boss,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export async function listEnemyTypes(): Promise<EnemyTypeEntry[]> {
  const rows = await query<CampaignEnemyTypeRow[]>(
    `SELECT * FROM campaign_enemy_types ORDER BY is_boss ASC, name ASC`,
  );
  return rows.map(rowToEntry);
}

export async function getEnemyType(id: number): Promise<EnemyTypeEntry | null> {
  const rows = await query<CampaignEnemyTypeRow[]>(
    `SELECT * FROM campaign_enemy_types WHERE id = ?`,
    [id],
  );
  return rows.length > 0 ? rowToEntry(rows[0]) : null;
}

export async function getEnemyTypeConfigs(ids: number[]): Promise<Map<number, EnemyTypeConfig>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await query<CampaignEnemyTypeRow[]>(
    `SELECT * FROM campaign_enemy_types WHERE id IN (${placeholders})`,
    ids,
  );
  const map = new Map<number, EnemyTypeConfig>();
  for (const row of rows) {
    map.set(row.id, typeof row.config === 'string' ? JSON.parse(row.config) : row.config);
  }
  return map;
}

export async function createEnemyType(
  name: string,
  description: string,
  config: EnemyTypeConfig,
  createdBy: number,
): Promise<number> {
  const result = await execute(
    `INSERT INTO campaign_enemy_types (name, description, config, is_boss, created_by) VALUES (?, ?, ?, ?, ?)`,
    [name, description, JSON.stringify(config), config.isBoss, createdBy],
  );
  return result.insertId;
}

export async function updateEnemyType(
  id: number,
  updates: Partial<{ name: string; description: string; config: EnemyTypeConfig }>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    params.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push('description = ?');
    params.push(updates.description);
  }
  if (updates.config !== undefined) {
    sets.push('config = ?');
    params.push(JSON.stringify(updates.config));
    sets.push('is_boss = ?');
    params.push(updates.config.isBoss);
  }

  if (sets.length === 0) return;
  params.push(id);
  await execute(`UPDATE campaign_enemy_types SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteEnemyType(id: number): Promise<void> {
  await execute(`DELETE FROM campaign_enemy_types WHERE id = ?`, [id]);
}

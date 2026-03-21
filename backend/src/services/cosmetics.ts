import { query, execute } from '../db/connection';
import {
  Cosmetic,
  CosmeticType,
  EquippedCosmetics,
  PlayerCosmeticData,
} from '@blast-arena/shared';
import { CosmeticRow, UserCosmeticRow, UserEquippedCosmeticsRow, CountRow } from '../db/types';
import { RowDataPacket } from 'mysql2';

function toCosmetic(row: CosmeticRow): Cosmetic {
  return {
    id: row.id,
    name: row.name,
    type: row.type as CosmeticType,
    config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
    rarity: row.rarity as Cosmetic['rarity'],
    unlockType: row.unlock_type as Cosmetic['unlockType'],
    unlockRequirement: row.unlock_requirement
      ? typeof row.unlock_requirement === 'string'
        ? JSON.parse(row.unlock_requirement)
        : row.unlock_requirement
      : null,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

export async function getAllCosmetics(activeOnly: boolean = false): Promise<Cosmetic[]> {
  const whereClause = activeOnly ? 'WHERE is_active = TRUE' : '';
  const rows = await query<CosmeticRow[]>(
    `SELECT * FROM cosmetics ${whereClause} ORDER BY type, sort_order, id`,
  );
  return rows.map(toCosmetic);
}

export async function getCosmeticById(id: number): Promise<Cosmetic | null> {
  const rows = await query<CosmeticRow[]>('SELECT * FROM cosmetics WHERE id = ?', [id]);
  return rows.length > 0 ? toCosmetic(rows[0]) : null;
}

export async function createCosmetic(data: {
  name: string;
  type: CosmeticType;
  config: Record<string, unknown>;
  rarity?: string;
  unlockType?: string;
  unlockRequirement?: Record<string, unknown> | null;
  sortOrder?: number;
}): Promise<Cosmetic> {
  const result = await execute(
    `INSERT INTO cosmetics (name, type, config, rarity, unlock_type, unlock_requirement, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name,
      data.type,
      JSON.stringify(data.config),
      data.rarity ?? 'common',
      data.unlockType ?? 'achievement',
      data.unlockRequirement ? JSON.stringify(data.unlockRequirement) : null,
      data.sortOrder ?? 0,
    ],
  );

  return (await getCosmeticById(result.insertId))!;
}

export async function updateCosmetic(
  id: number,
  data: Partial<{
    name: string;
    type: CosmeticType;
    config: Record<string, unknown>;
    rarity: string;
    unlockType: string;
    unlockRequirement: Record<string, unknown> | null;
    isActive: boolean;
    sortOrder: number;
  }>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
  if (data.type !== undefined) { sets.push('type = ?'); params.push(data.type); }
  if (data.config !== undefined) { sets.push('config = ?'); params.push(JSON.stringify(data.config)); }
  if (data.rarity !== undefined) { sets.push('rarity = ?'); params.push(data.rarity); }
  if (data.unlockType !== undefined) { sets.push('unlock_type = ?'); params.push(data.unlockType); }
  if (data.unlockRequirement !== undefined) { sets.push('unlock_requirement = ?'); params.push(data.unlockRequirement ? JSON.stringify(data.unlockRequirement) : null); }
  if (data.isActive !== undefined) { sets.push('is_active = ?'); params.push(data.isActive); }
  if (data.sortOrder !== undefined) { sets.push('sort_order = ?'); params.push(data.sortOrder); }

  if (sets.length === 0) return;
  params.push(id);
  await execute(`UPDATE cosmetics SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteCosmetic(id: number): Promise<void> {
  await execute('DELETE FROM cosmetics WHERE id = ?', [id]);
}

export async function getUserCosmetics(userId: number): Promise<Cosmetic[]> {
  const rows = await query<UserCosmeticRow[]>(
    `SELECT uc.*, c.name, c.type, c.config, c.rarity, c.unlock_type, c.unlock_requirement, c.is_active, c.sort_order
     FROM user_cosmetics uc
     JOIN cosmetics c ON c.id = uc.cosmetic_id
     WHERE uc.user_id = ?
     ORDER BY c.type, c.sort_order`,
    [userId],
  );

  return rows.map((r) => ({
    id: r.cosmetic_id,
    name: r.name!,
    type: r.type as CosmeticType,
    config: typeof r.config === 'string' ? JSON.parse(r.config!) : r.config,
    rarity: r.rarity as Cosmetic['rarity'],
    unlockType: r.unlock_type as Cosmetic['unlockType'],
    unlockRequirement: r.unlock_requirement
      ? typeof r.unlock_requirement === 'string'
        ? JSON.parse(r.unlock_requirement)
        : r.unlock_requirement
      : null,
    isActive: r.is_active!,
    sortOrder: r.sort_order!,
  }));
}

export async function unlockCosmetic(userId: number, cosmeticId: number): Promise<void> {
  await execute(
    'INSERT IGNORE INTO user_cosmetics (user_id, cosmetic_id) VALUES (?, ?)',
    [userId, cosmeticId],
  );
}

export async function getEquippedCosmetics(userId: number): Promise<EquippedCosmetics> {
  const rows = await query<UserEquippedCosmeticsRow[]>(
    'SELECT * FROM user_equipped_cosmetics WHERE user_id = ?',
    [userId],
  );

  if (rows.length === 0) {
    return { colorId: null, eyesId: null, trailId: null, bombSkinId: null };
  }

  return {
    colorId: rows[0].color_id,
    eyesId: rows[0].eyes_id,
    trailId: rows[0].trail_id,
    bombSkinId: rows[0].bomb_skin_id,
  };
}

export async function equipCosmetic(
  userId: number,
  slot: CosmeticType,
  cosmeticId: number | null,
): Promise<void> {
  // If equipping (not unequipping), verify user owns the cosmetic
  if (cosmeticId !== null) {
    const [owned] = await query<CountRow[]>(
      'SELECT COUNT(*) as total FROM user_cosmetics WHERE user_id = ? AND cosmetic_id = ?',
      [userId, cosmeticId],
    );
    if (owned.total === 0) {
      throw new Error('You do not own this cosmetic');
    }

    // Verify cosmetic type matches slot
    const cosmetic = await getCosmeticById(cosmeticId);
    if (!cosmetic || cosmetic.type !== slot) {
      throw new Error('Cosmetic type does not match slot');
    }
  }

  const columnMap: Record<CosmeticType, string> = {
    color: 'color_id',
    eyes: 'eyes_id',
    trail: 'trail_id',
    bomb_skin: 'bomb_skin_id',
  };

  const column = columnMap[slot];
  await execute(
    `INSERT INTO user_equipped_cosmetics (user_id, ${column})
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE ${column} = ?`,
    [userId, cosmeticId, cosmeticId],
  );
}

export async function getPlayerCosmeticsForGame(
  userIds: number[],
): Promise<Map<number, PlayerCosmeticData>> {
  const result = new Map<number, PlayerCosmeticData>();
  if (userIds.length === 0) return result;

  const placeholders = userIds.map(() => '?').join(',');

  interface EquipRow extends RowDataPacket {
    user_id: number;
    color_config: string | null;
    eyes_config: string | null;
    trail_config: string | null;
    bomb_skin_config: string | null;
  }

  const rows = await query<EquipRow[]>(
    `SELECT ue.user_id,
            cc.config as color_config,
            ec.config as eyes_config,
            tc.config as trail_config,
            bc.config as bomb_skin_config
     FROM user_equipped_cosmetics ue
     LEFT JOIN cosmetics cc ON cc.id = ue.color_id
     LEFT JOIN cosmetics ec ON ec.id = ue.eyes_id
     LEFT JOIN cosmetics tc ON tc.id = ue.trail_id
     LEFT JOIN cosmetics bc ON bc.id = ue.bomb_skin_id
     WHERE ue.user_id IN (${placeholders})`,
    userIds,
  );

  for (const row of rows) {
    const data: PlayerCosmeticData = {};

    if (row.color_config) {
      const colorConf = typeof row.color_config === 'string' ? JSON.parse(row.color_config) : row.color_config;
      if (colorConf.hex !== undefined) {
        data.colorHex = typeof colorConf.hex === 'string' ? parseInt(colorConf.hex, 16) : colorConf.hex;
      }
    }

    if (row.eyes_config) {
      const eyesConf = typeof row.eyes_config === 'string' ? JSON.parse(row.eyes_config) : row.eyes_config;
      if (eyesConf.style) data.eyeStyle = eyesConf.style;
    }

    if (row.trail_config) {
      const trailConf = typeof row.trail_config === 'string' ? JSON.parse(row.trail_config) : row.trail_config;
      if (trailConf.particleKey) {
        data.trailConfig = {
          particleKey: trailConf.particleKey,
          tint: trailConf.tint ?? 0xffffff,
          frequency: trailConf.frequency ?? 50,
        };
      }
    }

    if (row.bomb_skin_config) {
      const bombConf = typeof row.bomb_skin_config === 'string' ? JSON.parse(row.bomb_skin_config) : row.bomb_skin_config;
      if (bombConf.baseColor !== undefined) {
        data.bombSkinConfig = {
          baseColor: bombConf.baseColor,
          fuseColor: bombConf.fuseColor ?? 0xff4444,
          label: bombConf.label ?? 'custom',
        };
      }
    }

    // Only add if any cosmetic is set
    if (Object.keys(data).length > 0) {
      result.set(row.user_id, data);
    }
  }

  return result;
}

export async function unlockDefaultCosmetics(userId: number): Promise<void> {
  await execute(
    `INSERT IGNORE INTO user_cosmetics (user_id, cosmetic_id)
     SELECT ?, id FROM cosmetics WHERE unlock_type = 'default'`,
    [userId],
  );
}

export async function checkCampaignStarUnlocks(userId: number, totalStars: number): Promise<number[]> {
  interface UnlockableRow extends RowDataPacket {
    id: number;
    unlock_requirement: string;
  }

  const rows = await query<UnlockableRow[]>(
    `SELECT c.id, c.unlock_requirement FROM cosmetics c
     LEFT JOIN user_cosmetics uc ON uc.cosmetic_id = c.id AND uc.user_id = ?
     WHERE c.unlock_type = 'campaign_stars' AND c.is_active = TRUE AND uc.user_id IS NULL`,
    [userId],
  );

  const unlockedIds: number[] = [];

  for (const row of rows) {
    const req = typeof row.unlock_requirement === 'string' ? JSON.parse(row.unlock_requirement) : row.unlock_requirement;
    if (req?.totalStars !== undefined && totalStars >= req.totalStars) {
      await unlockCosmetic(userId, row.id);
      unlockedIds.push(row.id);
    }
  }

  return unlockedIds;
}

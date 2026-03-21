import { query, execute } from '../db/connection';
import { BuddySettingsRow } from '../db/types';
import type { BuddySettings } from '@blast-arena/shared';

const DEFAULTS: BuddySettings = {
  name: 'Buddy',
  color: '#44aaff',
  size: 0.6,
};

export async function getBuddySettings(userId: number): Promise<BuddySettings> {
  const rows = await query<BuddySettingsRow[]>('SELECT * FROM buddy_settings WHERE user_id = ?', [
    userId,
  ]);
  if (rows.length === 0) return { ...DEFAULTS };
  return {
    name: rows[0].buddy_name,
    color: rows[0].buddy_color,
    size: Number(rows[0].buddy_size),
  };
}

export async function saveBuddySettings(
  userId: number,
  settings: Partial<BuddySettings>,
): Promise<void> {
  const current = await getBuddySettings(userId);
  const merged = { ...current, ...settings };
  await execute(
    `INSERT INTO buddy_settings (user_id, buddy_name, buddy_color, buddy_size)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       buddy_name = VALUES(buddy_name),
       buddy_color = VALUES(buddy_color),
       buddy_size = VALUES(buddy_size)`,
    [userId, merged.name, merged.color, merged.size],
  );
}

import { query, execute } from '../db/connection';
import { SettingRow } from '../db/types';

export async function getSetting(key: string): Promise<string | null> {
  const rows = await query<SettingRow[]>(
    'SELECT setting_value FROM server_settings WHERE setting_key = ?',
    [key],
  );
  return rows.length > 0 ? rows[0].setting_value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await execute(
    'INSERT INTO server_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
    [key, value, value],
  );
}

export async function isRecordingEnabled(): Promise<boolean> {
  const value = await getSetting('recordings_enabled');
  return value !== 'false';
}

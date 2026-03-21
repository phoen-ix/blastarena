import { query, execute } from '../db/connection';
import { SettingRow } from '../db/types';
import { GameDefaults, SimulationDefaults, EmailSettings, ChatMode } from '@blast-arena/shared';

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

export async function isRegistrationEnabled(): Promise<boolean> {
  const value = await getSetting('registration_enabled');
  return value !== 'false';
}

export async function getGameDefaults(): Promise<GameDefaults> {
  const value = await getSetting('game_defaults');
  if (!value) return {};
  try {
    return JSON.parse(value) as GameDefaults;
  } catch {
    return {};
  }
}

export async function setGameDefaults(defaults: GameDefaults): Promise<void> {
  await setSetting('game_defaults', JSON.stringify(defaults));
}

export async function getSimulationDefaults(): Promise<SimulationDefaults> {
  const value = await getSetting('simulation_defaults');
  if (!value) return {};
  try {
    return JSON.parse(value) as SimulationDefaults;
  } catch {
    return {};
  }
}

export async function setSimulationDefaults(defaults: SimulationDefaults): Promise<void> {
  await setSetting('simulation_defaults', JSON.stringify(defaults));
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const value = await getSetting('email_settings');
  if (!value) return {};
  try {
    return JSON.parse(value) as EmailSettings;
  } catch {
    return {};
  }
}

export async function setEmailSettings(settings: EmailSettings): Promise<void> {
  await setSetting('email_settings', JSON.stringify(settings));
}

const VALID_CHAT_MODES: ChatMode[] = ['everyone', 'staff', 'admin_only', 'disabled'];

export async function getChatMode(): Promise<ChatMode> {
  const value = await getSetting('party_chat_mode');
  if (value && VALID_CHAT_MODES.includes(value as ChatMode)) {
    return value as ChatMode;
  }
  return 'everyone';
}

export async function getLobbyChatMode(): Promise<ChatMode> {
  const value = await getSetting('lobby_chat_mode');
  if (value && VALID_CHAT_MODES.includes(value as ChatMode)) {
    return value as ChatMode;
  }
  return 'everyone';
}

export async function getDMMode(): Promise<ChatMode> {
  const value = await getSetting('dm_mode');
  if (value && VALID_CHAT_MODES.includes(value as ChatMode)) {
    return value as ChatMode;
  }
  return 'everyone';
}

export async function getEmoteMode(): Promise<ChatMode> {
  const value = await getSetting('emote_mode');
  if (value && VALID_CHAT_MODES.includes(value as ChatMode)) {
    return value as ChatMode;
  }
  return 'everyone';
}

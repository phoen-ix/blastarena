import { query, execute } from '../db/connection';
import { SettingRow } from '../db/types';
import {
  GameDefaults,
  SimulationDefaults,
  EmailSettings,
  ChatMode,
  RankConfig,
  DEFAULT_RANK_CONFIG,
} from '@blast-arena/shared';

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

export async function isSpectatorActionsEnabled(): Promise<boolean> {
  const value = await getSetting('spectator_actions_enabled');
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

export async function getSpectatorChatMode(): Promise<ChatMode> {
  const value = await getSetting('spectator_chat_mode');
  if (value && VALID_CHAT_MODES.includes(value as ChatMode)) {
    return value as ChatMode;
  }
  return 'everyone';
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

export async function setRankConfig(config: RankConfig): Promise<void> {
  await setSetting('rank_tiers', JSON.stringify(config));
}

// Open World settings
export interface OpenWorldSettings {
  enabled: boolean;
  guestAccess: boolean;
  maxPlayers: number;
  roundTime: number;
  mapWidth: number;
  mapHeight: number;
  wallDensity: number;
  respawnDelay: number;
  afkTimeoutSeconds: number;
}

export async function getOpenWorldSettings(): Promise<OpenWorldSettings> {
  const keys = [
    'open_world_enabled',
    'open_world_guest_access',
    'open_world_max_players',
    'open_world_round_time',
    'open_world_map_width',
    'open_world_map_height',
    'open_world_wall_density',
    'open_world_respawn_delay',
    'open_world_afk_timeout',
  ];
  const rows = await query<SettingRow[]>(
    `SELECT setting_key, setting_value FROM server_settings WHERE setting_key IN (${keys.map(() => '?').join(',')})`,
    keys,
  );
  const map = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
  return {
    enabled: map.get('open_world_enabled') !== 'false',
    guestAccess: map.get('open_world_guest_access') !== 'false',
    maxPlayers: parseInt(map.get('open_world_max_players') ?? '32', 10),
    roundTime: parseInt(map.get('open_world_round_time') ?? '300', 10),
    mapWidth: parseInt(map.get('open_world_map_width') ?? '51', 10),
    mapHeight: parseInt(map.get('open_world_map_height') ?? '41', 10),
    wallDensity: parseFloat(map.get('open_world_wall_density') ?? '0.5'),
    respawnDelay: parseInt(map.get('open_world_respawn_delay') ?? '3', 10),
    afkTimeoutSeconds: parseInt(map.get('open_world_afk_timeout') ?? '60', 10),
  };
}

export async function isOpenWorldEnabled(): Promise<boolean> {
  const value = await getSetting('open_world_enabled');
  return value !== 'false';
}

export async function isOpenWorldGuestAccessEnabled(): Promise<boolean> {
  const value = await getSetting('open_world_guest_access');
  return value !== 'false';
}

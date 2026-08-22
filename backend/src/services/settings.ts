import { query, execute } from '../db/connection';
import { SettingRow } from '../db/types';
import {
  GameDefaults,
  SimulationDefaults,
  EmailSettings,
  ChatMode,
  RankConfig,
  DEFAULT_RANK_CONFIG,
  OPENWORLD_DEFAULT_MAP_WIDTH,
  OPENWORLD_DEFAULT_MAP_HEIGHT,
  OPENWORLD_DEFAULT_WALL_DENSITY,
  OPENWORLD_DEFAULT_MAX_PLAYERS,
  OPENWORLD_DEFAULT_ROUND_TIME,
  OPENWORLD_DEFAULT_AFK_TIMEOUT,
  OPENWORLD_RESPAWN_TICKS,
  TICK_RATE,
} from '@blast-arena/shared';

/**
 * Short-lived cache over server_settings.
 *
 * Chat modes, the emote mode and the spectator toggles are read on the hot path — every lobby or
 * party message, every emote, every spectator action did a `SELECT setting_value` before the
 * rate-limit outcome was even used. At the emote limiter's 5/s across eight players in each of
 * several rooms that is a per-event database round-trip for a value that changes maybe once a
 * month. (audit SETTINGS-CACHE-1)
 *
 * The TTL is deliberately short, and setSetting refreshes the entry immediately, so admin changes
 * still take effect at once and the hot-reloadable settings stay hot-reloadable.
 */
const SETTING_CACHE_TTL_MS = 5000;
const settingCache = new Map<string, { value: string | null; at: number }>();

/** Drop cached settings. Exported for tests and for an explicit admin-side refresh. */
export function clearSettingCache(key?: string): void {
  if (key === undefined) settingCache.clear();
  else settingCache.delete(key);
}

export async function getSetting(key: string): Promise<string | null> {
  const cached = settingCache.get(key);
  const now = Date.now();
  if (cached && now - cached.at < SETTING_CACHE_TTL_MS) return cached.value;

  const rows = await query<SettingRow[]>(
    'SELECT setting_value FROM server_settings WHERE setting_key = ?',
    [key],
  );
  const value = rows.length > 0 ? rows[0].setting_value : null;
  settingCache.set(key, { value, at: now });
  return value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await execute(
    'INSERT INTO server_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
    [key, value, value],
  );
  // Reflect the write immediately rather than waiting out the TTL.
  settingCache.set(key, { value, at: Date.now() });
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
  // Fallbacks come from the shared constants rather than repeating their values as string
  // literals here. The OPENWORLD_DEFAULT_* constants existed for exactly this and had no
  // references at all, because the numbers had been duplicated inline — so the two could silently
  // disagree about what "default" means. (audit OPENWORLD-DEFAULTS-1)
  const num = (key: string, fallback: number) => {
    const raw = map.get(key);
    const parsed = raw !== undefined ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    enabled: map.get('open_world_enabled') !== 'false',
    guestAccess: map.get('open_world_guest_access') !== 'false',
    maxPlayers: num('open_world_max_players', OPENWORLD_DEFAULT_MAX_PLAYERS),
    roundTime: num('open_world_round_time', OPENWORLD_DEFAULT_ROUND_TIME),
    mapWidth: num('open_world_map_width', OPENWORLD_DEFAULT_MAP_WIDTH),
    mapHeight: num('open_world_map_height', OPENWORLD_DEFAULT_MAP_HEIGHT),
    wallDensity: num('open_world_wall_density', OPENWORLD_DEFAULT_WALL_DENSITY),
    respawnDelay: num('open_world_respawn_delay', OPENWORLD_RESPAWN_TICKS / TICK_RATE),
    afkTimeoutSeconds: num('open_world_afk_timeout', OPENWORLD_DEFAULT_AFK_TIMEOUT),
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

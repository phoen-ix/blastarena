import { TICK_RATE } from './game';

// Map defaults
export const OPENWORLD_DEFAULT_MAP_WIDTH = 51;
export const OPENWORLD_DEFAULT_MAP_HEIGHT = 41;
export const OPENWORLD_DEFAULT_WALL_DENSITY = 0.5;

// Round timing
export const OPENWORLD_DEFAULT_ROUND_TIME = 300; // seconds
export const OPENWORLD_ROUND_FREEZE_TICKS = 80; // 4 seconds pause between rounds

// Player limits
export const OPENWORLD_DEFAULT_MAX_PLAYERS = 32;
export const OPENWORLD_MAX_PLAYERS_CAP = 50;

// Respawn
export const OPENWORLD_RESPAWN_TICKS = 3 * TICK_RATE; // 3 seconds
export const OPENWORLD_RESPAWN_INVULNERABILITY_TICKS = 2 * TICK_RATE; // 2 seconds
export const OPENWORLD_JOIN_INVULNERABILITY_TICKS = 3 * TICK_RATE; // 3 seconds on first join

// Guest ID range: -3000 to -9999
export const OPENWORLD_GUEST_ID_START = -3000;

// Score tracking: batch DB writes every N ticks
export const OPENWORLD_STATS_FLUSH_TICKS = 10 * TICK_RATE; // 10 seconds

// AFK timeout
export const OPENWORLD_DEFAULT_AFK_TIMEOUT = 60; // seconds
export const OPENWORLD_AFK_CHECK_TICKS = 5 * TICK_RATE; // check every 5 seconds

// Info broadcast interval
export const OPENWORLD_INFO_BROADCAST_TICKS = 5 * TICK_RATE; // 5 seconds

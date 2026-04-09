export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE; // 50ms
export const TILE_SIZE = 48; // pixels

// Map defaults
export const DEFAULT_MAP_WIDTH = 15;
export const DEFAULT_MAP_HEIGHT = 13;
export const DEFAULT_WALL_DENSITY = 0.65;
export const DEFAULT_POWERUP_DROP_RATE = 0.3;
export const SPAWN_CLEAR_RADIUS = 2;

// Player defaults
export const DEFAULT_SPEED = 1;
export const DEFAULT_MAX_BOMBS = 1;
export const DEFAULT_FIRE_RANGE = 1;
export const MAX_SPEED = 3;
export const MAX_BOMBS = 8;
export const MAX_FIRE_RANGE = 8;

// Movement cooldown (in ticks) - higher = slower
// At speed 1: 5 ticks (4 moves/sec), speed 2 (max): 4 ticks (5 moves/sec)
export const MOVE_COOLDOWN_BASE = 5;

// Bomb throw
export const BOMB_THROW_RANGE = 3; // base throw range in tiles

// Timings (in ticks at 20 tps)
export const BOMB_TIMER_TICKS = 60; // 3 seconds
export const EXPLOSION_DURATION_TICKS = 10; // 0.5 seconds
export const COUNTDOWN_SECONDS = 3;
export const INVULNERABILITY_TICKS = 40; // 2 seconds after spawn

// Game limits
export const MAX_PLAYERS_PER_ROOM = 8;
export const MIN_PLAYERS_TO_START = 2;
export const MAX_ROOMS = 50;

// Spectator Game Master
export const SPECTATOR_ENERGY_PER_TICK = 1; // 1 energy per tick = 20/sec
export const SPECTATOR_MAX_ENERGY = 100;
export const SPECTATOR_COOLDOWN_TICKS = 20; // 1 second between actions
export const SPECTATOR_WALL_COST = 30;
export const SPECTATOR_METEOR_COST = 50;
export const SPECTATOR_POWERUP_COST = 40;
export const SPECTATOR_SPEED_ZONE_COST = 25;
export const SPECTATOR_WALL_DURATION_TICKS = 200; // 10 seconds at 20 tps
export const SPECTATOR_SPEED_ZONE_DURATION_TICKS = 160; // 8 seconds
export const SPECTATOR_SPAWN_EXCLUSION_RADIUS = 2;
export const SPECTATOR_WARNING_TICKS = 30; // 1.5 second warning before impact

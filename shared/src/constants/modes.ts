export type GameMode =
  | 'ffa'
  | 'teams'
  | 'battle_royale'
  | 'sudden_death'
  | 'deathmatch'
  | 'king_of_the_hill'
  | 'open_world';

export interface GameModeConfig {
  mode: GameMode;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  defaultMapWidth: number;
  defaultMapHeight: number;
  roundTimeSeconds: number;
  teamsCount?: number;
  hasZone?: boolean;
  hasRespawn?: boolean;
  hasHill?: boolean;
}

export const GAME_MODES: Record<GameMode, GameModeConfig> = {
  ffa: {
    mode: 'ffa',
    name: 'Free for All',
    description: 'Last player standing wins',
    minPlayers: 2,
    maxPlayers: 8,
    defaultMapWidth: 31,
    defaultMapHeight: 25,
    roundTimeSeconds: 180,
  },
  teams: {
    mode: 'teams',
    name: 'Teams',
    description: 'Two teams compete - last team standing wins',
    minPlayers: 4,
    maxPlayers: 8,
    defaultMapWidth: 35,
    defaultMapHeight: 25,
    roundTimeSeconds: 240,
    teamsCount: 2,
  },
  battle_royale: {
    mode: 'battle_royale',
    name: 'Battle Royale',
    description: 'Shrinking zone forces players together',
    minPlayers: 4,
    maxPlayers: 8,
    defaultMapWidth: 39,
    defaultMapHeight: 31,
    roundTimeSeconds: 300,
    hasZone: true,
  },
  sudden_death: {
    mode: 'sudden_death',
    name: 'Sudden Death',
    description: 'All maxed out, one hit kills - pure skill',
    minPlayers: 2,
    maxPlayers: 8,
    defaultMapWidth: 25,
    defaultMapHeight: 21,
    roundTimeSeconds: 120,
  },
  deathmatch: {
    mode: 'deathmatch',
    name: 'Deathmatch',
    description: 'Most kills wins - respawn after death',
    minPlayers: 2,
    maxPlayers: 8,
    defaultMapWidth: 35,
    defaultMapHeight: 25,
    roundTimeSeconds: 300,
    hasRespawn: true,
  },
  king_of_the_hill: {
    mode: 'king_of_the_hill',
    name: 'King of the Hill',
    description: 'Control the center zone to score points',
    minPlayers: 2,
    maxPlayers: 8,
    defaultMapWidth: 35,
    defaultMapHeight: 31,
    roundTimeSeconds: 240,
    hasHill: true,
  },
  open_world: {
    mode: 'open_world',
    name: 'Open World',
    description: 'Persistent arena with respawns - join anytime',
    minPlayers: 1,
    maxPlayers: 50,
    defaultMapWidth: 51,
    defaultMapHeight: 41,
    roundTimeSeconds: 300,
    hasRespawn: true,
  },
};

// Battle Royale zone config
export const BR_ZONE_INITIAL_DELAY_SECONDS = 30;
// The shrink interval is derived from the round length — see BattleRoyaleZone.
export const BR_ZONE_SHRINK_AMOUNT = 1;
export const BR_ZONE_MIN_RADIUS = 3;

// Deathmatch config
export const DEATHMATCH_RESPAWN_TICKS = 60; // 3 seconds
export const DEATHMATCH_KILL_TARGET = 15;

// King of the Hill config
export const KOTH_ZONE_SIZE = 3; // 3x3 tiles
export const KOTH_SCORE_TARGET = 100;
export const KOTH_POINTS_PER_SECOND = 2; // awarded for each second of sole control
export const KOTH_HILL_MOVE_INTERVAL = 600; // 30 seconds at 20 tps
export const KOTH_HILL_MOVE_WARNING = 100; // 5 seconds warning

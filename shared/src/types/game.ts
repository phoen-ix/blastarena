import type { PlayerCosmeticData } from './cosmetics';
import type { PuzzleConfig } from './campaign';

export type TileType =
  | 'empty'
  | 'wall'
  | 'destructible'
  | 'spawn'
  | 'destructible_cracked'
  | 'teleporter_a'
  | 'teleporter_b'
  | 'conveyor_up'
  | 'conveyor_down'
  | 'conveyor_left'
  | 'conveyor_right'
  | 'exit'
  | 'goal'
  // Puzzle switches (walkable, campaign only)
  | 'switch_red'
  | 'switch_blue'
  | 'switch_green'
  | 'switch_yellow'
  | 'switch_red_active'
  | 'switch_blue_active'
  | 'switch_green_active'
  | 'switch_yellow_active'
  // Puzzle gates (closed = impassable like walls, open = walkable)
  | 'gate_red'
  | 'gate_blue'
  | 'gate_green'
  | 'gate_yellow'
  | 'gate_red_open'
  | 'gate_blue_open'
  | 'gate_green_open'
  | 'gate_yellow_open'
  // Crumbling floor (walkable once, then collapses to pit)
  | 'crumbling'
  | 'pit'
  // Hazard tiles (campaign only, theme-specific)
  | 'vine'
  | 'quicksand'
  | 'ice'
  | 'lava'
  | 'mud'
  | 'spikes'
  | 'spikes_active'
  | 'dark_rift';

export type HazardTileType = 'vine' | 'quicksand' | 'ice' | 'lava' | 'mud' | 'spikes' | 'dark_rift';

export const HAZARD_TILE_TYPES: HazardTileType[] = [
  'vine',
  'quicksand',
  'ice',
  'lava',
  'mud',
  'spikes',
  'dark_rift',
];

export type MapEventType =
  | 'meteor'
  | 'powerup_rain'
  | 'wall_collapse'
  | 'freeze_wave'
  | 'bomb_surge'
  | 'ufo_abduction';

export type PuzzleTileCategory = 'switches_and_gates' | 'crumbling';

export const PUZZLE_TILE_CATEGORIES: PuzzleTileCategory[] = ['switches_and_gates', 'crumbling'];

export const MAP_EVENT_TYPES: MapEventType[] = [
  'meteor',
  'powerup_rain',
  'wall_collapse',
  'freeze_wave',
  'bomb_surge',
  'ufo_abduction',
];

export interface Tile {
  x: number;
  y: number;
  type: TileType;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export type PowerUpType =
  | 'bomb_up'
  | 'fire_up'
  | 'speed_up'
  | 'shield'
  | 'kick'
  | 'pierce_bomb'
  | 'remote_bomb'
  | 'line_bomb'
  | 'bomb_throw';

export interface Position {
  x: number;
  y: number;
}

export type KillCause =
  | 'bomb'
  | 'zone'
  | 'lava'
  | 'quicksand'
  | 'spikes'
  | 'dark_rift'
  | 'disconnect'
  | 'self';

export interface PlayerState {
  id: number;
  username: string;
  position: Position;
  alive: boolean;
  bombCount: number;
  maxBombs: number;
  fireRange: number;
  speed: number;
  hasShield: boolean;
  hasKick: boolean;
  hasPierceBomb: boolean;
  hasRemoteBomb: boolean;
  hasLineBomb: boolean;
  hasBombThrow: boolean;
  remoteDetonateMode?: 'all' | 'fifo';
  team: number | null;
  direction: Direction;
  isBot: boolean;
  kills: number;
  deaths: number;
  cosmetics?: PlayerCosmeticData;
  isBuddy?: boolean;
  buddyOwnerId?: number;
}

export interface BombState {
  id: string;
  position: Position;
  ownerId: number;
  fireRange: number;
  ticksRemaining: number;
  bombType: 'normal' | 'remote' | 'pierce';
}

export interface ExplosionState {
  id: string;
  cells: Position[];
  ownerId: number;
  ticksRemaining: number;
}

export interface PowerUpState {
  id: string;
  position: Position;
  type: PowerUpType;
}

export interface TileDiff {
  x: number;
  y: number;
  type: TileType;
}

export interface GameMap {
  width: number;
  height: number;
  tiles: TileType[][];
  spawnPoints: Position[];
  seed: number;
  puzzleConfig?: PuzzleConfig;
  wrapping?: boolean;
}

export interface HillZone {
  x: number;
  y: number;
  width: number;
  height: number;
  controllingPlayer: number | null;
  controllingTeam: number | null;
}

export interface MapEvent {
  type:
    | 'meteor'
    | 'powerup_rain'
    | 'wall_collapse'
    | 'freeze_wave'
    | 'bomb_surge'
    | 'hill_move'
    | 'ufo_abduction'
    | 'spectator_wall'
    | 'spectator_powerup'
    | 'spectator_speed_zone';
  position?: Position;
  tick: number;
  warningTick?: number;
  direction?: 'row' | 'column';
  index?: number;
  targetPlayerId?: number;
}

export type SpectatorActionType = 'place_wall' | 'trigger_meteor' | 'drop_powerup' | 'speed_zone';

export interface SpectatorEnergyState {
  playerId: number;
  energy: number;
  maxEnergy: number;
  cooldownTicksRemaining: number;
}

export interface GameState {
  tick: number;
  players: PlayerState[];
  bombs: BombState[];
  explosions: ExplosionState[];
  powerUps: PowerUpState[];
  map: GameMap;
  /** Tile diffs since last tick (omitted when no tiles changed). When present, client applies these instead of full map.tiles. */
  tileDiffs?: TileDiff[];
  zone?: ZoneState;
  hillZone?: HillZone;
  pendingHillZone?: HillZone;
  kothScores?: Record<number, number>;
  mapEvents?: MapEvent[];
  spectatorEnergy?: SpectatorEnergyState[];
  spectatorActions?: boolean;
  status: 'countdown' | 'playing' | 'finished';
  winnerId: number | null;
  winnerTeam: number | null;
  roundTime: number;
  timeElapsed: number;
  isOpenWorld?: boolean;
}

/** Score entry for open world leaderboard */
export interface OpenWorldScoreEntry {
  playerId: number;
  username: string;
  kills: number;
  deaths: number;
  score: number;
  isGuest: boolean;
}

export interface ZoneState {
  currentRadius: number;
  targetRadius: number;
  centerX: number;
  centerY: number;
  shrinkRate: number;
  nextShrinkTick: number;
}

export interface PlayerInput {
  seq: number;
  direction: Direction | null;
  action: 'bomb' | 'detonate' | 'throw' | null;
  tick: number;
}

import type { PlayerCosmeticData } from './cosmetics';

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
  | 'goal';

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
  | 'line_bomb';

export interface Position {
  x: number;
  y: number;
}

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
  type: 'meteor' | 'powerup_rain';
  position?: Position;
  tick: number;
  warningTick?: number;
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
  kothScores?: Record<number, number>;
  mapEvents?: MapEvent[];
  status: 'countdown' | 'playing' | 'finished';
  winnerId: number | null;
  winnerTeam: number | null;
  roundTime: number;
  timeElapsed: number;
}

export interface ZoneState {
  currentRadius: number;
  targetRadius: number;
  centerX: number;
  centerY: number;
  shrinkRate: number;
  damagePerTick: number;
  nextShrinkTick: number;
}

export interface PlayerInput {
  seq: number;
  direction: Direction | null;
  action: 'bomb' | 'detonate' | null;
  tick: number;
}

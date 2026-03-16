import {
  GameState,
  GameMap,
  PlayerState,
  BombState,
  ExplosionState,
  PowerUpState,
  ZoneState,
  HillZone,
  MapEvent,
  TileType,
  Position,
} from './game';

export type ReplayLogEventType =
  | 'kill'
  | 'bomb_place'
  | 'bomb_detonate'
  | 'bot_decision'
  | 'movement'
  | 'powerup_pickup'
  | 'explosion_detail'
  | 'game_over';

export interface ReplayLogEntry {
  tick: number;
  event: ReplayLogEventType;
  data: Record<string, unknown>;
}

export interface ReplayTickEvents {
  explosions: { cells: Position[]; ownerId: number }[];
  playerDied: { playerId: number; killerId: number | null }[];
  powerupCollected: {
    playerId: number;
    type: string;
    position: Position;
  }[];
}

export interface ReplayTileDiff {
  x: number;
  y: number;
  type: TileType;
}

export interface ReplayFrame {
  tick: number;
  players: PlayerState[];
  bombs: BombState[];
  explosions: ExplosionState[];
  powerUps: PowerUpState[];
  zone?: ZoneState;
  hillZone?: HillZone;
  kothScores?: Record<number, number>;
  mapEvents?: MapEvent[];
  status: GameState['status'];
  winnerId: number | null;
  winnerTeam: number | null;
  roundTime: number;
  timeElapsed: number;
  tileDiffs?: ReplayTileDiff[];
  events?: ReplayTickEvents;
}

export interface ReplayData {
  version: 1;
  matchId: number;
  roomCode: string;
  gameMode: string;
  config: {
    mapWidth: number;
    mapHeight: number;
    roundTime: number;
    wallDensity?: number;
    friendlyFire?: boolean;
    reinforcedWalls?: boolean;
    enableMapEvents?: boolean;
    hazardTiles?: boolean;
    botDifficulty?: string;
    botCount?: number;
  };
  gameOver: {
    winnerId: number | null;
    winnerTeam: number | null;
    reason: string;
    placements: {
      userId: number;
      username: string;
      isBot: boolean;
      placement: number;
      kills: number;
      selfKills: number;
      team: number | null;
      alive: boolean;
    }[];
  };
  map: GameMap;
  totalTicks: number;
  tickRate: number;
  frames: ReplayFrame[];
  log: ReplayLogEntry[];
}

export interface ReplayListItem {
  matchId: number;
  roomCode: string;
  gameMode: string;
  duration: number;
  playerCount: number;
  winnerName: string | null;
  createdAt: string;
  fileSizeKB: number;
}

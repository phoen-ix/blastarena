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
import { CampaignEnemyState, EnemyTypeEntry, CampaignWinCondition } from './campaign';

export type ReplayLogEventType =
  | 'kill'
  | 'bomb_place'
  | 'bomb_detonate'
  | 'bot_decision'
  | 'movement'
  | 'powerup_pickup'
  | 'explosion_detail'
  | 'player_leave'
  | 'player_disconnect'
  | 'player_disconnect_kill'
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
  bombThrown?: { bombId: string; from: Position; to: Position }[];
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
  // Campaign-specific fields (only present for campaign replays)
  enemies?: CampaignEnemyState[];
  lives?: number;
  exitOpen?: boolean;
}

export interface CampaignReplayMeta {
  levelId: number;
  levelName: string;
  worldId: number;
  worldName: string;
  coopMode: boolean;
  buddyMode?: boolean;
  theme?: string;
  enemyTypes: EnemyTypeEntry[];
  lives: number;
  winCondition: CampaignWinCondition;
  timeLimit: number;
}

export interface ReplayData {
  version: 1;
  matchId: number;
  sessionId?: string;
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
  campaign?: CampaignReplayMeta;
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

export interface CampaignReplayListItem {
  sessionId: string;
  levelId: number;
  levelName: string;
  worldName: string;
  userId: number;
  username: string;
  coopMode: boolean;
  buddyMode: boolean;
  duration: number;
  result: 'completed' | 'failed';
  stars: number;
  createdAt: string;
  fileSizeKB: number;
}

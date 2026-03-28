import { GameMode } from '../constants/modes';
import { PowerUpType } from '../types/game';
import { PublicUser } from './auth';

export interface MatchConfig {
  gameMode: GameMode;
  maxPlayers: number;
  mapWidth: number;
  mapHeight: number;
  mapSeed?: number;
  roundTime: number;
  teams?: number;
  wallDensity?: number;
  enabledPowerUps?: PowerUpType[];
  powerUpDropRate?: number;
  botCount?: number;
  botDifficulty?: 'easy' | 'normal' | 'hard';
  botTeams?: (number | null)[];
  friendlyFire?: boolean;
  hazardTiles?: boolean;
  selectedHazardTiles?: string[];
  enableMapEvents?: boolean;
  selectedMapEvents?: string[];
  reinforcedWalls?: boolean;
  recordGame?: boolean;
  botAiId?: string;
  customMapId?: number;
}

export interface RoomPlayer {
  user: PublicUser;
  ready: boolean;
  team: number | null;
}

export interface Room {
  code: string;
  name: string;
  host: PublicUser;
  players: RoomPlayer[];
  config: MatchConfig;
  status: 'waiting' | 'countdown' | 'playing' | 'finished';
  createdAt: Date;
  customMapName?: string;
}

export interface CreateRoomRequest {
  name: string;
  config: MatchConfig;
}

export interface RoomListItem {
  code: string;
  name: string;
  host: string;
  playerCount: number;
  maxPlayers: number;
  gameMode: GameMode;
  status: 'waiting' | 'playing';
  customMapName?: string;
}

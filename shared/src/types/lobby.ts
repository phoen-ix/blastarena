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
  friendlyFire?: boolean;
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
}

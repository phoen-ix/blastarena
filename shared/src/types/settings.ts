import { GameMode } from '../constants/modes';
import { PowerUpType } from './game';
import { SimulationSpeed, LogVerbosity } from './simulation';

export interface GameDefaults {
  gameMode?: GameMode;
  maxPlayers?: number;
  roundTime?: number;
  mapWidth?: number;
  wallDensity?: number;
  powerUpDropRate?: number;
  botCount?: number;
  botDifficulty?: 'easy' | 'normal' | 'hard';
  reinforcedWalls?: boolean;
  enableMapEvents?: boolean;
  hazardTiles?: boolean;
  friendlyFire?: boolean;
  enabledPowerUps?: PowerUpType[];
  botAiId?: string;
}

export interface SimulationDefaults extends GameDefaults {
  totalGames?: number;
  speed?: SimulationSpeed;
  logVerbosity?: LogVerbosity;
  recordReplays?: boolean;
}

export interface EmailSettings {
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  fromEmail?: string;
  fromName?: string;
}

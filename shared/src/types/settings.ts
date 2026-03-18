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
}

export interface SimulationDefaults extends GameDefaults {
  totalGames?: number;
  speed?: SimulationSpeed;
  logVerbosity?: LogVerbosity;
  recordReplays?: boolean;
}

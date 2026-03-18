import { GameMode } from '../constants/modes';
import { PowerUpType } from './game';

export type LogVerbosity = 'normal' | 'detailed' | 'full';
export type SimulationSpeed = 'fast' | 'realtime';

export interface SimulationConfig {
  gameMode: GameMode;
  botCount: number;
  botDifficulty: 'easy' | 'normal' | 'hard';
  mapWidth: number;
  mapHeight: number;
  roundTime: number;
  wallDensity: number;
  enabledPowerUps: PowerUpType[];
  powerUpDropRate: number;
  friendlyFire: boolean;
  hazardTiles: boolean;
  reinforcedWalls: boolean;
  enableMapEvents: boolean;
  totalGames: number;
  speed: SimulationSpeed;
  logVerbosity: LogVerbosity;
  botTeams?: (number | null)[];
  recordReplays?: boolean;
}

export interface SimulationBatchStatus {
  batchId: string;
  config: SimulationConfig;
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'error';
  queuePosition?: number | null;
  gamesCompleted: number;
  totalGames: number;
  currentGameTick: number | null;
  currentGameMaxTicks: number | null;
  startedAt: string;
  completedAt: string | null;
  error?: string;
}

export interface SimulationGameResult {
  gameIndex: number;
  winnerId: number | null;
  winnerName: string | null;
  finishReason: string;
  durationTicks: number;
  durationSeconds: number;
  mapSeed: number;
  hasReplay?: boolean;
  placements: Array<{
    id: number;
    name: string;
    kills: number;
    selfKills: number;
    deaths: number;
    placement: number;
    alive: boolean;
    team: number | null;
    bombsPlaced: number;
    powerupsCollected: number;
  }>;
}

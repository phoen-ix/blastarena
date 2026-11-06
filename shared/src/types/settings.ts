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
  puzzleTiles?: boolean;
  enableSpectatorActions?: boolean;
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

export type ChatMode = 'everyone' | 'staff' | 'admin_only' | 'disabled';

/** `starttls`: STARTTLS required; `tls`: implicit TLS; `none`: plaintext (local catchers only). */
export const SMTP_SECURITY_MODES = ['starttls', 'tls', 'none'] as const;
export type SmtpSecurity = (typeof SMTP_SECURITY_MODES)[number];

/** The Security setting before an admin picks one: implicit TLS on 465, STARTTLS elsewhere. */
export function defaultSmtpSecurity(port: number): SmtpSecurity {
  return port === 465 ? 'tls' : 'starttls';
}

export interface EmailSettings {
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  /** Unset: `tls` on port 465, else `starttls`. */
  smtpSecurity?: SmtpSecurity;
  /** EHLO hostname; unset means the From Email domain. */
  ehloName?: string;
  fromEmail?: string;
  fromName?: string;
}

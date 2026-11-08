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

/**
 * Whether a user of `role` may use a chat feature set to `mode`. One rule for every chat feature
 * (lobby, party, DMs, emotes, spectator chat) on both client and server; it was written out nine
 * times. An unknown mode allows nothing.
 */
export function chatModeAllows(mode: ChatMode, role: string | null | undefined): boolean {
  switch (mode) {
    case 'everyone':
      return true;
    case 'staff':
      return role === 'admin' || role === 'moderator';
    case 'admin_only':
      return role === 'admin';
    default:
      return false;
  }
}

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

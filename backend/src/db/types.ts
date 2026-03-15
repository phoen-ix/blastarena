import { RowDataPacket } from 'mysql2';

/** Generic count row for SELECT COUNT(*) queries */
export interface CountRow extends RowDataPacket {
  total: number;
}

/** Simple id row for existence checks */
export interface IdRow extends RowDataPacket {
  id: number;
}

/** User table row */
export interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  role: string;
  email_verified: boolean;
  is_deactivated: boolean;
  deactivated_at: Date | null;
  last_login: Date | null;
  created_at: Date;
  updated_at: Date;
  pending_email: string | null;
  email_change_token: string | null;
  email_change_expires: Date | null;
}

/** Refresh token joined with user */
export interface RefreshTokenJoinRow extends RowDataPacket {
  id: number;
  user_id: number;
  expires_at: Date;
  revoked: boolean;
  username: string;
  role: string;
  is_deactivated: boolean;
}

/** User profile joined with stats */
export interface UserProfileRow extends RowDataPacket {
  id: number;
  username: string;
  email: string;
  role: string;
  email_verified: boolean;
  pending_email: string | null;
  created_at: Date;
  total_matches: number | null;
  total_wins: number | null;
  total_kills: number | null;
  total_deaths: number | null;
  total_bombs: number | null;
  total_powerups: number | null;
  total_playtime: number | null;
  win_streak: number | null;
  best_win_streak: number | null;
  elo_rating: number | null;
}

/** User with email change fields */
export interface UserEmailChangeRow extends RowDataPacket {
  id: number;
  pending_email: string;
  email_change_expires: Date;
}

/** Match table row */
export interface MatchRow extends RowDataPacket {
  id: number;
  room_code: string;
  game_mode: string;
  map_seed: number;
  map_width: number;
  map_height: number;
  max_players: number;
  status: string;
  duration: number;
  winner_id: number | null;
  started_at: Date;
  finished_at: Date | null;
  winner_username: string | null;
  player_count: number;
}

/** Match player row */
export interface MatchPlayerRow extends RowDataPacket {
  user_id: number;
  username: string;
  team: number | null;
  placement: number;
  kills: number;
  deaths: number;
  bombs_placed: number;
  powerups_collected: number;
  survived_seconds: number;
}

/** Admin action row */
export interface AdminActionRow extends RowDataPacket {
  id: number;
  admin_id: number;
  admin_username: string;
  action: string;
  target_type: string;
  target_id: number;
  details: string | null;
  created_at: Date;
}

/** Admin user list row (user joined with stats) */
export interface AdminUserRow extends RowDataPacket {
  id: number;
  username: string;
  email: string;
  role: string;
  email_verified: boolean;
  is_deactivated: boolean;
  deactivated_at: Date | null;
  last_login: Date | null;
  created_at: Date;
  total_matches: number;
  total_wins: number;
}

import { RowDataPacket } from 'mysql2';

/** Generic count row for SELECT COUNT(*) queries */
export interface CountRow extends RowDataPacket {
  total: number;
}

/** Simple id row for existence checks */
export interface IdRow extends RowDataPacket {
  id: number;
}

/** Id + language row for email queries that need the recipient's language */
export interface IdWithLanguageRow extends RowDataPacket {
  id: number;
  language: string;
}

/** User table row */
export interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  email_hash: string;
  email_hint: string;
  password_hash: string;
  role: string;
  language: string;
  email_verified: boolean;
  is_deactivated: boolean;
  deactivated_at: Date | null;
  last_login: Date | null;
  created_at: Date;
  updated_at: Date;
  pending_email_hash: string | null;
  pending_email_hint: string | null;
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
  language: string;
  is_deactivated: boolean;
}

/** User profile joined with stats */
export interface UserProfileRow extends RowDataPacket {
  id: number;
  username: string;
  email_hint: string;
  role: string;
  email_verified: boolean;
  pending_email_hint: string | null;
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
  peak_elo: number | null;
  total_xp: number | null;
  level: number | null;
  is_profile_public: boolean;
  accept_friend_requests: boolean;
}

/** User with email change fields */
export interface UserEmailChangeRow extends RowDataPacket {
  id: number;
  pending_email_hash: string;
  pending_email_hint: string;
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

/** Bot AI row */
export interface BotAIRow extends RowDataPacket {
  id: string;
  name: string;
  description: string;
  filename: string;
  is_builtin: boolean;
  is_active: boolean;
  uploaded_by: number | null;
  uploaded_at: Date;
  version: number;
  file_size: number;
  uploader_username?: string;
}

/** Enemy AI row */
export interface EnemyAIRow extends RowDataPacket {
  id: string;
  name: string;
  description: string;
  filename: string;
  is_active: boolean;
  uploaded_by: number | null;
  uploaded_at: Date;
  version: number;
  file_size: number;
  uploader_username?: string;
}

/** Server settings row */
export interface SettingRow extends RowDataPacket {
  setting_value: string;
}

/** Campaign enemy type row */
export interface CampaignEnemyTypeRow extends RowDataPacket {
  id: number;
  name: string;
  description: string;
  config: string; // JSON string
  is_boss: boolean;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
}

/** Campaign world row */
export interface CampaignWorldRow extends RowDataPacket {
  id: number;
  name: string;
  description: string;
  sort_order: number;
  theme: string;
  is_published: boolean;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
  level_count?: number;
  completed_count?: number;
}

/** Campaign level row */
export interface CampaignLevelRow extends RowDataPacket {
  id: number;
  world_id: number;
  name: string;
  description: string;
  sort_order: number;
  map_width: number;
  map_height: number;
  tiles: string; // JSON string
  fill_mode: 'handcrafted' | 'hybrid';
  wall_density: number;
  player_spawns: string; // JSON string
  enemy_placements: string; // JSON string
  powerup_placements: string; // JSON string
  win_condition: string;
  win_condition_config: string | null; // JSON string
  lives: number;
  time_limit: number;
  par_time: number;
  carry_over_powerups: boolean;
  starting_powerups: string | null; // JSON string
  available_powerup_types: string | null; // JSON string
  powerup_drop_rate: number;
  reinforced_walls: boolean;
  hazard_tiles: boolean;
  covered_tiles: string | null; // JSON string
  puzzle_config: string | null; // JSON string
  is_published: boolean;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
  enemy_count?: number;
}

/** Campaign progress row */
export interface CampaignProgressRow extends RowDataPacket {
  id: number;
  user_id: number;
  level_id: number;
  completed: boolean;
  best_time_seconds: number | null;
  stars: number;
  attempts: number;
  completed_at: Date | null;
  updated_at: Date;
}

/** Campaign user state row */
export interface CampaignUserStateRow extends RowDataPacket {
  user_id: number;
  current_world_id: number | null;
  current_level_id: number | null;
  carried_powerups: string | null; // JSON string
  total_levels_completed: number;
  total_stars: number;
  updated_at: Date;
}

/** Friendship table row */
export interface FriendshipRow extends RowDataPacket {
  id: number;
  user_id: number;
  friend_id: number;
  status: 'pending' | 'accepted';
  created_at: Date;
  updated_at: Date;
  // Joined fields
  username?: string;
}

/** User block table row */
export interface UserBlockRow extends RowDataPacket {
  id: number;
  blocker_id: number;
  blocked_id: number;
  created_at: Date;
  // Joined fields
  username?: string;
}

/** Direct message table row */
export interface DirectMessageRow extends RowDataPacket {
  id: number;
  sender_id: number;
  recipient_id: number;
  message: string;
  read_at: Date | null;
  created_at: Date;
  // Joined fields
  sender_username?: string;
}

/** Season row */
export interface SeasonRow extends RowDataPacket {
  id: number;
  name: string;
  start_date: Date;
  end_date: Date;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Season Elo row */
export interface SeasonEloRow extends RowDataPacket {
  id: number;
  user_id: number;
  season_id: number;
  elo_rating: number;
  peak_elo: number;
  matches_played: number;
  // Joined fields
  username?: string;
  total_wins?: number;
  total_kills?: number;
}

/** Elo history row */
export interface EloHistoryRow extends RowDataPacket {
  id: number;
  user_id: number;
  match_id: number;
  season_id: number | null;
  old_elo: number;
  new_elo: number;
  delta: number;
  game_mode: string;
  created_at: Date;
}

/** Public profile row */
export interface PublicProfileRow extends RowDataPacket {
  id: number;
  username: string;
  role: string;
  created_at: Date;
  is_profile_public: boolean;
  total_matches: number;
  total_wins: number;
  total_kills: number;
  total_deaths: number;
  elo_rating: number;
  peak_elo: number;
  win_streak: number;
  best_win_streak: number;
  total_xp: number;
  level: number;
}

/** Cosmetic row */
export interface CosmeticRow extends RowDataPacket {
  id: number;
  name: string;
  type: string;
  config: string;
  rarity: string;
  unlock_type: string;
  unlock_requirement: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

/** User cosmetic unlock row */
export interface UserCosmeticRow extends RowDataPacket {
  user_id: number;
  cosmetic_id: number;
  unlocked_at: Date;
  // Joined fields from cosmetics table
  name?: string;
  type?: string;
  config?: string;
  rarity?: string;
  unlock_type?: string;
  unlock_requirement?: string | null;
  is_active?: boolean;
  sort_order?: number;
}

/** User equipped cosmetics row */
export interface UserEquippedCosmeticsRow extends RowDataPacket {
  user_id: number;
  color_id: number | null;
  eyes_id: number | null;
  trail_id: number | null;
  bomb_skin_id: number | null;
  updated_at: Date;
}

/** Achievement row */
export interface AchievementRow extends RowDataPacket {
  id: number;
  name: string;
  description: string;
  icon: string;
  category: string;
  condition_type: string;
  condition_config: string;
  reward_type: string;
  reward_id: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

/** User achievement row */
export interface UserAchievementRow extends RowDataPacket {
  user_id: number;
  achievement_id: number;
  unlocked_at: Date | null;
  progress: string | null;
  updated_at: Date;
  // Joined fields from achievements table
  name?: string;
  description?: string;
  icon?: string;
  category?: string;
  condition_type?: string;
  condition_config?: string;
  reward_type?: string;
  reward_id?: number | null;
  is_active?: boolean;
  sort_order?: number;
}

/** Admin user list row (user joined with stats) */
export interface BuddySettingsRow extends RowDataPacket {
  user_id: number;
  buddy_name: string;
  buddy_color: string;
  buddy_size: number;
  updated_at: Date;
}

/** Custom map row */
export interface CustomMapRow extends RowDataPacket {
  id: number;
  name: string;
  description: string;
  map_width: number;
  map_height: number;
  tiles: string; // JSON string
  spawn_points: string; // JSON string
  is_published: boolean;
  created_by: number;
  play_count: number;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  creator_username?: string;
}

export interface AdminUserRow extends RowDataPacket {
  id: number;
  username: string;
  email_hint: string;
  role: string;
  email_verified: boolean;
  is_deactivated: boolean;
  deactivated_at: Date | null;
  last_login: Date | null;
  created_at: Date;
  total_matches: number;
  total_wins: number;
}

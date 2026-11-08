import type { Cosmetic, CosmeticExportData } from './cosmetics';

export type AchievementConditionType = 'cumulative' | 'per_game' | 'mode_specific' | 'campaign';
export type AchievementRewardType = 'cosmetic' | 'title' | 'none';

export interface Achievement {
  id: number;
  name: string;
  description: string;
  icon: string;
  category: string;
  conditionType: AchievementConditionType;
  conditionConfig: Record<string, unknown>;
  rewardType: AchievementRewardType;
  rewardId: number | null;
  isActive: boolean;
  sortOrder: number;
}

/** Comparison operators a `per_game` condition accepts; anything else evaluates as '>='. */
export type PerGameOperator = '>=' | '<=' | '==' | '>' | '<';

/** `conditionConfig` of a `per_game` achievement. */
export interface PerGameConditionConfig {
  /** One of the per-game stats: kills, deaths, self_kills, bombs_placed, powerups_collected,
   * survived_seconds, placement, player_count, is_winner. */
  stat: string;
  operator?: PerGameOperator;
  threshold: number;
  /** Only a won game counts ("Win without self-kills"): without it a lost game met the stat too. */
  requireWin?: boolean;
}

export interface UserAchievement {
  achievementId: number;
  unlockedAt: string | null;
  progress: Record<string, unknown> | null;
}

export interface UserAchievementPublic {
  achievement: Achievement;
  unlockedAt: string;
}

export interface AchievementUnlockEvent {
  achievements: Achievement[];
  rewards: Cosmetic[];
}

export interface GameAchievementData {
  userId: number;
  gameMode: string;
  isWinner: boolean;
  kills: number;
  deaths: number;
  selfKills: number;
  bombsPlaced: number;
  powerupsCollected: number;
  survivedSeconds: number;
  placement: number;
  playerCount: number;
}

export interface AchievementExportData {
  _format: 'blast-arena-achievement';
  _version: 1;
  name: string;
  description: string;
  icon: string;
  category: string;
  conditionType: AchievementConditionType;
  conditionConfig: Record<string, unknown>;
  rewardType: AchievementRewardType;
  reward: Omit<CosmeticExportData, '_format' | '_version'> | null;
  sortOrder: number;
}

export interface AchievementBundleExportData {
  _format: 'blast-arena-achievement-bundle';
  _version: 1;
  achievements: Omit<AchievementExportData, '_format' | '_version'>[];
  cosmetics: { originalId: number; data: Omit<CosmeticExportData, '_format' | '_version'> }[];
}

export interface AchievementImportConflict {
  originalCosmeticId: number;
  cosmeticName: string;
  existingId?: number;
  existingName?: string;
}

export interface AchievementProgress {
  achievementId: number;
  name: string;
  description: string;
  icon: string;
  category: string;
  conditionType: AchievementConditionType;
  current: number;
  threshold: number;
  unlocked: boolean;
  unlockedAt: string | null;
}

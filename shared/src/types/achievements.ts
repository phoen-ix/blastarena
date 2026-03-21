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

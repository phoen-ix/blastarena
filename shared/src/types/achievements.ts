import type { Cosmetic } from './cosmetics';

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

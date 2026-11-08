// XP rewards per action
export const XP_PER_KILL = 50;
export const XP_PER_BOMB = 5;
export const XP_PER_POWERUP = 10;
export const XP_WIN_BONUS = 100;
export const XP_MATCH_COMPLETION = 25;
export const XP_PLACEMENT_BONUS = [100, 50, 25]; // 1st, 2nd, 3rd

export interface XpCalculationData {
  kills: number;
  bombsPlaced: number;
  powerupsCollected: number;
  placement: number;
  isWinner: boolean;
}

export interface XpUpdateResult {
  userId: number;
  xpGained: number;
  totalXp: number;
  oldLevel: number;
  newLevel: number;
  xpForNextLevel: number;
  xpProgress: number; // XP into current level (0 to xpForNextLevel)
}

/** Cumulative XP required to reach a given level (level 1 = 0 XP) */
export function getXpForLevel(level: number): number {
  if (level <= 1) return 0;
  return ((level * (level - 1)) / 2) * 100;
}

/** XP needed to go from current level to the next */
export function getXpToNextLevel(level: number): number {
  return level * 100;
}

/** Determine level from total XP */
export function getLevelForXp(totalXp: number): number {
  if (totalXp <= 0) return 1;
  // Solve: level*(level-1)/2 * 100 <= totalXp
  // level^2 - level - 2*totalXp/100 <= 0
  // level <= (1 + sqrt(1 + 8*totalXp/100)) / 2
  return Math.floor((1 + Math.sqrt(1 + (8 * totalXp) / 100)) / 2);
}

/** Calculate XP gained from a single match */
export function calculateXpGained(data: XpCalculationData, multiplier: number = 1): number {
  let xp = 0;
  // Kills go negative with self-kills (each one subtracts a kill); a match never costs XP.
  xp += Math.max(0, data.kills) * XP_PER_KILL;
  xp += data.bombsPlaced * XP_PER_BOMB;
  xp += data.powerupsCollected * XP_PER_POWERUP;
  xp += XP_MATCH_COMPLETION;
  if (data.isWinner) xp += XP_WIN_BONUS;
  if (data.placement >= 1 && data.placement <= 3) {
    xp += XP_PLACEMENT_BONUS[data.placement - 1];
  }
  return Math.max(0, Math.round(xp * multiplier));
}

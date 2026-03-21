export interface RankTier {
  name: string;
  minElo: number;
  maxElo: number;
  color: string;
}

export interface RankConfig {
  tiers: RankTier[];
  subTiersEnabled: boolean;
}

export interface Season {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface SeasonElo {
  userId: number;
  seasonId: number;
  eloRating: number;
  peakElo: number;
  matchesPlayed: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  eloRating: number;
  peakElo: number;
  matchesPlayed: number;
  totalWins: number;
  totalKills: number;
  rankTier: string;
  rankColor: string;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  total: number;
  page: number;
  limit: number;
  season: Season | null;
}

export interface PublicProfile {
  id: number;
  username: string;
  role: string;
  createdAt: string;
  stats: {
    totalMatches: number;
    totalWins: number;
    totalKills: number;
    totalDeaths: number;
    eloRating: number;
    peakElo: number;
    winStreak: number;
    bestWinStreak: number;
  };
  rankTier: string;
  rankColor: string;
  seasonHistory: SeasonSummary[];
  achievements: UserAchievementPublic[];
  equippedCosmetics: EquippedCosmetics;
}

export interface SeasonSummary {
  seasonId: number;
  seasonName: string;
  finalElo: number;
  peakElo: number;
  matchesPlayed: number;
}

export interface EloResult {
  userId: number;
  oldElo: number;
  newElo: number;
  delta: number;
}

// Imported types referenced in PublicProfile — re-exported from their own modules
import type { UserAchievementPublic } from './achievements';
import type { EquippedCosmetics } from './cosmetics';
export type { UserAchievementPublic, EquippedCosmetics };

export const DEFAULT_RANK_TIERS: RankTier[] = [
  { name: 'Bronze', minElo: 0, maxElo: 999, color: '#cd7f32' },
  { name: 'Silver', minElo: 1000, maxElo: 1199, color: '#c0c0c0' },
  { name: 'Gold', minElo: 1200, maxElo: 1399, color: '#ffd700' },
  { name: 'Platinum', minElo: 1400, maxElo: 1599, color: '#00d4aa' },
  { name: 'Diamond', minElo: 1600, maxElo: 1799, color: '#448aff' },
  { name: 'Champion', minElo: 1800, maxElo: 99999, color: '#ff3355' },
];

export const DEFAULT_RANK_CONFIG: RankConfig = {
  tiers: DEFAULT_RANK_TIERS,
  subTiersEnabled: true,
};

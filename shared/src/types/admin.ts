import { UserRole } from './auth';

export interface AdminUserListItem {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  isDeactivated: boolean;
  deactivatedAt: Date | null;
  lastLogin: Date | null;
  createdAt: Date;
  totalMatches: number;
  totalWins: number;
}

export interface AdminStats {
  totalUsers: number;
  activeUsers24h: number;
  totalMatches: number;
  activeRooms: number;
  activePlayers: number;
}

export interface AdminAction {
  id: number;
  adminId: number;
  adminUsername: string;
  action: string;
  targetType: string;
  targetId: number;
  details: string | null;
  createdAt: Date;
}

export interface RoleChangeRequest {
  role: UserRole;
}

export interface MatchHistoryItem {
  id: number;
  roomCode: string;
  gameMode: string;
  playerCount: number;
  status: string;
  duration: number | null;
  winnerUsername: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface MatchDetail {
  id: number;
  roomCode: string;
  gameMode: string;
  mapSeed: number;
  mapWidth: number;
  mapHeight: number;
  maxPlayers: number;
  status: string;
  duration: number | null;
  winnerId: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  players: MatchPlayerDetail[];
}

export interface MatchPlayerDetail {
  userId: number;
  username: string;
  team: number | null;
  placement: number | null;
  kills: number;
  deaths: number;
  bombsPlaced: number;
  powerupsCollected: number;
  survivedSeconds: number;
}

export interface AdminActiveRoom {
  code: string;
  name: string;
  host: string;
  players: { id: number; username: string; isBot: boolean }[];
  gameMode: string;
  status: string;
  maxPlayers: number;
  createdAt: string;
}

export interface DeactivateRequest {
  deactivated: boolean;
}

export interface AnnouncementBanner {
  id: number;
  message: string;
  adminUsername: string;
  createdAt: Date;
}

export interface ToastRequest {
  message: string;
}

export interface BannerRequest {
  message: string;
}

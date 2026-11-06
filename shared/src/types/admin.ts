import type { RoomListItem } from './lobby';

export interface AdminStats {
  totalUsers: number;
  activeUsers24h: number;
  totalMatches: number;
  activeRooms: number;
  activePlayers: number;
}

/** GET /admin/rooms: the lobby list plus each room's players (staff only, never broadcast). */
export interface AdminRoomListItem extends RoomListItem {
  players: { id: number; username: string }[];
}

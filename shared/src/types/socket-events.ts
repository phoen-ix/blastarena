import { GameState, PlayerInput } from './game';
import { Room, RoomPlayer, CreateRoomRequest, RoomListItem } from './lobby';
import { PublicUser, UserRole } from './auth';

// Client -> Server events
export interface ClientToServerEvents {
  'room:create': (
    data: CreateRoomRequest,
    callback: (response: { success: boolean; room?: Room; error?: string }) => void,
  ) => void;
  'room:join': (
    data: { code: string },
    callback: (response: { success: boolean; room?: Room; error?: string }) => void,
  ) => void;
  'room:leave': () => void;
  'room:ready': (data: { ready: boolean }) => void;
  'room:start': () => void;
  'room:restart': (
    callback: (response: { success: boolean; room?: Room; error?: string }) => void,
  ) => void;
  'game:input': (input: PlayerInput) => void;
  'room:setTeam': (data: { userId: number; team: number | null }) => void;
  'room:setBotTeam': (data: { botIndex: number; team: number }) => void;
  'chat:message': (data: { message: string }) => void;
  'admin:kick': (
    data: { roomCode: string; userId: number; reason?: string },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'admin:closeRoom': (
    data: { roomCode: string },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'admin:spectate': (
    data: { roomCode: string },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'admin:roomMessage': (data: { roomCode: string; message: string }) => void;
}

// Server -> Client events
export interface ServerToClientEvents {
  'room:state': (room: Room) => void;
  'room:playerJoined': (player: RoomPlayer) => void;
  'room:playerLeft': (userId: number) => void;
  'room:playerReady': (data: { userId: number; ready: boolean }) => void;
  'room:countdown': (data: { seconds: number }) => void;
  'room:list': (rooms: RoomListItem[]) => void;
  'game:start': (state: GameState) => void;
  'game:state': (state: GameState) => void;
  'game:bombPlaced': (data: {
    id: string;
    position: { x: number; y: number };
    ownerId: number;
  }) => void;
  'game:explosion': (data: { cells: { x: number; y: number }[]; ownerId: number }) => void;
  'game:powerupSpawned': (data: {
    id: string;
    position: { x: number; y: number };
    type: string;
  }) => void;
  'game:powerupCollected': (data: {
    playerId: number;
    type: string;
    position: { x: number; y: number };
  }) => void;
  'game:playerDied': (data: { playerId: number; killerId: number | null }) => void;
  'game:zoneUpdate': (data: {
    currentRadius: number;
    targetRadius: number;
    nextShrinkTick: number;
  }) => void;
  'game:over': (data: {
    winnerId: number | null;
    winnerTeam: number | null;
    reason: string;
    placements: {
      userId: number;
      username: string;
      isBot: boolean;
      placement: number;
      kills: number;
      selfKills: number;
      team: number | null;
      alive: boolean;
    }[];
  }) => void;
  'chat:message': (data: { user: PublicUser; message: string; timestamp: number }) => void;
  error: (data: { message: string; code?: string }) => void;
  'admin:toast': (data: { message: string }) => void;
  'admin:banner': (data: { message: string | null }) => void;
  'admin:kicked': (data: { reason: string }) => void;
  'admin:roomMessage': (data: { message: string; from: string }) => void;
}

// Inter-server events (if scaling later)
export interface InterServerEvents {
  ping: () => void;
}

// Socket data attached to each socket
export interface SocketData {
  userId: number;
  username: string;
  role: UserRole;
}

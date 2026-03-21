import { GameState, PlayerInput, Position } from './game';
import { Room, RoomPlayer, CreateRoomRequest, RoomListItem } from './lobby';
import { UserRole } from './auth';
import { SimulationConfig, SimulationBatchStatus, SimulationGameResult } from './simulation';
import { CampaignGameState, CampaignLevelSummary } from './campaign';
import { Friend, FriendRequest, Party, PartyInvite, PartyChatMessage, LobbyChatMessage, DirectMessage, ActivityStatus } from './friends';
import { EmoteId } from '../constants/emotes';

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
  'sim:start': (
    config: SimulationConfig,
    callback: (response: {
      success: boolean;
      batchId?: string;
      queued?: boolean;
      queuePosition?: number;
      error?: string;
    }) => void,
  ) => void;
  'sim:cancel': (
    data: { batchId: string },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'sim:spectate': (
    data: { batchId: string },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'sim:unspectate': (data: { batchId: string }) => void;
  'campaign:start': (
    data: { levelId: number },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'campaign:input': (input: PlayerInput) => void;
  'campaign:quit': () => void;
  'campaign:buddyInput': (input: PlayerInput) => void; // stub — buddy mode foundation

  // Friends
  'friend:list': (
    callback: (response: {
      success: boolean;
      friends?: Friend[];
      incoming?: FriendRequest[];
      outgoing?: FriendRequest[];
      error?: string;
    }) => void,
  ) => void;
  'friend:request': (
    data: { username: string },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'friend:accept': (
    data: { fromUserId: number },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'friend:decline': (
    data: { fromUserId: number },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'friend:cancel': (
    data: { toUserId: number },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'friend:remove': (
    data: { friendId: number },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'friend:block': (
    data: { userId: number },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'friend:unblock': (
    data: { userId: number },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;

  // Party
  'party:create': (
    callback: (response: { success: boolean; party?: Party; error?: string }) => void,
  ) => void;
  'party:invite': (
    data: { userId: number },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'party:acceptInvite': (
    data: { inviteId: string },
    callback: (response: { success: boolean; party?: Party; error?: string }) => void,
  ) => void;
  'party:declineInvite': (data: { inviteId: string }) => void;
  'party:leave': (
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'party:kick': (
    data: { userId: number },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'party:chat': (data: { message: string }) => void;

  // Lobby chat
  'lobby:chat': (data: { message: string }) => void;

  // Direct messages
  'dm:send': (
    data: { toUserId: number; message: string },
    callback: (response: { success: boolean; message?: DirectMessage; error?: string }) => void,
  ) => void;
  'dm:read': (data: { fromUserId: number }) => void;

  // In-game emotes
  'game:emote': (data: { emoteId: EmoteId }) => void;

  // Room invites
  'invite:room': (
    data: { userId: number },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'invite:acceptRoom': (
    data: { inviteId: string },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  'invite:declineRoom': (data: { inviteId: string }) => void;
}

// Server -> Client events
export interface ServerToClientEvents {
  'room:state': (room: Room) => void;
  'room:playerJoined': (player: RoomPlayer) => void;
  'room:playerLeft': (userId: number) => void;
  'room:playerReady': (data: { userId: number; ready: boolean }) => void;
  'room:list': (rooms: RoomListItem[]) => void;
  'game:start': (state: GameState) => void;
  'game:state': (state: GameState) => void;
  'game:explosion': (data: { cells: { x: number; y: number }[]; ownerId: number }) => void;
  'game:powerupCollected': (data: {
    playerId: number;
    type: string;
    position: { x: number; y: number };
  }) => void;
  'game:playerDied': (data: { playerId: number; killerId: number | null }) => void;
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
  error: (data: { message: string; code?: string }) => void;
  'admin:toast': (data: { message: string }) => void;
  'admin:banner': (data: { message: string | null }) => void;
  'admin:kicked': (data: { reason: string }) => void;
  'admin:roomMessage': (data: { message: string; from: string }) => void;
  'sim:progress': (data: SimulationBatchStatus) => void;
  'sim:gameResult': (data: { batchId: string; result: SimulationGameResult }) => void;
  'sim:state': (data: { batchId: string; state: GameState }) => void;
  'sim:gameTransition': (data: {
    batchId: string;
    gameIndex: number;
    totalGames: number;
    lastResult: SimulationGameResult | null;
  }) => void;
  'sim:completed': (data: { batchId: string; status: SimulationBatchStatus }) => void;
  'campaign:gameStart': (data: {
    state: CampaignGameState;
    level: CampaignLevelSummary;
  }) => void;
  'campaign:state': (state: CampaignGameState) => void;
  'campaign:playerDied': (data: {
    livesRemaining: number;
    respawnPosition: Position;
  }) => void;
  'campaign:enemyDied': (data: {
    enemyId: number;
    position: Position;
    isBoss: boolean;
  }) => void;
  'campaign:exitOpened': (data: { position: Position }) => void;
  'campaign:levelComplete': (data: {
    levelId: number;
    timeSeconds: number;
    stars: number;
    nextLevelId: number | null;
  }) => void;
  'campaign:gameOver': (data: {
    levelId: number;
    reason: string;
  }) => void;

  // Friends
  'friend:update': (data: { friends: Friend[]; incoming: FriendRequest[]; outgoing: FriendRequest[] }) => void;
  'friend:requestReceived': (data: FriendRequest) => void;
  'friend:removed': (data: { userId: number }) => void;
  'friend:online': (data: { userId: number; activity: ActivityStatus }) => void;
  'friend:offline': (data: { userId: number }) => void;

  // Party
  'party:state': (party: Party) => void;
  'party:disbanded': () => void;
  'party:invite': (invite: PartyInvite) => void;
  'party:chat': (message: PartyChatMessage) => void;
  'party:joinRoom': (data: { roomCode: string }) => void;

  // Lobby chat
  'lobby:chat': (message: LobbyChatMessage) => void;

  // Direct messages
  'dm:receive': (message: DirectMessage) => void;
  'dm:read': (data: { fromUserId: number; readAt: string }) => void;

  // In-game emotes
  'game:emote': (data: { playerId: number; emoteId: EmoteId }) => void;

  // Room invites
  'invite:room': (invite: PartyInvite) => void;
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
  /** Cached room code for fast game:input dispatch (avoids Redis lookup per input) */
  activeRoomCode?: string;
  /** Cached campaign session ID for fast campaign:input dispatch */
  activeCampaignSession?: string;
  /** Active party ID */
  activePartyId?: string;
}

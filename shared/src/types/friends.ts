// Friends + Party System Types

import { UserRole } from './auth';

export type FriendshipStatus = 'pending' | 'accepted';
export type ActivityStatus = 'offline' | 'online' | 'in_lobby' | 'in_game' | 'in_campaign';

export interface Friend {
  userId: number;
  username: string;
  status: FriendshipStatus;
  /** 'incoming' = they sent request, 'outgoing' = I sent request, null = accepted */
  direction: 'incoming' | 'outgoing' | null;
  activity: ActivityStatus;
  roomCode?: string;
  gameMode?: string;
  partyId?: string;
  since: string; // ISO date string
}

export interface FriendRequest {
  id: number;
  fromUserId: number;
  fromUsername: string;
  createdAt: string;
}

export interface Party {
  id: string;
  leaderId: number;
  members: PartyMember[];
  createdAt: string;
}

export interface PartyMember {
  userId: number;
  username: string;
}

export interface PartyInvite {
  inviteId: string;
  type: 'party' | 'room';
  fromUserId: number;
  fromUsername: string;
  partyId?: string;
  roomCode?: string;
  roomName?: string;
  createdAt: string;
}

export interface PartyChatMessage {
  fromUserId: number;
  fromUsername: string;
  message: string;
  timestamp: number;
}

export interface LobbyChatMessage {
  fromUserId: number;
  fromUsername: string;
  message: string;
  timestamp: number;
  role: UserRole;
}

export interface DirectMessage {
  id: number;
  senderId: number;
  senderUsername: string;
  recipientId: number;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export interface DMConversation {
  userId: number;
  username: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

// Constants
export const MAX_FRIENDS = 200;
export const MAX_PARTY_SIZE = 8;
export const MAX_PENDING_INVITES = 5;
export const PARTY_CHAT_MAX_LENGTH = 200;
export const LOBBY_CHAT_MAX_LENGTH = 200;
export const DM_MAX_LENGTH = 500;

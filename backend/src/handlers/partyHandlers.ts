import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  PARTY_CHAT_MAX_LENGTH,
  getErrorMessage,
} from '@blast-arena/shared';
import * as partyService from '../services/party';
import * as friendsService from '../services/friends';
import * as settingsService from '../services/settings';
import { createSocketRateLimiter } from '../utils/socketRateLimit';
import { logger } from '../utils/logger';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const partyChatLimiter = createSocketRateLimiter(5);
const inviteLimiter = createSocketRateLimiter(3);

export function setupPartyHandlers(socket: TypedSocket, io: TypedServer): void {
  const userId = socket.data.userId;
  const username = socket.data.username;

  // Create party
  socket.on('party:create', async (callback) => {
    try {
      const party = await partyService.createParty(userId, username);
      socket.data.activePartyId = party.id;
      socket.join(`party:${party.id}`);
      callback({ success: true, party });
    } catch (err) {
      callback({ success: false, error: getErrorMessage(err) });
    }
  });

  // Invite to party
  socket.on('party:invite', async (data, callback) => {
    if (!inviteLimiter.isAllowed(socket.id)) return;
    try {
      const partyId = socket.data.activePartyId;
      if (!partyId) return callback({ success: false, error: 'Not in a party' });

      const party = await partyService.getParty(partyId);
      if (!party) return callback({ success: false, error: 'Party not found' });
      if (party.leaderId !== userId) return callback({ success: false, error: 'Only the leader can invite' });

      // Check friendship
      const friends = await friendsService.areFriends(userId, data.userId);
      if (!friends) return callback({ success: false, error: 'Can only invite friends' });

      // Check if already in party
      if (party.members.some((m) => m.userId === data.userId)) {
        return callback({ success: false, error: 'Already in your party' });
      }

      const inviteId = await partyService.createInvite(data.userId, {
        type: 'party',
        fromUserId: userId,
        fromUsername: username,
        partyId,
      });

      io.to(`user:${data.userId}`).emit('party:invite', {
        inviteId,
        type: 'party',
        fromUserId: userId,
        fromUsername: username,
        partyId,
        createdAt: new Date().toISOString(),
      });

      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: getErrorMessage(err) });
    }
  });

  // Accept party invite
  socket.on('party:acceptInvite', async (data, callback) => {
    try {
      const invite = await partyService.getInvite(userId, data.inviteId);
      if (!invite || invite.type !== 'party') {
        return callback({ success: false, error: 'Invite expired or not found' });
      }

      const party = await partyService.joinParty(invite.partyId, userId, username);
      await partyService.removeInvite(userId, data.inviteId);

      socket.data.activePartyId = party.id;
      socket.join(`party:${party.id}`);

      // Broadcast updated party state to all members
      io.to(`party:${party.id}`).emit('party:state', party);

      callback({ success: true, party });
    } catch (err) {
      callback({ success: false, error: getErrorMessage(err) });
    }
  });

  // Decline party invite
  socket.on('party:declineInvite', async (data) => {
    await partyService.removeInvite(userId, data.inviteId);
  });

  // Leave party
  socket.on('party:leave', async (callback) => {
    try {
      const partyId = socket.data.activePartyId;
      if (!partyId) return callback({ success: false, error: 'Not in a party' });

      const result = await partyService.leaveParty(partyId, userId);
      socket.leave(`party:${partyId}`);
      socket.data.activePartyId = undefined;

      if (result === 'disbanded') {
        io.to(`party:${partyId}`).emit('party:disbanded');
        // Clean up all sockets in the party room
        const sockets = await io.in(`party:${partyId}`).fetchSockets();
        for (const s of sockets) {
          s.data.activePartyId = undefined;
          s.leave(`party:${partyId}`);
        }
      } else {
        // Send updated party state
        const party = await partyService.getParty(partyId);
        if (party) {
          io.to(`party:${partyId}`).emit('party:state', party);
        }
      }

      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: getErrorMessage(err) });
    }
  });

  // Kick from party
  socket.on('party:kick', async (data, callback) => {
    try {
      const partyId = socket.data.activePartyId;
      if (!partyId) return callback({ success: false, error: 'Not in a party' });

      const party = await partyService.kickFromParty(partyId, userId, data.userId);

      // Notify kicked user
      io.to(`user:${data.userId}`).emit('party:disbanded');

      // Clean up kicked user's socket
      const sockets = await io.in(`party:${partyId}`).fetchSockets();
      for (const s of sockets) {
        if (s.data.userId === data.userId) {
          s.data.activePartyId = undefined;
          s.leave(`party:${partyId}`);
        }
      }

      // Broadcast updated state
      io.to(`party:${partyId}`).emit('party:state', party);

      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: getErrorMessage(err) });
    }
  });

  // Party chat
  socket.on('party:chat', async (data) => {
    if (!partyChatLimiter.isAllowed(socket.id)) return;
    const partyId = socket.data.activePartyId;
    if (!partyId) return;

    // Check chat mode setting
    const chatMode = await settingsService.getChatMode();
    if (chatMode === 'disabled') return;
    if (chatMode === 'admin_only' && socket.data.role !== 'admin') return;
    if (chatMode === 'staff' && socket.data.role !== 'admin' && socket.data.role !== 'moderator') return;

    const message = typeof data.message === 'string'
      ? data.message.trim().substring(0, PARTY_CHAT_MAX_LENGTH)
      : '';
    if (!message) return;

    io.to(`party:${partyId}`).emit('party:chat', {
      fromUserId: userId,
      fromUsername: username,
      message,
      timestamp: Date.now(),
    });
  });

  // Room invite (invite friend to current room)
  socket.on('invite:room', async (data, callback) => {
    if (!inviteLimiter.isAllowed(socket.id)) return;
    try {
      const roomCode = socket.data.activeRoomCode;
      if (!roomCode) return callback({ success: false, error: 'Not in a room' });

      // Check friendship
      const friends = await friendsService.areFriends(userId, data.userId);
      if (!friends) return callback({ success: false, error: 'Can only invite friends' });

      const inviteId = await partyService.createInvite(data.userId, {
        type: 'room',
        fromUserId: userId,
        fromUsername: username,
        roomCode,
      });

      io.to(`user:${data.userId}`).emit('invite:room', {
        inviteId,
        type: 'room',
        fromUserId: userId,
        fromUsername: username,
        roomCode,
        createdAt: new Date().toISOString(),
      });

      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: getErrorMessage(err) });
    }
  });

  // Accept room invite
  socket.on('invite:acceptRoom', async (data, callback) => {
    try {
      const invite = await partyService.getInvite(userId, data.inviteId);
      if (!invite || invite.type !== 'room') {
        return callback({ success: false, error: 'Invite expired or not found' });
      }

      await partyService.removeInvite(userId, data.inviteId);

      // Client will handle the actual room join via room:join
      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: getErrorMessage(err) });
    }
  });

  // Decline room invite
  socket.on('invite:declineRoom', async (data) => {
    await partyService.removeInvite(userId, data.inviteId);
  });
}

/** Handle party cleanup when a user disconnects */
export async function handlePartyDisconnect(
  socket: TypedSocket,
  io: TypedServer,
): Promise<void> {
  const partyId = socket.data.activePartyId;
  if (!partyId) return;

  try {
    const result = await partyService.leaveParty(partyId, socket.data.userId);
    if (result === 'disbanded') {
      io.to(`party:${partyId}`).emit('party:disbanded');
      const sockets = await io.in(`party:${partyId}`).fetchSockets();
      for (const s of sockets) {
        s.data.activePartyId = undefined;
        s.leave(`party:${partyId}`);
      }
    } else {
      const party = await partyService.getParty(partyId);
      if (party) {
        io.to(`party:${partyId}`).emit('party:state', party);
      }
    }
  } catch (err) {
    logger.error({ err, userId: socket.data.userId }, 'Failed to handle party disconnect');
  }
}

export function cleanupPartyLimiters(socketId: string): void {
  partyChatLimiter.remove(socketId);
  inviteLimiter.remove(socketId);
}

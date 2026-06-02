import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@blast-arena/shared';
import * as friendsService from '../services/friends';
import * as presenceService from '../services/presence';
import { createSocketRateLimiter } from '../utils/socketRateLimit';
import { clientError } from '../utils/socketValidation';
import { logger } from '../utils/logger';

type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
type TypedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

const friendRequestLimiter = createSocketRateLimiter(3);
const friendActionLimiter = createSocketRateLimiter(5);

export function setupFriendHandlers(socket: TypedSocket, io: TypedServer): void {
  const userId = socket.data.userId;
  const username = socket.data.username;

  // List friends + pending
  socket.on('friend:list', async (callback) => {
    if (!friendActionLimiter.isAllowed(socket.id)) return;
    try {
      const [friends, pending] = await Promise.all([
        friendsService.getFriends(userId),
        friendsService.getPendingRequests(userId),
      ]);
      callback({
        success: true,
        friends,
        incoming: pending.incoming,
        outgoing: pending.outgoing,
      });
    } catch (err) {
      callback({ success: false, error: clientError(err) });
    }
  });

  // Send friend request
  socket.on('friend:request', async (data, callback) => {
    if (!friendRequestLimiter.isAllowed(socket.id)) return;
    try {
      if (!data.username || typeof data.username !== 'string') {
        return callback({ success: false, error: 'Username required' });
      }
      const targetUserId = await friendsService.sendFriendRequest(userId, data.username.trim());

      // Notify the target user if online
      io.to(`user:${targetUserId}`).emit('friend:requestReceived', {
        id: userId,
        fromUserId: userId,
        fromUsername: username,
        createdAt: new Date().toISOString(),
      });

      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: clientError(err) });
    }
  });

  // Accept friend request
  socket.on('friend:accept', async (data, callback) => {
    if (!friendActionLimiter.isAllowed(socket.id)) return;
    try {
      await friendsService.acceptFriendRequest(userId, data.fromUserId);

      // Notify both parties with updated lists
      await notifyFriendUpdate(io, userId);
      await notifyFriendUpdate(io, data.fromUserId);

      // Notify the requester they're now online to us
      const presence = await presenceService.getPresence(userId);
      if (presence) {
        io.to(`user:${data.fromUserId}`).emit('friend:online', {
          userId,
          activity: presence.status,
        });
      }

      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: clientError(err) });
    }
  });

  // Decline friend request
  socket.on('friend:decline', async (data, callback) => {
    if (!friendActionLimiter.isAllowed(socket.id)) return;
    try {
      await friendsService.declineFriendRequest(userId, data.fromUserId);
      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: clientError(err) });
    }
  });

  // Cancel outgoing friend request
  socket.on('friend:cancel', async (data, callback) => {
    if (!friendActionLimiter.isAllowed(socket.id)) return;
    try {
      await friendsService.cancelFriendRequest(userId, data.toUserId);
      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: clientError(err) });
    }
  });

  // Remove friend
  socket.on('friend:remove', async (data, callback) => {
    if (!friendActionLimiter.isAllowed(socket.id)) return;
    try {
      await friendsService.removeFriend(userId, data.friendId);

      // Notify the removed friend
      io.to(`user:${data.friendId}`).emit('friend:removed', { userId });

      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: clientError(err) });
    }
  });

  // Block user
  socket.on('friend:block', async (data, callback) => {
    if (!friendActionLimiter.isAllowed(socket.id)) return;
    try {
      await friendsService.blockUser(userId, data.userId);

      // Notify the blocked user they've been removed (they see it as removal)
      io.to(`user:${data.userId}`).emit('friend:removed', { userId });

      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: clientError(err) });
    }
  });

  // Unblock user
  socket.on('friend:unblock', async (data, callback) => {
    if (!friendActionLimiter.isAllowed(socket.id)) return;
    try {
      await friendsService.unblockUser(userId, data.userId);
      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: clientError(err) });
    }
  });
}

/** Notify online friends that this user came online */
export async function notifyFriendsOnline(
  io: TypedServer,
  userId: number,
  activity: string,
): Promise<void> {
  try {
    const friendIds = await friendsService.getFriendIds(userId);
    for (const friendId of friendIds) {
      io.to(`user:${friendId}`).emit('friend:online', {
        userId,
        activity: activity as any,
      });
    }
  } catch (err) {
    logger.error({ err, userId }, 'Failed to notify friends online');
  }
}

/** Notify online friends that this user went offline */
export async function notifyFriendsOffline(io: TypedServer, userId: number): Promise<void> {
  try {
    const friendIds = await friendsService.getFriendIds(userId);
    for (const friendId of friendIds) {
      io.to(`user:${friendId}`).emit('friend:offline', { userId });
    }
  } catch (err) {
    logger.error({ err, userId }, 'Failed to notify friends offline');
  }
}

/** Send full friend update to a user (used after accept/remove) */
async function notifyFriendUpdate(io: TypedServer, userId: number): Promise<void> {
  try {
    const [friends, pending] = await Promise.all([
      friendsService.getFriends(userId),
      friendsService.getPendingRequests(userId),
    ]);
    io.to(`user:${userId}`).emit('friend:update', {
      friends,
      incoming: pending.incoming,
      outgoing: pending.outgoing,
    });
  } catch (err) {
    logger.error({ err, userId }, 'Failed to send friend update');
  }
}

export function cleanupFriendLimiters(socketId: string): void {
  friendRequestLimiter.remove(socketId);
  friendActionLimiter.remove(socketId);
}

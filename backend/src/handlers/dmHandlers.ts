import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  DM_MAX_LENGTH,
  getErrorMessage,
} from '@blast-arena/shared';
import * as settingsService from '../services/settings';
import * as messageService from '../services/messages';
import { createSocketRateLimiter } from '../utils/socketRateLimit';
import { validateSocket, dmReadSchema, clientError } from '../utils/socketValidation';
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

const dmChatLimiter = createSocketRateLimiter(5);

export function setupDMHandlers(socket: TypedSocket, io: TypedServer): void {
  const userId = socket.data.userId;

  socket.on('dm:send', async (data, callback) => {
    // Every path below answers the ack. There is no ack timeout anywhere in the frontend, and
    // MessagesView clears the composer synchronously on send — so a handler that returns without
    // calling back loses the message silently, with the connection still showing as healthy.
    // (audit SOCKET-TRYCATCH-2)
    if (!dmChatLimiter.isAllowed(socket.id)) {
      return callback({ success: false, error: 'Rate limited' });
    }

    // The try opens here, not below: `getDMMode` reads `server_settings` through a 5s cache, so
    // the first call after each TTL expiry is a real DB query that can reject. Sitting ahead of
    // the try, that rejection escaped as an unhandled promise and the ack never fired.
    try {
      const dmMode = await settingsService.getDMMode();
      if (dmMode === 'disabled')
        return callback({ success: false, error: 'Direct messages are disabled' });
      if (dmMode === 'admin_only' && socket.data.role !== 'admin')
        return callback({ success: false, error: 'Direct messages are restricted' });
      if (dmMode === 'staff' && socket.data.role !== 'admin' && socket.data.role !== 'moderator')
        return callback({ success: false, error: 'Direct messages are restricted' });

      const message =
        typeof data.message === 'string' ? data.message.trim().substring(0, DM_MAX_LENGTH) : '';
      if (!message) return callback({ success: false, error: 'Message cannot be empty' });

      if (typeof data.toUserId !== 'number' || data.toUserId <= 0) {
        return callback({ success: false, error: 'Invalid input' });
      }

      const msg = await messageService.sendMessage(userId, data.toUserId, message);
      callback({ success: true, message: msg });

      // Real-time delivery to recipient
      io.to(`user:${data.toUserId}`).emit('dm:receive', msg);
    } catch (err) {
      callback({ success: false, error: clientError(err) });
    }
  });

  socket.on('dm:read', async (data) => {
    const parsed = validateSocket(dmReadSchema, data);
    if (!parsed) return;
    try {
      await messageService.markRead(userId, parsed.fromUserId);
      // Notify sender that messages were read
      io.to(`user:${parsed.fromUserId}`).emit('dm:read', {
        fromUserId: userId,
        readAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn({ err: getErrorMessage(err), userId }, 'Failed to mark DM as read');
    }
  });
}

export function cleanupDMLimiters(socketId: string): void {
  dmChatLimiter.remove(socketId);
}

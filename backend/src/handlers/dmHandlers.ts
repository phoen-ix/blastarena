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

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const dmChatLimiter = createSocketRateLimiter(5);

export function setupDMHandlers(socket: TypedSocket, io: TypedServer): void {
  const userId = socket.data.userId;

  socket.on('dm:send', async (data, callback) => {
    if (!dmChatLimiter.isAllowed(socket.id)) return;

    const dmMode = await settingsService.getDMMode();
    if (dmMode === 'disabled') return callback({ success: false, error: 'Direct messages are disabled' });
    if (dmMode === 'admin_only' && socket.data.role !== 'admin')
      return callback({ success: false, error: 'Direct messages are restricted' });
    if (dmMode === 'staff' && socket.data.role !== 'admin' && socket.data.role !== 'moderator')
      return callback({ success: false, error: 'Direct messages are restricted' });

    const message =
      typeof data.message === 'string' ? data.message.trim().substring(0, DM_MAX_LENGTH) : '';
    if (!message) return callback({ success: false, error: 'Message cannot be empty' });

    try {
      const msg = await messageService.sendMessage(userId, data.toUserId, message);
      callback({ success: true, message: msg });

      // Real-time delivery to recipient
      io.to(`user:${data.toUserId}`).emit('dm:receive', msg);
    } catch (err) {
      callback({ success: false, error: getErrorMessage(err) });
    }
  });

  socket.on('dm:read', async (data) => {
    try {
      await messageService.markRead(userId, data.fromUserId);
      // Notify sender that messages were read
      io.to(`user:${data.fromUserId}`).emit('dm:read', {
        fromUserId: userId,
        readAt: new Date().toISOString(),
      });
    } catch {
      // Silent failure for read receipts
    }
  });
}

export function cleanupDMLimiters(socketId: string): void {
  dmChatLimiter.remove(socketId);
}

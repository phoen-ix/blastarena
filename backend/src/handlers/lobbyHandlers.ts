import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  LOBBY_CHAT_MAX_LENGTH,
} from '@blast-arena/shared';
import * as settingsService from '../services/settings';
import { createSocketRateLimiter } from '../utils/socketRateLimit';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const lobbyChatLimiter = createSocketRateLimiter(3);

export function setupLobbyHandlers(socket: TypedSocket, io: TypedServer): void {
  const userId = socket.data.userId;
  const username = socket.data.username;

  socket.on('lobby:chat', async (data) => {
    if (!lobbyChatLimiter.isAllowed(socket.id)) return;

    const chatMode = await settingsService.getLobbyChatMode();
    if (chatMode === 'disabled') return;
    if (chatMode === 'admin_only' && socket.data.role !== 'admin') return;
    if (chatMode === 'staff' && socket.data.role !== 'admin' && socket.data.role !== 'moderator') return;

    const message =
      typeof data.message === 'string' ? data.message.trim().substring(0, LOBBY_CHAT_MAX_LENGTH) : '';
    if (!message) return;

    io.emit('lobby:chat', {
      fromUserId: userId,
      fromUsername: username,
      message,
      timestamp: Date.now(),
      role: socket.data.role,
    });
  });
}

export function cleanupLobbyLimiters(socketId: string): void {
  lobbyChatLimiter.remove(socketId);
}

import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { getConfig } from './config';
import { logger } from './utils/logger';
import * as lobbyService from './services/lobby';
import { RoomManager } from './game/RoomManager';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  AuthPayload,
  PublicUser,
  COUNTDOWN_SECONDS,
} from '@blast-arena/shared';

export function createSocketServer(httpServer: HttpServer): Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData> {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  const roomManager = new RoomManager(io as any);

  // Auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const payload = jwt.verify(token, getConfig().JWT_SECRET) as AuthPayload;
      socket.data.userId = payload.userId;
      socket.data.username = payload.username;
      socket.data.role = payload.role;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info({ userId: socket.data.userId, username: socket.data.username }, 'Socket connected');

    const currentUser: PublicUser = {
      id: socket.data.userId,
      username: socket.data.username,
      displayName: socket.data.username,
      role: socket.data.role as any,
    };

    // Room creation
    socket.on('room:create', async (data, callback) => {
      try {
        const room = await lobbyService.createRoom(currentUser, data.name, data.config);
        socket.join(`room:${room.code}`);
        callback({ success: true, room });
      } catch (err: any) {
        callback({ success: false, error: err.message });
      }
    });

    // Join room
    socket.on('room:join', async (data, callback) => {
      try {
        const room = await lobbyService.joinRoom(data.code, currentUser);
        socket.join(`room:${room.code}`);
        socket.to(`room:${room.code}`).emit('room:playerJoined', { user: currentUser, ready: false, team: null });
        callback({ success: true, room });
      } catch (err: any) {
        callback({ success: false, error: err.message });
      }
    });

    // Leave room
    socket.on('room:leave', async () => {
      const roomCode = await lobbyService.getPlayerRoom(socket.data.userId);
      if (!roomCode) return;

      // If game is running, notify the game room
      const gameRoom = roomManager.getRoom(roomCode);
      if (gameRoom) {
        gameRoom.handlePlayerDisconnect(socket.data.userId);
      }

      const room = await lobbyService.leaveRoom(roomCode, socket.data.userId);
      socket.leave(`room:${roomCode}`);
      if (room) {
        io.to(`room:${roomCode}`).emit('room:playerLeft', socket.data.userId);
        io.to(`room:${roomCode}`).emit('room:state', room);
      }
    });

    // Ready toggle
    socket.on('room:ready', async (data) => {
      const roomCode = await lobbyService.getPlayerRoom(socket.data.userId);
      if (!roomCode) return;

      try {
        await lobbyService.setPlayerReady(roomCode, socket.data.userId, data.ready);
        io.to(`room:${roomCode}`).emit('room:playerReady', { userId: socket.data.userId, ready: data.ready });
      } catch (err: any) {
        socket.emit('error', { message: err.message });
      }
    });

    // Start game
    socket.on('room:start', async () => {
      const roomCode = await lobbyService.getPlayerRoom(socket.data.userId);
      if (!roomCode) return;

      const room = await lobbyService.getRoom(roomCode);
      if (!room) return;

      // Verify host
      if (room.host.id !== socket.data.userId) {
        socket.emit('error', { message: 'Only the host can start the game' });
        return;
      }

      // Check all players ready
      const allReady = room.players.every(p => p.user.id === room.host.id || p.ready);
      if (!allReady) {
        socket.emit('error', { message: 'Not all players are ready' });
        return;
      }

      const botCount = room.config.botCount || 0;
      if (room.players.length < 2 && botCount < 1) {
        socket.emit('error', { message: 'Need at least 2 players or add bots' });
        return;
      }

      // Prevent double-start
      if (roomManager.getRoom(roomCode)) {
        socket.emit('error', { message: 'Game already starting' });
        return;
      }

      // Start countdown
      await lobbyService.updateRoomStatus(roomCode, 'countdown');
      io.to(`room:${roomCode}`).emit('room:countdown', { seconds: COUNTDOWN_SECONDS });
      logger.info({ roomCode }, 'Game countdown started');

      // After countdown, create GameRoom and start game loop
      setTimeout(async () => {
        try {
          // Re-fetch room to get latest state
          const currentRoom = await lobbyService.getRoom(roomCode);
          if (!currentRoom) {
            logger.warn({ roomCode }, 'Room disappeared during countdown');
            return;
          }

          const gameRoom = await roomManager.createGame(currentRoom);
          logger.info({ roomCode, players: currentRoom.players.length }, 'Game started');
        } catch (err) {
          logger.error({ err, roomCode }, 'Failed to start game');
          io.to(`room:${roomCode}`).emit('error', { message: 'Failed to start game' });
          await lobbyService.updateRoomStatus(roomCode, 'waiting');
        }
      }, COUNTDOWN_SECONDS * 1000);
    });

    // Game input
    socket.on('game:input', async (input) => {
      const roomCode = await lobbyService.getPlayerRoom(socket.data.userId);
      if (!roomCode) return;

      const gameRoom = roomManager.getRoom(roomCode);
      if (gameRoom) {
        gameRoom.handleInput(socket.data.userId, input);
      }
    });

    // Disconnect
    socket.on('disconnect', async () => {
      logger.info({ userId: socket.data.userId }, 'Socket disconnected');

      const roomCode = await lobbyService.getPlayerRoom(socket.data.userId);
      if (roomCode) {
        // If game is running, notify game room
        const gameRoom = roomManager.getRoom(roomCode);
        if (gameRoom) {
          gameRoom.handlePlayerDisconnect(socket.data.userId);
        }

        const room = await lobbyService.leaveRoom(roomCode, socket.data.userId);
        if (room) {
          io.to(`room:${roomCode}`).emit('room:playerLeft', socket.data.userId);
          io.to(`room:${roomCode}`).emit('room:state', room);
        }
      }
    });
  });

  // Periodic cleanup of finished game rooms
  setInterval(() => {
    roomManager.cleanup();
  }, 30000);

  return io;
}

import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { getConfig } from './config';
import { logger } from './utils/logger';
import * as lobbyService from './services/lobby';
import { RoomManager } from './game/RoomManager';
import { setRegistry } from './game/registry';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  AuthPayload,
  PublicUser,
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
  setRegistry(roomManager, io as any);

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

  async function broadcastRoomList() {
    try {
      const rooms = await lobbyService.listRooms();
      io.emit('room:list', rooms);
    } catch (err) {
      logger.error({ err }, 'Failed to broadcast room list');
    }
  }

  io.on('connection', (socket) => {
    logger.info({ userId: socket.data.userId, username: socket.data.username }, 'Socket connected');

    const currentUser: PublicUser = {
      id: socket.data.userId,
      username: socket.data.username,
      role: socket.data.role as any,
    };

    // Room creation
    socket.on('room:create', async (data, callback) => {
      try {
        const room = await lobbyService.createRoom(currentUser, data.name, data.config);
        socket.join(`room:${room.code}`);
        callback({ success: true, room });
        broadcastRoomList();
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
        broadcastRoomList();
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
      broadcastRoomList();
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

      // Prevent double-start (game already running or countdown in progress)
      if (roomManager.getRoom(roomCode) || room.status !== 'waiting') {
        socket.emit('error', { message: 'Game already starting' });
        return;
      }

      try {
        await lobbyService.updateRoomStatus(roomCode, 'countdown');
        const gameRoom = await roomManager.createGame(room);
        logger.info({ roomCode, players: room.players.length }, 'Game started');
        broadcastRoomList();
      } catch (err) {
        logger.error({ err, roomCode }, 'Failed to start game');
        io.to(`room:${roomCode}`).emit('error', { message: 'Failed to start game' });
        await lobbyService.updateRoomStatus(roomCode, 'waiting');
      }
    });

    // Restart room (play again)
    socket.on('room:restart', async (callback) => {
      const roomCode = await lobbyService.getPlayerRoom(socket.data.userId);
      if (!roomCode) {
        callback({ success: false, error: 'Not in a room' });
        return;
      }

      const room = await lobbyService.getRoom(roomCode);
      if (!room) {
        callback({ success: false, error: 'Room not found' });
        return;
      }

      if (room.status !== 'finished') {
        callback({ success: false, error: 'Game is not finished' });
        return;
      }

      // Clean up finished game room
      roomManager.removeRoom(roomCode);

      // Reset room state
      room.status = 'waiting';
      room.players.forEach(p => p.ready = false);
      await lobbyService.updateRoom(roomCode, room);

      // Notify all players in the room
      io.to(`room:${roomCode}`).emit('room:state', room);

      callback({ success: true, room });
      broadcastRoomList();
    });

    // Set player team (host only, teams mode)
    socket.on('room:setTeam' as any, async (data: { userId: number; team: number | null }) => {
      const roomCode = await lobbyService.getPlayerRoom(socket.data.userId);
      if (!roomCode) return;

      const room = await lobbyService.getRoom(roomCode);
      if (!room) return;

      // Only host can assign teams
      if (room.host.id !== socket.data.userId) {
        socket.emit('error', { message: 'Only the host can assign teams' });
        return;
      }

      try {
        const updatedRoom = await lobbyService.setPlayerTeam(roomCode, data.userId, data.team);
        io.to(`room:${roomCode}`).emit('room:state', updatedRoom);
      } catch (err: any) {
        socket.emit('error', { message: err.message });
      }
    });

    // Set bot team (host only, teams mode)
    socket.on('room:setBotTeam' as any, async (data: { botIndex: number; team: number }) => {
      const roomCode = await lobbyService.getPlayerRoom(socket.data.userId);
      if (!roomCode) return;

      const room = await lobbyService.getRoom(roomCode);
      if (!room) return;

      if (room.host.id !== socket.data.userId) {
        socket.emit('error', { message: 'Only the host can assign bot teams' });
        return;
      }

      const botCount = room.config.botCount || 0;
      if (data.botIndex < 0 || data.botIndex >= botCount) return;

      // Initialize botTeams array if needed
      if (!room.config.botTeams) {
        room.config.botTeams = [];
      }
      // Fill to length
      while (room.config.botTeams.length < botCount) {
        room.config.botTeams.push(null);
      }
      room.config.botTeams[data.botIndex] = data.team;

      await lobbyService.updateRoom(roomCode, room);
      io.to(`room:${roomCode}`).emit('room:state', room);
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

    // Admin: kick player from room
    socket.on('admin:kick' as any, async (data: { roomCode: string; userId: number; reason?: string }, callback: any) => {
      if (socket.data.role !== 'admin' && socket.data.role !== 'moderator') {
        return callback({ success: false, error: 'Insufficient permissions' });
      }

      const gameRoom = roomManager.getRoom(data.roomCode);
      if (gameRoom) {
        gameRoom.handlePlayerDisconnect(data.userId);
      }

      const room = await lobbyService.leaveRoom(data.roomCode, data.userId);

      // Find target socket and notify
      const sockets = await io.in(`room:${data.roomCode}`).fetchSockets();
      for (const s of sockets) {
        if (s.data.userId === data.userId) {
          (s as any).emit('admin:kicked', { reason: data.reason || 'Kicked by admin' });
          s.leave(`room:${data.roomCode}`);
        }
      }

      if (room) {
        io.to(`room:${data.roomCode}`).emit('room:playerLeft', data.userId);
        io.to(`room:${data.roomCode}`).emit('room:state', room);
      }
      broadcastRoomList();

      logger.info({ admin: socket.data.username, targetUserId: data.userId, roomCode: data.roomCode }, 'Admin kicked player');
      callback({ success: true });
    });

    // Admin: force close room
    socket.on('admin:closeRoom' as any, async (data: { roomCode: string }, callback: any) => {
      if (socket.data.role !== 'admin') {
        return callback({ success: false, error: 'Admin access required' });
      }

      // Notify all players in the room
      io.to(`room:${data.roomCode}`).emit('admin:kicked' as any, { reason: 'Room closed by admin' });

      // Remove all sockets from the room
      const sockets = await io.in(`room:${data.roomCode}`).fetchSockets();
      for (const s of sockets) {
        await lobbyService.leaveRoom(data.roomCode, s.data.userId);
        s.leave(`room:${data.roomCode}`);
      }

      roomManager.removeRoom(data.roomCode);
      await lobbyService.deleteRoom(data.roomCode);
      broadcastRoomList();

      logger.info({ admin: socket.data.username, roomCode: data.roomCode }, 'Admin closed room');
      callback({ success: true });
    });

    // Admin: spectate room
    socket.on('admin:spectate' as any, async (data: { roomCode: string }, callback: any) => {
      if (socket.data.role !== 'admin' && socket.data.role !== 'moderator') {
        return callback({ success: false, error: 'Insufficient permissions' });
      }

      const gameRoom = roomManager.getRoom(data.roomCode);
      if (!gameRoom) {
        return callback({ success: false, error: 'Game not running in this room' });
      }

      socket.join(`room:${data.roomCode}`);
      logger.info({ admin: socket.data.username, roomCode: data.roomCode }, 'Admin spectating room');
      callback({ success: true });
    });

    // Admin: send message to room
    socket.on('admin:roomMessage' as any, (data: { roomCode: string; message: string }) => {
      if (socket.data.role !== 'admin' && socket.data.role !== 'moderator') return;

      io.to(`room:${data.roomCode}`).emit('admin:roomMessage' as any, {
        message: data.message,
        from: socket.data.username,
      });

      logger.info({ admin: socket.data.username, roomCode: data.roomCode }, 'Admin sent room message');
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
        broadcastRoomList();
      }
    });
  });

  // Periodic cleanup of finished game rooms
  setInterval(() => {
    roomManager.cleanup();
  }, 30000);

  return io;
}

import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { getConfig } from './config';
import { logger } from './utils/logger';
import * as lobbyService from './services/lobby';
import { RoomManager } from './game/RoomManager';
import { setRegistry, getSimulationManager } from './game/registry';
import { createRateLimiters } from './utils/socketRateLimit';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  AuthPayload,
  PublicUser,
} from '@blast-arena/shared';

type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function createSocketServer(httpServer: HttpServer): TypedServer {
  const io: TypedServer = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  const roomManager = new RoomManager(io);
  setRegistry(roomManager, io);
  const { inputLimiter, createLimiter, joinLimiter } = createRateLimiters();

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

  io.on('connection', async (socket) => {
    logger.info({ userId: socket.data.userId, username: socket.data.username }, 'Socket connected');

    const currentUser: PublicUser = {
      id: socket.data.userId,
      username: socket.data.username,
      role: socket.data.role,
    };

    // Auto-join admin room for simulation broadcasts
    if (socket.data.role === 'admin') {
      socket.join('sim:admin');
    }

    // Check if player was in an active game (reconnection after disconnect)
    const existingRoomCode = await lobbyService.getPlayerRoom(socket.data.userId);
    if (existingRoomCode) {
      const gameRoom = roomManager.getRoom(existingRoomCode);
      if (gameRoom && gameRoom.isRunning() && gameRoom.isPlayerDisconnected(socket.data.userId)) {
        // Rejoin socket room and resume game
        socket.join(`room:${existingRoomCode}`);
        gameRoom.handlePlayerReconnect(socket.data.userId);
        // Send current game state so client can resume
        logger.info(
          { userId: socket.data.userId, roomCode: existingRoomCode },
          'Player reconnected to active game',
        );
      }
    }

    // Room creation
    socket.on('room:create', async (data, callback) => {
      if (!createLimiter(socket.id)) return;
      try {
        const room = await lobbyService.createRoom(currentUser, data.name, data.config);
        socket.join(`room:${room.code}`);
        callback({ success: true, room });
        broadcastRoomList();
      } catch (err: unknown) {
        callback({ success: false, error: getErrorMessage(err) });
      }
    });

    // Join room
    socket.on('room:join', async (data, callback) => {
      if (!joinLimiter(socket.id)) return;
      try {
        const room = await lobbyService.joinRoom(data.code, currentUser);
        socket.join(`room:${room.code}`);
        socket
          .to(`room:${room.code}`)
          .emit('room:playerJoined', { user: currentUser, ready: false, team: null });
        callback({ success: true, room });
        broadcastRoomList();
      } catch (err: unknown) {
        callback({ success: false, error: getErrorMessage(err) });
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
        io.to(`room:${roomCode}`).emit('room:playerReady', {
          userId: socket.data.userId,
          ready: data.ready,
        });
      } catch (err: unknown) {
        socket.emit('error', { message: getErrorMessage(err) });
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
      const allReady = room.players.every((p) => p.user.id === room.host.id || p.ready);
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
        await roomManager.createGame(room);
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
      room.players.forEach((p) => (p.ready = false));
      await lobbyService.updateRoom(roomCode, room);

      // Notify all players in the room
      io.to(`room:${roomCode}`).emit('room:state', room);

      callback({ success: true, room });
      broadcastRoomList();
    });

    // Set player team (host only, teams mode)
    socket.on('room:setTeam', async (data) => {
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
      } catch (err: unknown) {
        socket.emit('error', { message: getErrorMessage(err) });
      }
    });

    // Set bot team (host only, teams mode)
    socket.on('room:setBotTeam', async (data) => {
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
      if (!inputLimiter(socket.id)) return;

      const roomCode = await lobbyService.getPlayerRoom(socket.data.userId);
      if (!roomCode) return;

      const gameRoom = roomManager.getRoom(roomCode);
      if (gameRoom) {
        gameRoom.handleInput(socket.data.userId, input);
      }
    });

    // Admin: kick player from room
    socket.on('admin:kick', async (data, callback) => {
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
          s.emit('admin:kicked', { reason: data.reason || 'Kicked by admin' });
          s.leave(`room:${data.roomCode}`);
        }
      }

      if (room) {
        io.to(`room:${data.roomCode}`).emit('room:playerLeft', data.userId);
        io.to(`room:${data.roomCode}`).emit('room:state', room);
      }
      broadcastRoomList();

      logger.info(
        { admin: socket.data.username, targetUserId: data.userId, roomCode: data.roomCode },
        'Admin kicked player',
      );
      callback({ success: true });
    });

    // Admin: force close room
    socket.on('admin:closeRoom', async (data, callback) => {
      if (socket.data.role !== 'admin') {
        return callback({ success: false, error: 'Admin access required' });
      }

      // Notify all players in the room
      io.to(`room:${data.roomCode}`).emit('admin:kicked', { reason: 'Room closed by admin' });

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
    socket.on('admin:spectate', async (data, callback) => {
      if (socket.data.role !== 'admin' && socket.data.role !== 'moderator') {
        return callback({ success: false, error: 'Insufficient permissions' });
      }

      const gameRoom = roomManager.getRoom(data.roomCode);
      if (!gameRoom) {
        return callback({ success: false, error: 'Game not running in this room' });
      }

      socket.join(`room:${data.roomCode}`);
      logger.info(
        { admin: socket.data.username, roomCode: data.roomCode },
        'Admin spectating room',
      );
      callback({ success: true });
    });

    // Admin: send message to room
    socket.on('admin:roomMessage', (data) => {
      if (socket.data.role !== 'admin' && socket.data.role !== 'moderator') return;

      io.to(`room:${data.roomCode}`).emit('admin:roomMessage', {
        message: data.message,
        from: socket.data.username,
      });

      logger.info(
        { admin: socket.data.username, roomCode: data.roomCode },
        'Admin sent room message',
      );
    });

    // Simulation: start batch
    socket.on('sim:start', (config, callback) => {
      if (socket.data.role !== 'admin') {
        return callback({ success: false, error: 'Admin access required' });
      }

      const mgr = getSimulationManager();
      const result = mgr.startBatch(config, socket.data.userId);
      if ('error' in result) {
        return callback({ success: false, error: result.error });
      }

      if (result.queued) {
        logger.info(
          {
            admin: socket.data.username,
            batchId: result.batchId,
            queuePosition: result.queuePosition,
            totalGames: config.totalGames,
          },
          'Admin queued simulation batch',
        );
        callback({
          success: true,
          batchId: result.batchId,
          queued: true,
          queuePosition: result.queuePosition,
        });
      } else {
        const runner = mgr.getBatch(result.batchId)!;

        // Forward events to the requesting admin socket
        runner.on('progress', (status: any) => socket.emit('sim:progress', status));
        runner.on('gameResult', (gameResult: any) =>
          socket.emit('sim:gameResult', { batchId: result.batchId, result: gameResult }),
        );
        runner.on('completed', (status: any) =>
          socket.emit('sim:completed', { batchId: result.batchId, status }),
        );

        logger.info(
          { admin: socket.data.username, batchId: result.batchId, totalGames: config.totalGames },
          'Admin started simulation batch',
        );
        callback({ success: true, batchId: result.batchId });
      }
    });

    // Simulation: cancel batch
    socket.on('sim:cancel', (data, callback) => {
      if (socket.data.role !== 'admin') {
        return callback({ success: false, error: 'Admin access required' });
      }

      const success = getSimulationManager().cancelBatch(data.batchId);
      callback({ success, error: success ? undefined : 'Batch not found or not running' });
    });

    // Simulation: spectate
    socket.on('sim:spectate', (data, callback) => {
      if (socket.data.role !== 'admin') {
        return callback({ success: false, error: 'Admin access required' });
      }

      const runner = getSimulationManager().getBatch(data.batchId);
      if (!runner || !runner.isActive()) {
        return callback({ success: false, error: 'Batch not found or not running' });
      }

      socket.join(`sim:${data.batchId}`);

      // Send current game state immediately so spectator can init the scene
      const currentState = runner.getCurrentGameState();
      if (currentState) {
        socket.emit('sim:state', { batchId: data.batchId, state: currentState });
      }

      logger.info(
        { admin: socket.data.username, batchId: data.batchId },
        'Admin spectating simulation',
      );
      callback({ success: true });
    });

    // Simulation: stop spectating
    socket.on('sim:unspectate', (data) => {
      socket.leave(`sim:${data.batchId}`);
    });

    // Disconnect
    socket.on('disconnect', async () => {
      logger.info({ userId: socket.data.userId }, 'Socket disconnected');

      const roomCode = await lobbyService.getPlayerRoom(socket.data.userId);
      if (roomCode) {
        const gameRoom = roomManager.getRoom(roomCode);
        if (gameRoom && gameRoom.isRunning()) {
          // Game is running — start grace period, do NOT remove from room yet
          // Player stays in lobby room list so they can reconnect
          gameRoom.handlePlayerDisconnect(socket.data.userId);
        } else {
          // No active game — leave room normally
          const room = await lobbyService.leaveRoom(roomCode, socket.data.userId);
          if (room) {
            io.to(`room:${roomCode}`).emit('room:playerLeft', socket.data.userId);
            io.to(`room:${roomCode}`).emit('room:state', room);
          }
          broadcastRoomList();
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

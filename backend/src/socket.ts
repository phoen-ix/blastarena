import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { getConfig } from './config';
import { logger } from './utils/logger';
import * as lobbyService from './services/lobby';
import { RoomManager } from './game/RoomManager';
import { setRegistry, getSimulationManager, getCampaignGameManager } from './game/registry';
import { createRateLimiters, createSocketRateLimiter } from './utils/socketRateLimit';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  AuthPayload,
  PublicUser,
} from '@blast-arena/shared';
import {
  setupFriendHandlers,
  notifyFriendsOnline,
  notifyFriendsOffline,
  cleanupFriendLimiters,
} from './handlers/friendHandlers';
import {
  setupPartyHandlers,
  handlePartyDisconnect,
  cleanupPartyLimiters,
} from './handlers/partyHandlers';
import { setupLobbyHandlers, cleanupLobbyLimiters } from './handlers/lobbyHandlers';
import { setupDMHandlers, cleanupDMLimiters } from './handlers/dmHandlers';
import * as settingsService from './services/settings';
import * as presenceService from './services/presence';
import * as partyService from './services/party';

type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

// Per-player emote cooldown (3 seconds)
const emoteLastUsed = new Map<number, number>();

// Rematch vote tracking per room
const rematchVotes = new Map<
  string,
  {
    votes: Map<number, { username: string; vote: boolean }>;
    humanPlayerIds: Set<number>;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function createSocketServer(httpServer: HttpServer): TypedServer {
  const allowedOrigin = new URL(getConfig().APP_URL).origin;
  const io: TypedServer = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: {
      origin: allowedOrigin,
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 60000,
    perMessageDeflate: {
      threshold: 256, // Only compress messages larger than 256 bytes
    },
  });

  const roomManager = new RoomManager(io);
  setRegistry(roomManager, io);
  const { inputLimiter, createLimiter, joinLimiter, removeSocket } = createRateLimiters();

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

  let roomListDirty = false;
  function broadcastRoomList() {
    if (roomListDirty) return; // Already scheduled
    roomListDirty = true;
    setImmediate(async () => {
      roomListDirty = false;
      try {
        const rooms = await lobbyService.listRooms();
        io.emit('room:list', rooms);
      } catch (err) {
        logger.error({ err }, 'Failed to broadcast room list');
      }
    });
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

    // Join user-specific room for friend/party notifications
    socket.join(`user:${socket.data.userId}`);

    // Set online presence and notify friends
    presenceService.setPresence(socket.data.userId, 'in_lobby').catch(() => {});
    notifyFriendsOnline(io, socket.data.userId, 'in_lobby');

    // Restore party membership if reconnecting
    const existingPartyId = await partyService.getPlayerParty(socket.data.userId);
    if (existingPartyId) {
      socket.data.activePartyId = existingPartyId;
      socket.join(`party:${existingPartyId}`);
    }

    // Setup friend and party handlers
    setupFriendHandlers(socket, io);
    setupPartyHandlers(socket, io);
    setupLobbyHandlers(socket, io);
    setupDMHandlers(socket, io);

    // Check if player was in an active game (reconnection after disconnect)
    const existingRoomCode = await lobbyService.getPlayerRoom(socket.data.userId);
    if (existingRoomCode) {
      const gameRoom = roomManager.getRoom(existingRoomCode);
      if (gameRoom && gameRoom.isRunning() && gameRoom.isPlayerDisconnected(socket.data.userId)) {
        // Rejoin socket room and resume game
        socket.join(`room:${existingRoomCode}`);
        socket.data.activeRoomCode = existingRoomCode;
        gameRoom.handlePlayerReconnect(socket.data.userId);
        // Send current game state so client can resume
        const fullState = gameRoom.getFullState();
        socket.emit('game:start', fullState);
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
        // Clean up stale room membership (e.g. player refreshed during a game)
        const existingRoom = await lobbyService.getPlayerRoom(socket.data.userId);
        if (existingRoom) {
          const existingGameRoom = roomManager.getRoom(existingRoom);
          if (existingGameRoom && existingGameRoom.isRunning()) {
            existingGameRoom.handlePlayerDisconnect(socket.data.userId);
          }
          await lobbyService.leaveRoom(existingRoom, socket.data.userId);
          socket.leave(`room:${existingRoom}`);
        }

        const room = await lobbyService.createRoom(currentUser, data.name, data.config);
        socket.join(`room:${room.code}`);
        socket.data.activeRoomCode = room.code;
        callback({ success: true, room });
        broadcastRoomList();

        // Party follows leader into room
        if (socket.data.activePartyId) {
          const party = await partyService.getParty(socket.data.activePartyId);
          if (party && party.leaderId === socket.data.userId) {
            socket.to(`party:${party.id}`).emit('party:joinRoom', { roomCode: room.code });
          }
        }
      } catch (err: unknown) {
        callback({ success: false, error: getErrorMessage(err) });
      }
    });

    // Join room
    socket.on('room:join', async (data, callback) => {
      if (!joinLimiter(socket.id)) return;
      try {
        // Clean up stale room membership (e.g. player refreshed during a game)
        const existingRoom = await lobbyService.getPlayerRoom(socket.data.userId);
        if (existingRoom) {
          const existingGameRoom = roomManager.getRoom(existingRoom);
          if (existingGameRoom && existingGameRoom.isRunning()) {
            existingGameRoom.handlePlayerDisconnect(socket.data.userId);
          }
          await lobbyService.leaveRoom(existingRoom, socket.data.userId);
          socket.leave(`room:${existingRoom}`);
        }

        const room = await lobbyService.joinRoom(data.code, currentUser);
        socket.join(`room:${room.code}`);
        socket.data.activeRoomCode = room.code;
        socket
          .to(`room:${room.code}`)
          .emit('room:playerJoined', { user: currentUser, ready: false, team: null });
        callback({ success: true, room });
        broadcastRoomList();

        // Party follows leader into room
        if (socket.data.activePartyId) {
          const party = await partyService.getParty(socket.data.activePartyId);
          if (party && party.leaderId === socket.data.userId) {
            socket.to(`party:${party.id}`).emit('party:joinRoom', { roomCode: room.code });
          }
        }
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
      socket.data.activeRoomCode = undefined;
      if (room) {
        io.to(`room:${roomCode}`).emit('room:playerLeft', socket.data.userId);
        io.to(`room:${roomCode}`).emit('room:state', room);
      }

      // Clean up rematch votes for the leaving player
      for (const [code, voteState] of rematchVotes) {
        if (voteState.votes.has(socket.data.userId)) {
          voteState.votes.delete(socket.data.userId);
          voteState.humanPlayerIds.delete(socket.data.userId);
          if (voteState.humanPlayerIds.size === 0) {
            clearTimeout(voteState.timeout);
            rematchVotes.delete(code);
          } else {
            const threshold = Math.floor(voteState.humanPlayerIds.size / 2) + 1;
            const votesArray = [...voteState.votes.entries()].map(([userId, v]) => ({
              userId,
              username: v.username,
              vote: v.vote,
            }));
            io.to(`room:${code}`).emit('rematch:update' as any, {
              votes: votesArray,
              threshold,
              totalPlayers: voteState.humanPlayerIds.size,
            });
          }
        }
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

        // Update presence for all players in the room to 'in_game'
        for (const player of room.players) {
          presenceService
            .setPresence(player.user.id, 'in_game', {
              roomCode,
              gameMode: room.config.gameMode,
            })
            .catch(() => {});
          notifyFriendsOnline(io, player.user.id, 'in_game');
        }
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

      // Clear any pending rematch votes
      const existingVotes = rematchVotes.get(roomCode);
      if (existingVotes) {
        clearTimeout(existingVotes.timeout);
        rematchVotes.delete(roomCode);
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

    // Rematch voting
    socket.on('rematch:vote', async (data, callback) => {
      const roomCode = await lobbyService.getPlayerRoom(socket.data.userId);
      if (!roomCode) return callback({ success: false, error: 'Not in a room' });

      const room = await lobbyService.getRoom(roomCode);
      if (!room) return callback({ success: false, error: 'Room not found' });
      if (room.status !== 'finished')
        return callback({ success: false, error: 'Game not finished' });

      // Initialize vote tracking if needed
      if (!rematchVotes.has(roomCode)) {
        const humanPlayerIds = new Set(
          room.players.filter((p) => p.user.id > 0).map((p) => p.user.id),
        );
        const timeout = setTimeout(() => {
          rematchVotes.delete(roomCode);
          io.to(`room:${roomCode}`).emit('rematch:update' as any, {
            votes: [],
            threshold: Math.floor(humanPlayerIds.size / 2) + 1,
            totalPlayers: humanPlayerIds.size,
          });
        }, 30000);
        rematchVotes.set(roomCode, { votes: new Map(), humanPlayerIds, timeout });
      }

      const voteState = rematchVotes.get(roomCode)!;
      if (!voteState.humanPlayerIds.has(socket.data.userId)) {
        return callback({ success: false, error: 'Not a player in this game' });
      }

      voteState.votes.set(socket.data.userId, {
        username: socket.data.username,
        vote: data.vote,
      });

      const threshold = Math.floor(voteState.humanPlayerIds.size / 2) + 1;
      const yesVotes = [...voteState.votes.values()].filter((v) => v.vote).length;

      const votesArray = [...voteState.votes.entries()].map(([userId, v]) => ({
        userId,
        username: v.username,
        vote: v.vote,
      }));

      io.to(`room:${roomCode}`).emit('rematch:update' as any, {
        votes: votesArray,
        threshold,
        totalPlayers: voteState.humanPlayerIds.size,
      });

      callback({ success: true });

      // Check if threshold met
      if (yesVotes >= threshold) {
        clearTimeout(voteState.timeout);
        rematchVotes.delete(roomCode);

        // Same restart logic as room:restart
        roomManager.removeRoom(roomCode);
        room.status = 'waiting';
        room.players.forEach((p) => (p.ready = false));
        await lobbyService.updateRoom(roomCode, room);

        io.to(`room:${roomCode}`).emit('rematch:triggered' as any);
        io.to(`room:${roomCode}`).emit('room:state', room);
        broadcastRoomList();
      }
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

    // Game input — hot path, avoid Redis lookup per input
    // Cache the room code on socket data when game starts; cleared on disconnect/leave
    socket.on('game:input', (input) => {
      if (!inputLimiter(socket.id)) return;

      // Runtime validation — TypeScript types are compile-time only
      if (
        typeof input !== 'object' ||
        input === null ||
        typeof input.seq !== 'number' ||
        typeof input.tick !== 'number' ||
        (input.direction !== null &&
          input.direction !== 'up' &&
          input.direction !== 'down' &&
          input.direction !== 'left' &&
          input.direction !== 'right') ||
        (input.action !== null && input.action !== 'bomb' && input.action !== 'detonate')
      ) {
        return;
      }

      const roomCode = socket.data.activeRoomCode;
      if (!roomCode) return;

      const gameRoom = roomManager.getRoom(roomCode);
      if (gameRoom) {
        gameRoom.handleInput(socket.data.userId, input);
      }
    });

    // In-game emotes
    socket.on('game:emote', async (data) => {
      const roomCode = socket.data.activeRoomCode;
      if (!roomCode) return;

      if (typeof data.emoteId !== 'number' || data.emoteId < 0 || data.emoteId > 5) return;

      const emoteMode = await settingsService.getEmoteMode();
      if (emoteMode === 'disabled') return;
      if (emoteMode === 'admin_only' && socket.data.role !== 'admin') return;
      if (emoteMode === 'staff' && socket.data.role !== 'admin' && socket.data.role !== 'moderator')
        return;

      const now = Date.now();
      const last = emoteLastUsed.get(socket.data.userId) ?? 0;
      if (now - last < 3000) return;
      emoteLastUsed.set(socket.data.userId, now);

      io.to(`room:${roomCode}`).emit('game:emote', {
        playerId: socket.data.userId,
        emoteId: data.emoteId as any,
      });
    });

    // Spectator chat
    const spectatorChatLimiter = createSocketRateLimiter(3);

    socket.on('game:spectatorChat', async (data) => {
      const roomCode = socket.data.activeRoomCode;
      if (!roomCode) return;
      if (!data || typeof data.message !== 'string') return;

      const message = data.message.trim().slice(0, 200);
      if (!message) return;

      const mode = await settingsService.getSpectatorChatMode();
      if (mode === 'disabled') return;
      if (mode === 'admin_only' && socket.data.role !== 'admin') return;
      if (mode === 'staff' && socket.data.role !== 'admin' && socket.data.role !== 'moderator')
        return;

      if (!spectatorChatLimiter.isAllowed(socket.id)) return;

      // Verify sender is dead or is admin spectator
      const gameRoom = roomManager.getRoom(roomCode);
      if (gameRoom && gameRoom.isPlayerAlive(socket.data.userId)) return;

      io.to(`room:${roomCode}`).emit('game:spectatorChat' as any, {
        fromUserId: socket.data.userId,
        fromUsername: socket.data.username,
        role: socket.data.role,
        message,
        timestamp: Date.now(),
      });
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

      // Validate and sanitize message
      if (typeof data.message !== 'string' || !data.message.trim()) return;
      const sanitizedMessage = data.message.trim().substring(0, 500);

      io.to(`room:${data.roomCode}`).emit('admin:roomMessage', {
        message: sanitizedMessage,
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

    // Campaign: start level (solo, online co-op, or local co-op)
    socket.on('campaign:start', async (data, callback) => {
      try {
        const campaignManager = getCampaignGameManager();
        const campaignService = await import('./services/campaign');
        const enemyTypeService = await import('./services/enemy-type');
        const progressService = await import('./services/campaign-progress');

        const level = await campaignService.getLevel(data.levelId);
        if (!level || !level.isPublished) {
          return callback({ success: false, error: 'Level not found' });
        }

        // Gather enemy type configs
        const typeIds = [...new Set(level.enemyPlacements.map((e) => Number(e.enemyTypeId)))];
        const enemyTypes = await enemyTypeService.getEnemyTypeConfigs(typeIds);

        // Determine player list based on mode
        const userIds: number[] = [socket.data.userId];
        const usernames: string[] = [socket.data.username];
        let partnerSocket: typeof socket | null = null;

        if (data.coopMode) {
          // Online co-op: party-based
          if (!socket.data.activePartyId) {
            return callback({ success: false, error: 'Must be in a party for online co-op' });
          }
          const party = await partyService.getParty(socket.data.activePartyId);
          if (!party || party.members.length !== 2) {
            return callback({ success: false, error: 'Party must have exactly 2 members' });
          }
          if (party.leaderId !== socket.data.userId) {
            return callback({ success: false, error: 'Only the party leader can start co-op' });
          }
          const partner = party.members.find((m) => m.userId !== socket.data.userId);
          if (!partner) {
            return callback({ success: false, error: 'Partner not found in party' });
          }

          // Find partner's socket
          const partnerSockets = await io.in(`user:${partner.userId}`).fetchSockets();
          if (partnerSockets.length === 0) {
            return callback({ success: false, error: 'Partner is not connected' });
          }
          partnerSocket = partnerSockets[0] as unknown as typeof socket;

          userIds.push(partner.userId);
          usernames.push(partner.username);
        } else if (data.localCoopMode && data.localP2) {
          // Local co-op: P2 from same client
          const p2Id = data.localP2.userId ?? -(1000 + (Date.now() % 10000));
          userIds.push(p2Id);
          usernames.push(data.localP2.username);
        }

        const isCoopMode = userIds.length > 1;
        const campaignRoom = `campaign:${socket.data.userId}`;

        // Get carried powerups if level supports carry-over (use P1's powerups)
        let carriedPowerups = null;
        if (level.carryOverPowerups) {
          const userState = await progressService.getUserState(socket.data.userId);
          carriedPowerups = userState.carriedPowerups;
        }

        // Record attempt for all real (positive ID) players
        for (const uid of userIds) {
          if (uid > 0) {
            await progressService.recordAttempt(uid, level.id);
            await progressService.updateCurrentLevel(uid, level.worldId, level.id);
          }
        }

        const nextLevelId = await campaignService.getNextLevel(level.id);

        // Emit helper: broadcast to campaign room (both players) or single socket
        const emitToCampaign = (event: string, ...args: unknown[]) => {
          io.to(campaignRoom).emit(event as any, ...args);
        };

        const game = campaignManager.startLevel(
          userIds,
          usernames,
          level,
          enemyTypes,
          {
            onStateUpdate: (state) => {
              emitToCampaign('campaign:state', state);
            },
            onPlayerDied: (playerId, livesRemaining, respawnPosition) => {
              emitToCampaign('campaign:playerDied', { playerId, livesRemaining, respawnPosition });
            },
            onEnemyDied: (enemyId, position, isBoss) => {
              emitToCampaign('campaign:enemyDied', { enemyId, position, isBoss });
            },
            onExitOpened: (position) => {
              emitToCampaign('campaign:exitOpened', { position });
            },
            onPlayerLockedIn: (playerId, position) => {
              emitToCampaign('campaign:playerLockedIn', { playerId, position });
            },
            onLevelComplete: async (timeSeconds, deaths) => {
              // Record completion for all real players
              let stars = 0;
              for (const uid of userIds) {
                if (uid > 0) {
                  stars = await progressService.recordCompletion(
                    uid,
                    level.id,
                    timeSeconds,
                    deaths,
                    level.parTime,
                  );
                }
              }
              emitToCampaign('campaign:levelComplete', {
                levelId: level.id,
                timeSeconds,
                stars,
                nextLevelId,
              });

              // Evaluate campaign achievements for all real players
              for (const uid of userIds) {
                if (uid <= 0) continue;
                try {
                  const achievementsService = await import('./services/achievements');
                  const cosmeticsService = await import('./services/cosmetics');
                  const userState = await progressService.getUserState(uid);
                  const totalStars = userState.totalStars;
                  const unlocked = await achievementsService.evaluateAfterCampaign(
                    uid,
                    totalStars,
                    level.id,
                    level.worldId,
                  );
                  await cosmeticsService.checkCampaignStarUnlocks(uid, totalStars);
                  if (unlocked.achievements.length > 0) {
                    io.to(`user:${uid}`).emit('achievement:unlocked', unlocked);
                  }
                } catch (achErr) {
                  logger.error(
                    { err: achErr, userId: uid },
                    'Failed to evaluate campaign achievements',
                  );
                }
              }

              // Clean up sessions
              if (partnerSocket) {
                partnerSocket.data.activeCampaignSession = undefined;
                partnerSocket.leave(campaignRoom);
              }
              socket.data.activeCampaignSession = undefined;
              socket.leave(campaignRoom);
              campaignManager.endSession(game.sessionId);
            },
            onGameOver: (reason) => {
              emitToCampaign('campaign:gameOver', { levelId: level.id, reason });
              if (partnerSocket) {
                partnerSocket.data.activeCampaignSession = undefined;
                partnerSocket.leave(campaignRoom);
              }
              socket.data.activeCampaignSession = undefined;
              socket.leave(campaignRoom);
              campaignManager.endSession(game.sessionId);
            },
          },
          carriedPowerups,
        );

        // Join campaign room
        socket.join(campaignRoom);
        socket.data.activeCampaignSession = game.sessionId;

        if (partnerSocket) {
          partnerSocket.join(campaignRoom);
          partnerSocket.data.activeCampaignSession = game.sessionId;
        }

        // Build level summary for client
        const levelSummary = {
          id: level.id,
          worldId: level.worldId,
          name: level.name,
          description: level.description,
          sortOrder: level.sortOrder,
          mapWidth: level.mapWidth,
          mapHeight: level.mapHeight,
          winCondition: level.winCondition,
          lives: level.lives,
          timeLimit: level.timeLimit,
          parTime: level.parTime,
          enemyCount: level.enemyPlacements.length,
          isPublished: level.isPublished,
        };

        game.start();

        // Update presence for all real players
        for (const uid of userIds) {
          if (uid > 0) {
            presenceService.setPresence(uid, 'in_campaign').catch(() => {});
            notifyFriendsOnline(io, uid, 'in_campaign');
          }
        }

        // Build initial state
        const initialState = {
          state: {
            gameState: game['gameState'].toState(),
            enemies: Array.from(game['enemies'].values()).map((e) => e.toState()),
            lives: game['lives'],
            maxLives: game['maxLives'],
            levelId: level.id,
            exitOpen: false,
            coopMode: isCoopMode,
          },
          level: levelSummary,
        };

        callback({ success: true });
        socket.emit('campaign:gameStart', initialState);

        // Send coopStart to partner (online co-op only)
        if (partnerSocket) {
          const enemyTypeConfigs = Array.from(enemyTypes.values());
          partnerSocket.emit('campaign:coopStart', {
            state: initialState.state as any,
            level: levelSummary,
            enemyTypes: enemyTypeConfigs,
          });
        }

        logger.info(
          {
            levelId: level.id,
            levelName: level.name,
            coopMode: isCoopMode,
            playerCount: userIds.length,
          },
          'Campaign level started',
        );
      } catch (err) {
        logger.error({ err }, 'Campaign start error');
        callback({ success: false, error: getErrorMessage(err) });
      }
    });

    // Campaign: player input
    socket.on('campaign:input', (input) => {
      const sessionId = socket.data.activeCampaignSession;
      if (!sessionId) return;
      // For local co-op, playerId is specified in the input payload
      // For online co-op/solo, use the socket's userId
      const userId = input.playerId ?? socket.data.userId;

      // Validate: only allow playerId that belongs to this session
      const game = getCampaignGameManager().getSession(sessionId);
      if (!game || !game.userIds.includes(userId)) return;

      getCampaignGameManager().handleInput(sessionId, userId, input);
    });

    // Campaign: pause (either player can pause for both)
    socket.on('campaign:pause', (callback) => {
      const sessionId = socket.data.activeCampaignSession;
      if (!sessionId) return callback({ success: false });
      const ok = getCampaignGameManager().pauseSession(sessionId);
      callback({ success: ok });
    });

    // Campaign: resume (either player can resume)
    socket.on('campaign:resume', (callback) => {
      const sessionId = socket.data.activeCampaignSession;
      if (!sessionId) return callback({ success: false });
      const ok = getCampaignGameManager().resumeSession(sessionId);
      callback({ success: ok });
    });

    // Campaign: quit
    socket.on('campaign:quit', () => {
      const sessionId = socket.data.activeCampaignSession;
      if (!sessionId) return;

      const campaignManager = getCampaignGameManager();
      const game = campaignManager.getSession(sessionId);

      if (game && game.coopMode) {
        // Co-op: remove this player, notify partner
        campaignManager.removePlayer(sessionId, socket.data.userId);
        const campaignRoom = `campaign:${game.userIds[0]}`;
        socket.to(campaignRoom).emit('campaign:partnerLeft', { reason: 'quit' });
        socket.leave(campaignRoom);
      } else {
        campaignManager.endSession(sessionId);
      }

      socket.data.activeCampaignSession = undefined;
    });

    // Buddy mode input stub — no-op for now
    socket.on('campaign:buddyInput', () => {
      // Future: route to BuddyEntity in active campaign session
    });

    // Disconnect
    socket.on('disconnect', async () => {
      logger.info({ userId: socket.data.userId }, 'Socket disconnected');
      removeSocket(socket.id);
      cleanupFriendLimiters(socket.id);
      cleanupPartyLimiters(socket.id);
      cleanupLobbyLimiters(socket.id);
      cleanupDMLimiters(socket.id);
      emoteLastUsed.delete(socket.data.userId);
      socket.data.activeRoomCode = undefined;

      // Clean up rematch votes for the disconnecting player
      for (const [code, voteState] of rematchVotes) {
        if (voteState.votes.has(socket.data.userId)) {
          voteState.votes.delete(socket.data.userId);
          voteState.humanPlayerIds.delete(socket.data.userId);
          if (voteState.humanPlayerIds.size === 0) {
            clearTimeout(voteState.timeout);
            rematchVotes.delete(code);
          } else {
            const threshold = Math.floor(voteState.humanPlayerIds.size / 2) + 1;
            const votesArray = [...voteState.votes.entries()].map(([userId, v]) => ({
              userId,
              username: v.username,
              vote: v.vote,
            }));
            io.to(`room:${code}`).emit('rematch:update' as any, {
              votes: votesArray,
              threshold,
              totalPlayers: voteState.humanPlayerIds.size,
            });
          }
        }
      }

      // Remove presence and notify friends offline
      presenceService.removePresence(socket.data.userId).catch(() => {});
      notifyFriendsOffline(io, socket.data.userId);

      // Handle party disconnect (leave/disband)
      await handlePartyDisconnect(socket, io);

      // Clean up campaign session
      if (socket.data.activeCampaignSession) {
        const campaignManager = getCampaignGameManager();
        const game = campaignManager.getSession(socket.data.activeCampaignSession);

        if (game && game.coopMode) {
          // Co-op: remove this player, notify partner, keep game alive
          campaignManager.removePlayer(socket.data.activeCampaignSession, socket.data.userId);
          const campaignRoom = `campaign:${game.userIds[0]}`;
          io.to(campaignRoom).emit('campaign:partnerLeft', { reason: 'disconnected' });
        } else {
          campaignManager.endSession(socket.data.activeCampaignSession);
        }
        socket.data.activeCampaignSession = undefined;
      }

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

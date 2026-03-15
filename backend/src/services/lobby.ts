import { v4 as uuidv4 } from 'uuid';
import { getRedis } from '../db/redis';
import { Room, RoomListItem, MatchConfig } from '@blast-arena/shared';
import { PublicUser } from '@blast-arena/shared';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

function generateRoomCode(): string {
  return uuidv4().substring(0, 6).toUpperCase();
}

export async function createRoom(
  host: PublicUser,
  name: string,
  config: MatchConfig,
): Promise<Room> {
  const redis = getRedis();
  const code = generateRoomCode();

  const room: Room = {
    code,
    name,
    host,
    players: [{ user: host, ready: false, team: null }],
    config,
    status: 'waiting',
    createdAt: new Date(),
  };

  await redis.set(`room:${code}`, JSON.stringify(room), 'EX', 3600); // 1 hour TTL
  await redis.set(`player:${host.id}:room`, code, 'EX', 3600);

  logger.info({ code, host: host.username }, 'Room created');
  return room;
}

export async function getRoom(code: string): Promise<Room | null> {
  const redis = getRedis();
  const data = await redis.get(`room:${code}`);
  if (!data) return null;
  return JSON.parse(data);
}

export async function listRooms(): Promise<RoomListItem[]> {
  const redis = getRedis();
  const keys = await redis.keys('room:*');
  const rooms: RoomListItem[] = [];

  for (const key of keys) {
    const data = await redis.get(key);
    if (!data) continue;

    const room: Room = JSON.parse(data);
    if (room.status === 'waiting' || room.status === 'playing') {
      rooms.push({
        code: room.code,
        name: room.name,
        host: room.host.username,
        playerCount: room.players.length,
        maxPlayers: room.config.maxPlayers,
        gameMode: room.config.gameMode,
        status: room.status === 'waiting' ? 'waiting' : 'playing',
      });
    }
  }

  return rooms;
}

export async function joinRoom(code: string, user: PublicUser): Promise<Room> {
  const redis = getRedis();
  const room = await getRoom(code);

  if (!room) {
    throw new AppError('Room not found', 404, 'NOT_FOUND');
  }

  if (room.status !== 'waiting') {
    throw new AppError('Game already in progress', 400, 'GAME_IN_PROGRESS');
  }

  if (room.players.length >= room.config.maxPlayers) {
    throw new AppError('Room is full', 400, 'ROOM_FULL');
  }

  if (room.players.some((p) => p.user.id === user.id)) {
    throw new AppError('Already in this room', 400, 'ALREADY_IN_ROOM');
  }

  room.players.push({ user, ready: false, team: null });

  await redis.set(`room:${code}`, JSON.stringify(room), 'EX', 3600);
  await redis.set(`player:${user.id}:room`, code, 'EX', 3600);

  return room;
}

export async function leaveRoom(code: string, userId: number): Promise<Room | null> {
  const redis = getRedis();
  const room = await getRoom(code);

  if (!room) return null;

  room.players = room.players.filter((p) => p.user.id !== userId);
  await redis.del(`player:${userId}:room`);

  if (room.players.length === 0) {
    await redis.del(`room:${code}`);
    return null;
  }

  // Transfer host if needed
  if (room.host.id === userId) {
    room.host = room.players[0].user;
  }

  await redis.set(`room:${code}`, JSON.stringify(room), 'EX', 3600);
  return room;
}

export async function setPlayerReady(code: string, userId: number, ready: boolean): Promise<Room> {
  const redis = getRedis();
  const room = await getRoom(code);

  if (!room) throw new AppError('Room not found', 404, 'NOT_FOUND');

  const player = room.players.find((p) => p.user.id === userId);
  if (!player) throw new AppError('Not in this room', 400, 'NOT_IN_ROOM');

  player.ready = ready;

  await redis.set(`room:${code}`, JSON.stringify(room), 'EX', 3600);
  return room;
}

export async function setPlayerTeam(
  code: string,
  targetUserId: number,
  team: number | null,
): Promise<Room> {
  const redis = getRedis();
  const room = await getRoom(code);

  if (!room) throw new AppError('Room not found', 404, 'NOT_FOUND');

  const player = room.players.find((p) => p.user.id === targetUserId);
  if (!player) throw new AppError('Player not in this room', 400, 'NOT_IN_ROOM');

  player.team = team;

  await redis.set(`room:${code}`, JSON.stringify(room), 'EX', 3600);
  return room;
}

export async function updateRoom(code: string, room: Room): Promise<void> {
  const redis = getRedis();
  await redis.set(`room:${code}`, JSON.stringify(room), 'EX', 3600);
}

export async function updateRoomStatus(code: string, status: Room['status']): Promise<void> {
  const redis = getRedis();
  const room = await getRoom(code);
  if (!room) return;

  room.status = status;
  await redis.set(`room:${code}`, JSON.stringify(room), 'EX', 3600);
}

export async function getPlayerRoom(userId: number): Promise<string | null> {
  const redis = getRedis();
  return redis.get(`player:${userId}:room`);
}

export async function deleteRoom(code: string): Promise<void> {
  const redis = getRedis();
  const room = await getRoom(code);
  if (room) {
    for (const player of room.players) {
      await redis.del(`player:${player.user.id}:room`);
    }
  }
  await redis.del(`room:${code}`);
}

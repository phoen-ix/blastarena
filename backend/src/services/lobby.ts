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

  // Collect all room keys using non-blocking SCAN instead of O(N) KEYS
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', 'room:*', 'COUNT', 100);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');

  if (keys.length === 0) return [];

  // Fetch all values in a single MGET round-trip instead of sequential GETs
  const values = await redis.mget(...keys);
  const rooms: RoomListItem[] = [];

  for (const data of values) {
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

// Lua script for atomic join: reads room, validates, adds player, writes back
// KEYS[1] = room key, KEYS[2] = player:userId:room key
// ARGV[1] = user JSON, ARGV[2] = user id (string)
// Returns: room JSON on success, or error string prefixed with "ERR:"
const JOIN_ROOM_LUA = `
local data = redis.call('GET', KEYS[1])
if not data then
  return 'ERR:NOT_FOUND'
end

local room = cjson.decode(data)

if room.status ~= 'waiting' then
  return 'ERR:GAME_IN_PROGRESS'
end

if #room.players >= room.config.maxPlayers then
  return 'ERR:ROOM_FULL'
end

local userId = tonumber(ARGV[2])
for _, p in ipairs(room.players) do
  if p.user.id == userId then
    return 'ERR:ALREADY_IN_ROOM'
  end
end

local user = cjson.decode(ARGV[1])
table.insert(room.players, { user = user, ready = false, team = cjson.null })

local updated = cjson.encode(room)
redis.call('SET', KEYS[1], updated, 'EX', 3600)
redis.call('SET', KEYS[2], room.code, 'EX', 3600)

return updated
`;

const JOIN_ERROR_MAP: Record<string, { message: string; status: number; code: string }> = {
  NOT_FOUND: { message: 'Room not found', status: 404, code: 'NOT_FOUND' },
  GAME_IN_PROGRESS: { message: 'Game already in progress', status: 400, code: 'GAME_IN_PROGRESS' },
  ROOM_FULL: { message: 'Room is full', status: 400, code: 'ROOM_FULL' },
  ALREADY_IN_ROOM: { message: 'Already in this room', status: 400, code: 'ALREADY_IN_ROOM' },
};

export async function joinRoom(code: string, user: PublicUser): Promise<Room> {
  const redis = getRedis();

  const result = await redis.eval(
    JOIN_ROOM_LUA,
    2,
    `room:${code}`,
    `player:${user.id}:room`,
    JSON.stringify(user),
    String(user.id),
  ) as string;

  if (result.startsWith('ERR:')) {
    const errorCode = result.slice(4);
    const err = JOIN_ERROR_MAP[errorCode];
    if (err) {
      throw new AppError(err.message, err.status, err.code);
    }
    throw new AppError('Join failed', 500);
  }

  return JSON.parse(result);
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

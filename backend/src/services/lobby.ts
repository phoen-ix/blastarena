import { v4 as uuidv4 } from 'uuid';
import { getRedis } from '../db/redis';
import { Room, RoomListItem, MatchConfig } from '@blast-arena/shared';
import { PublicUser } from '@blast-arena/shared';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const ROOM_TTL_SECONDS = 3600; // 1 hour

/**
 * Set of live room codes.
 *
 * listRooms used to find rooms with `SCAN MATCH room:*` over the entire keyspace — which it shares
 * with player:*, invite:*, presence:* and every rate-limit key — on every single lobby mutation.
 *
 * The index cannot be kept perfectly in step by writes alone: room keys carry a TTL and nothing
 * reaps them, so a room that simply goes quiet expires without any code path running. listRooms
 * therefore treats a member whose key has vanished as a tombstone and removes it, which makes the
 * index self-healing. (audit LOBBY-SCAN-1)
 */
const ROOM_INDEX_KEY = 'rooms:index';

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

  await redis.set(`room:${code}`, JSON.stringify(room), 'EX', ROOM_TTL_SECONDS);
  await redis.set(`player:${host.id}:room`, code, 'EX', ROOM_TTL_SECONDS);
  await redis.sadd(ROOM_INDEX_KEY, code);

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

  // Room codes come from the index rather than a keyspace SCAN.
  const codes = await redis.smembers(ROOM_INDEX_KEY);
  if (codes.length === 0) return [];

  const values = await redis.mget(...codes.map((c) => `room:${c}`));
  const rooms: RoomListItem[] = [];
  const stale: string[] = [];

  for (let i = 0; i < codes.length; i++) {
    const data = values[i];
    if (!data) {
      // The key expired (rooms carry a TTL and nothing reaps them) or was removed without going
      // through deleteRoom. Drop the tombstone so the index heals itself. (audit LOBBY-SCAN-1)
      stale.push(codes[i]);
      continue;
    }
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
        customMapName: room.customMapName,
      });
    }
  }

  if (stale.length > 0) {
    await redis.srem(ROOM_INDEX_KEY, ...stale);
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
redis.call('SET', KEYS[1], updated, 'EX', ${ROOM_TTL_SECONDS})
redis.call('SET', KEYS[2], room.code, 'EX', ${ROOM_TTL_SECONDS})

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

  const result = (await redis.eval(
    JOIN_ROOM_LUA,
    2,
    `room:${code}`,
    `player:${user.id}:room`,
    JSON.stringify(user),
    String(user.id),
  )) as string;

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

// Lua script for atomic leave: removes player, transfers host if needed, deletes empty rooms
// KEYS[1] = room key, KEYS[2] = player:userId:room key
// ARGV[1] = userId
// Returns: updated room JSON, "DELETED" if room empty, or "ERR:NOT_FOUND"
const LEAVE_ROOM_LUA = `
local data = redis.call('GET', KEYS[1])
if not data then
  return 'ERR:NOT_FOUND'
end

local room = cjson.decode(data)
redis.call('DEL', KEYS[2])

local newPlayers = {}
for _, p in ipairs(room.players) do
  if p.user.id ~= tonumber(ARGV[1]) then
    table.insert(newPlayers, p)
  end
end

if #newPlayers == 0 then
  redis.call('DEL', KEYS[1])
  -- Drop it from the room index atomically with the delete, so a crash between Lua and JS
  -- cannot orphan the index. (audit LOBBY-SCAN-1)
  redis.call('SREM', KEYS[3], room.code)
  return 'DELETED'
end

room.players = newPlayers

if room.host.id == tonumber(ARGV[1]) then
  room.host = newPlayers[1].user
end

local updated = cjson.encode(room)
redis.call('SET', KEYS[1], updated, 'EX', ${ROOM_TTL_SECONDS})
return updated
`;

// Lua script for atomic ready toggle
// KEYS[1] = room key
// ARGV[1] = userId, ARGV[2] = "true" or "false"
// Returns: updated room JSON or ERR:*
const SET_READY_LUA = `
local data = redis.call('GET', KEYS[1])
if not data then
  return 'ERR:NOT_FOUND'
end

local room = cjson.decode(data)
local found = false
local userId = tonumber(ARGV[1])
local ready = ARGV[2] == 'true'

for _, p in ipairs(room.players) do
  if p.user.id == userId then
    p.ready = ready
    found = true
    break
  end
end

if not found then
  return 'ERR:NOT_IN_ROOM'
end

local updated = cjson.encode(room)
redis.call('SET', KEYS[1], updated, 'EX', ${ROOM_TTL_SECONDS})
return updated
`;

// Lua script for atomic team assignment
// KEYS[1] = room key
// ARGV[1] = userId, ARGV[2] = team number or "null"
// Returns: updated room JSON or ERR:*
const SET_TEAM_LUA = `
local data = redis.call('GET', KEYS[1])
if not data then
  return 'ERR:NOT_FOUND'
end

local room = cjson.decode(data)
local found = false
local userId = tonumber(ARGV[1])
local team = ARGV[2] == 'null' and cjson.null or tonumber(ARGV[2])

for _, p in ipairs(room.players) do
  if p.user.id == userId then
    p.team = team
    found = true
    break
  end
end

if not found then
  return 'ERR:NOT_IN_ROOM'
end

local updated = cjson.encode(room)
redis.call('SET', KEYS[1], updated, 'EX', ${ROOM_TTL_SECONDS})
return updated
`;

// Lua script for atomic host-checked team assignment
// KEYS[1] = room key
// ARGV[1] = hostUserId, ARGV[2] = targetUserId, ARGV[3] = team number or "null"
// Returns: updated room JSON or ERR:*
const SET_TEAM_AS_HOST_LUA = `
local data = redis.call('GET', KEYS[1])
if not data then
  return 'ERR:NOT_FOUND'
end

local room = cjson.decode(data)

if room.host.id ~= tonumber(ARGV[1]) then
  return 'ERR:NOT_HOST'
end

local found = false
local userId = tonumber(ARGV[2])
local team = ARGV[3] == 'null' and cjson.null or tonumber(ARGV[3])

for _, p in ipairs(room.players) do
  if p.user.id == userId then
    p.team = team
    found = true
    break
  end
end

if not found then
  return 'ERR:NOT_IN_ROOM'
end

local updated = cjson.encode(room)
redis.call('SET', KEYS[1], updated, 'EX', ${ROOM_TTL_SECONDS})
return updated
`;

// Lua script for atomic host-checked bot team assignment
// KEYS[1] = room key
// ARGV[1] = hostUserId, ARGV[2] = botIndex, ARGV[3] = team number or "null"
// Returns: updated room JSON or ERR:*
const SET_BOT_TEAM_AS_HOST_LUA = `
local data = redis.call('GET', KEYS[1])
if not data then
  return 'ERR:NOT_FOUND'
end

local room = cjson.decode(data)

if room.host.id ~= tonumber(ARGV[1]) then
  return 'ERR:NOT_HOST'
end

local botIndex = tonumber(ARGV[2])
local botCount = room.config.botCount or 0
if botIndex < 0 or botIndex >= botCount then
  return 'ERR:INVALID_BOT_INDEX'
end

local team = ARGV[3] == 'null' and cjson.null or tonumber(ARGV[3])

if not room.config.botTeams then
  room.config.botTeams = {}
end
while #room.config.botTeams < botCount do
  table.insert(room.config.botTeams, cjson.null)
end
room.config.botTeams[botIndex + 1] = team

local updated = cjson.encode(room)
redis.call('SET', KEYS[1], updated, 'EX', ${ROOM_TTL_SECONDS})
return updated
`;

// Lua script for atomic room start: only succeeds if status is 'waiting'
// KEYS[1] = room key
// ARGV[1] = new status ('countdown')
// Returns: updated room JSON or ERR:*
const START_ROOM_LUA = `
local data = redis.call('GET', KEYS[1])
if not data then
  return 'ERR:NOT_FOUND'
end

local room = cjson.decode(data)
if room.status ~= 'waiting' then
  return 'ERR:ALREADY_STARTING'
end

room.status = ARGV[1]
local updated = cjson.encode(room)
redis.call('SET', KEYS[1], updated, 'EX', ${ROOM_TTL_SECONDS})
return updated
`;

export async function leaveRoom(code: string, userId: number): Promise<Room | null> {
  const redis = getRedis();

  const result = (await redis.eval(
    LEAVE_ROOM_LUA,
    3,
    `room:${code}`,
    `player:${userId}:room`,
    ROOM_INDEX_KEY,
    String(userId),
  )) as string;

  if (result === 'ERR:NOT_FOUND') return null;
  if (result === 'DELETED') return null;

  return JSON.parse(result);
}

export async function setPlayerReady(code: string, userId: number, ready: boolean): Promise<Room> {
  const redis = getRedis();

  const result = (await redis.eval(
    SET_READY_LUA,
    1,
    `room:${code}`,
    String(userId),
    String(ready),
  )) as string;

  if (result === 'ERR:NOT_FOUND') throw new AppError('Room not found', 404, 'NOT_FOUND');
  if (result === 'ERR:NOT_IN_ROOM') throw new AppError('Not in this room', 400, 'NOT_IN_ROOM');

  return JSON.parse(result);
}

export async function setPlayerTeam(
  code: string,
  targetUserId: number,
  team: number | null,
): Promise<Room> {
  const redis = getRedis();

  const result = (await redis.eval(
    SET_TEAM_LUA,
    1,
    `room:${code}`,
    String(targetUserId),
    team === null ? 'null' : String(team),
  )) as string;

  if (result === 'ERR:NOT_FOUND') throw new AppError('Room not found', 404, 'NOT_FOUND');
  if (result === 'ERR:NOT_IN_ROOM')
    throw new AppError('Player not in this room', 400, 'NOT_IN_ROOM');

  return JSON.parse(result);
}

export async function setPlayerTeamAsHost(
  code: string,
  hostUserId: number,
  targetUserId: number,
  team: number | null,
): Promise<Room> {
  const redis = getRedis();

  const result = (await redis.eval(
    SET_TEAM_AS_HOST_LUA,
    1,
    `room:${code}`,
    String(hostUserId),
    String(targetUserId),
    team === null ? 'null' : String(team),
  )) as string;

  if (result === 'ERR:NOT_FOUND') throw new AppError('Room not found', 404, 'NOT_FOUND');
  if (result === 'ERR:NOT_HOST')
    throw new AppError('Only the host can assign teams', 403, 'NOT_HOST');
  if (result === 'ERR:NOT_IN_ROOM')
    throw new AppError('Player not in this room', 400, 'NOT_IN_ROOM');

  return JSON.parse(result);
}

export async function setBotTeamAsHost(
  code: string,
  hostUserId: number,
  botIndex: number,
  team: number | null,
): Promise<Room> {
  const redis = getRedis();

  const result = (await redis.eval(
    SET_BOT_TEAM_AS_HOST_LUA,
    1,
    `room:${code}`,
    String(hostUserId),
    String(botIndex),
    team === null ? 'null' : String(team),
  )) as string;

  if (result === 'ERR:NOT_FOUND') throw new AppError('Room not found', 404, 'NOT_FOUND');
  if (result === 'ERR:NOT_HOST')
    throw new AppError('Only the host can assign bot teams', 403, 'NOT_HOST');
  if (result === 'ERR:INVALID_BOT_INDEX')
    throw new AppError('Invalid bot index', 400, 'INVALID_BOT_INDEX');

  return JSON.parse(result);
}

export async function updateRoom(code: string, room: Room): Promise<void> {
  const redis = getRedis();
  await redis.set(`room:${code}`, JSON.stringify(room), 'EX', ROOM_TTL_SECONDS);
}

/**
 * Atomically start a room — only succeeds if current status is 'waiting'.
 * Prevents TOCTOU race where two concurrent room:start events both pass the guard.
 * Returns the updated room, or null if room not found / already starting.
 */
export async function startRoom(code: string): Promise<Room | null> {
  const redis = getRedis();

  const result = (await redis.eval(START_ROOM_LUA, 1, `room:${code}`, 'countdown')) as string;

  if (result.startsWith('ERR:')) return null;

  return JSON.parse(result);
}

// Atomically set a room's status, preserving all other fields. The previous JS read-modify-write
// could lose concurrent mutations and let a status revert race a concurrent room:start. An optional
// expectedStatus performs a compare-and-swap so a revert only applies if the status is unchanged.
// KEYS[1]=room key, ARGV[1]=new status, ARGV[2]=expected status ('' = no check). (audit REDIS-RACE-2)
const SET_ROOM_STATUS_LUA = `
local data = redis.call('GET', KEYS[1])
if not data then
  return 'ERR:NOT_FOUND'
end
local room = cjson.decode(data)
if ARGV[2] ~= '' and room.status ~= ARGV[2] then
  return 'ERR:STATUS_MISMATCH'
end
room.status = ARGV[1]
local updated = cjson.encode(room)
redis.call('SET', KEYS[1], updated, 'EX', ${ROOM_TTL_SECONDS})
return updated
`;

export async function updateRoomStatus(
  code: string,
  status: Room['status'],
  expectedStatus?: Room['status'],
): Promise<void> {
  const redis = getRedis();
  await redis.eval(SET_ROOM_STATUS_LUA, 1, `room:${code}`, status, expectedStatus ?? '');
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
  await redis.srem(ROOM_INDEX_KEY, code);
}

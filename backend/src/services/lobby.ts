import { randomUUID } from 'crypto';
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
  return randomUUID().substring(0, 6).toUpperCase();
}

/** MatchConfig fields that hold arrays. */
const CONFIG_ARRAY_FIELDS = [
  'enabledPowerUps',
  'botTeams',
  'selectedHazardTiles',
  'selectedMapEvents',
  'selectedPuzzleTiles',
] as const;

/**
 * Parse a room read back from Redis.
 *
 * Every Lua script round-trips the room through cjson, which encodes an empty Lua table as `{}`. An
 * empty array in the config therefore came back as an object — `enabledPowerUps: []` (host disabled
 * every power-up) reached the game as `{}`, and the first power-up rain or spectator drop threw on
 * every tick until the loop's circuit breaker ended the match. Arrays are restored here, so no
 * consumer ever sees `{}`.
 */
export function parseRoom(json: string): Room {
  const room = JSON.parse(json) as Room;
  const config = room.config as unknown as Record<string, unknown>;
  for (const field of CONFIG_ARRAY_FIELDS) {
    const value = config[field];
    if (value != null && !Array.isArray(value)) {
      config[field] = typeof value === 'object' ? Object.values(value) : [];
    }
  }
  if (!Array.isArray(room.players)) {
    room.players =
      room.players && typeof room.players === 'object' ? Object.values(room.players) : [];
  }
  return room;
}

/** Attempts at a fresh code before giving up; six hex digits make a clash rare, never impossible. */
const CREATE_ROOM_ATTEMPTS = 5;

export async function createRoom(
  host: PublicUser,
  name: string,
  config: MatchConfig,
  customMapName?: string,
): Promise<Room> {
  const redis = getRedis();

  for (let attempt = 0; attempt < CREATE_ROOM_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    const room: Room = {
      code,
      name,
      host,
      players: [{ user: host, ready: false, team: null }],
      config,
      status: 'waiting',
      createdAt: new Date(),
      ...(customMapName ? { customMapName } : {}),
    };

    // NX: a code that is already live is never overwritten. A plain SET replaced the other room
    // in place, players and all, whenever two creations drew the same six hex digits.
    const created = await redis.set(
      `room:${code}`,
      JSON.stringify(room),
      'EX',
      ROOM_TTL_SECONDS,
      'NX',
    );
    if (created !== 'OK') continue;

    await redis.set(`player:${host.id}:room`, code, 'EX', ROOM_TTL_SECONDS);
    await redis.sadd(ROOM_INDEX_KEY, code);

    logger.info({ code, host: host.username }, 'Room created');
    return room;
  }
  throw new AppError('Could not allocate a room code, please retry', 503, 'ROOM_CODE_EXHAUSTED');
}

export async function getRoom(code: string): Promise<Room | null> {
  const redis = getRedis();
  const data = await redis.get(`room:${code}`);
  if (!data) return null;
  return parseRoom(data);
}

/** Waiting and playing rooms, in full (the admin Rooms tab needs the players). */
export async function listActiveRooms(): Promise<Room[]> {
  const redis = getRedis();

  // Room codes come from the index rather than a keyspace SCAN.
  const codes = await redis.smembers(ROOM_INDEX_KEY);
  if (codes.length === 0) return [];

  const values = await redis.mget(...codes.map((c) => `room:${c}`));
  const rooms: Room[] = [];
  const stale: string[] = [];

  for (let i = 0; i < codes.length; i++) {
    const data = values[i];
    if (!data) {
      // The key expired (rooms carry a TTL and nothing reaps them) or was removed without going
      // through deleteRoom. Drop the tombstone so the index heals itself. (audit LOBBY-SCAN-1)
      stale.push(codes[i]);
      continue;
    }
    const room = parseRoom(data);
    if (room.status === 'waiting' || room.status === 'playing') rooms.push(room);
  }

  if (stale.length > 0) {
    await redis.srem(ROOM_INDEX_KEY, ...stale);
  }

  return rooms;
}

export async function listRooms(): Promise<RoomListItem[]> {
  return (await listActiveRooms()).map((room) => ({
    code: room.code,
    name: room.name,
    host: room.host.username,
    playerCount: room.players.length,
    maxPlayers: room.config.maxPlayers,
    gameMode: room.config.gameMode,
    status: room.status === 'waiting' ? 'waiting' : 'playing',
    customMapName: room.customMapName,
  }));
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

  return parseRoom(throwIfScriptError(result, JOIN_ERROR_MAP));
}

// Lua script for atomic leave: removes player, transfers host if needed, deletes empty rooms
// KEYS[1] = room key, KEYS[2] = player:userId:room key, KEYS[3] = room index
// ARGV[1] = userId, ARGV[2] = room code
// Returns: updated room JSON, "DELETED" if room empty, or "ERR:NOT_FOUND"
const LEAVE_ROOM_LUA = `
local data = redis.call('GET', KEYS[1])
-- Only clear the player->room mapping when it points at this room: a leave for a stale code (a
-- moderator kick, an old socket) used to wipe the mapping of the room the player is really in.
if redis.call('GET', KEYS[2]) == ARGV[2] then
  redis.call('DEL', KEYS[2])
end
if not data then
  return 'ERR:NOT_FOUND'
end

local room = cjson.decode(data)

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

// Lua script for atomic room start. Every precondition is checked here, against the room as it is
// now: the handler used to check host, readiness and player count on a read taken before this
// script ran, so a player who un-readied (or a host who left) in between was started anyway.
// KEYS[1] = room key
// ARGV[1] = new status ('countdown'), ARGV[2] = requesting user id
// Returns: updated room JSON or ERR:*
const START_ROOM_LUA = `
local data = redis.call('GET', KEYS[1])
if not data then
  return 'ERR:NOT_FOUND'
end

local room = cjson.decode(data)
if room.host.id ~= tonumber(ARGV[2]) then
  return 'ERR:NOT_HOST'
end
if room.status ~= 'waiting' then
  return 'ERR:ALREADY_STARTING'
end

for _, p in ipairs(room.players) do
  if p.user.id ~= room.host.id and p.ready ~= true then
    return 'ERR:NOT_READY'
  end
end

local botCount = tonumber(room.config.botCount) or 0
if #room.players < 2 and botCount < 1 then
  return 'ERR:NOT_ENOUGH_PLAYERS'
end

room.status = ARGV[1]
local updated = cjson.encode(room)
redis.call('SET', KEYS[1], updated, 'EX', ${ROOM_TTL_SECONDS})
return updated
`;

const START_ERROR_MAP: Record<string, { message: string; status: number; code: string }> = {
  NOT_FOUND: { message: 'Room not found', status: 404, code: 'NOT_FOUND' },
  NOT_HOST: { message: 'Only the host can start the game', status: 403, code: 'NOT_HOST' },
  ALREADY_STARTING: { message: 'Game already starting', status: 409, code: 'ALREADY_STARTING' },
  NOT_READY: { message: 'Not all players are ready', status: 400, code: 'NOT_READY' },
  NOT_ENOUGH_PLAYERS: {
    message: 'Need at least 2 players or add bots',
    status: 400,
    code: 'NOT_ENOUGH_PLAYERS',
  },
};

// Lua script for an atomic "play again": a finished room goes back to waiting with nobody ready.
// This was a read in JS followed by a whole-room SET, so a player who left in between was written
// straight back into the room.
// KEYS[1] = room key
// ARGV[1] = user id that must be the room's only human ('' = no such requirement)
// Returns: updated room JSON or ERR:*
const RESET_ROOM_LUA = `
local data = redis.call('GET', KEYS[1])
if not data then
  return 'ERR:NOT_FOUND'
end

local room = cjson.decode(data)
if room.status ~= 'finished' then
  return 'ERR:NOT_FINISHED'
end

if ARGV[1] ~= '' then
  local sole = tonumber(ARGV[1])
  local humans = 0
  local found = false
  for _, p in ipairs(room.players) do
    if p.user.id > 0 then
      humans = humans + 1
      if p.user.id == sole then
        found = true
      end
    end
  end
  if humans ~= 1 or not found then
    return 'ERR:NOT_SOLE_HUMAN'
  end
end

room.status = 'waiting'
for _, p in ipairs(room.players) do
  p.ready = false
end

local updated = cjson.encode(room)
redis.call('SET', KEYS[1], updated, 'EX', ${ROOM_TTL_SECONDS})
return updated
`;

const RESET_ERROR_MAP: Record<string, { message: string; status: number; code: string }> = {
  NOT_FOUND: { message: 'Room not found', status: 404, code: 'NOT_FOUND' },
  NOT_FINISHED: { message: 'Game is not finished', status: 400, code: 'NOT_FINISHED' },
  NOT_SOLE_HUMAN: { message: 'Use the rematch vote', status: 400, code: 'NOT_SOLE_HUMAN' },
};

/** Throw the mapped AppError for an `ERR:CODE` script reply; return the reply otherwise. */
function throwIfScriptError(
  result: string,
  map: Record<string, { message: string; status: number; code: string }>,
): string {
  if (!result.startsWith('ERR:')) return result;
  const err = map[result.slice(4)];
  if (err) throw new AppError(err.message, err.status, err.code);
  throw new AppError('Room update failed', 500);
}

export async function leaveRoom(code: string, userId: number): Promise<Room | null> {
  const redis = getRedis();

  const result = (await redis.eval(
    LEAVE_ROOM_LUA,
    3,
    `room:${code}`,
    `player:${userId}:room`,
    ROOM_INDEX_KEY,
    String(userId),
    code,
  )) as string;

  if (result === 'ERR:NOT_FOUND') return null;
  if (result === 'DELETED') return null;

  return parseRoom(result);
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

  return parseRoom(result);
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

  return parseRoom(result);
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

  return parseRoom(result);
}

/**
 * Atomically start a room. Host, readiness, player count and the 'waiting' status are all checked
 * inside the script, so two concurrent room:start events cannot both pass and a stale read cannot
 * start a room whose players changed meanwhile. Throws an AppError naming the failed check.
 */
export async function startRoom(code: string, requestingUserId: number): Promise<Room> {
  const redis = getRedis();

  const result = (await redis.eval(
    START_ROOM_LUA,
    1,
    `room:${code}`,
    'countdown',
    String(requestingUserId),
  )) as string;

  return parseRoom(throwIfScriptError(result, START_ERROR_MAP));
}

/**
 * Atomically put a finished room back to 'waiting' with every ready flag cleared. With
 * `soleHumanId`, the reset only happens when that user is the room's only human (the solo "Play
 * Again"). Throws an AppError naming the failed check.
 */
export async function resetFinishedRoom(code: string, soleHumanId?: number): Promise<Room> {
  const redis = getRedis();

  const result = (await redis.eval(
    RESET_ROOM_LUA,
    1,
    `room:${code}`,
    soleHumanId === undefined ? '' : String(soleHumanId),
  )) as string;

  return parseRoom(throwIfScriptError(result, RESET_ERROR_MAP));
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
  // One DEL for every key plus the index removal, instead of a Redis round-trip per player
  // followed by two more. (audit E11)
  const keys = [`room:${code}`, ...(room?.players ?? []).map((p) => `player:${p.user.id}:room`)];
  await redis.del(...keys);
  await redis.srem(ROOM_INDEX_KEY, code);
}

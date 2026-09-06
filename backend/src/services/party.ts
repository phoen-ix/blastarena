import { getRedis } from '../db/redis';
import { Party, PartyInvite, MAX_PARTY_SIZE } from '@blast-arena/shared';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../middleware/errorHandler';

const PARTY_TTL = 3600; // 1 hour
const PARTY_KEY_PREFIX = 'party:';
const PLAYER_PARTY_PREFIX = 'player:party:';

/**
 * Lua scripts reply with `'ERR:CODE'` strings, mapped to AppError here — the same pattern as
 * JOIN_ERROR_MAP in services/lobby.ts.
 *
 * They used to reply with `{err = '…'}` tables, which ioredis surfaces as a thrown `ReplyError`.
 * clientError() only lets AppError through, so "Party is full", "Already in party" and "Only the
 * party leader can kick members" all reached the client as "An unexpected error occurred" — and
 * were logged as server errors. (audit B4)
 */
const PARTY_ERROR_MAP: Record<string, { message: string; status: number; code: string }> = {
  PARTY_NOT_FOUND: { message: 'Party not found', status: 404, code: 'PARTY_NOT_FOUND' },
  PARTY_FULL: { message: 'Party is full', status: 409, code: 'PARTY_FULL' },
  ALREADY_IN_PARTY: { message: 'Already in a party', status: 409, code: 'ALREADY_IN_PARTY' },
  ALREADY_IN_OTHER_PARTY: {
    message: 'Already in another party',
    status: 409,
    code: 'ALREADY_IN_PARTY',
  },
  NOT_LEADER: {
    message: 'Only the party leader can kick members',
    status: 403,
    code: 'NOT_LEADER',
  },
  CANNOT_KICK_SELF: { message: 'Cannot kick yourself', status: 400, code: 'CANNOT_KICK_SELF' },
  NOT_IN_PARTY: { message: 'User is not in the party', status: 404, code: 'NOT_IN_PARTY' },
};

/** Throw the AppError for an `ERR:CODE` reply; return the reply unchanged otherwise. */
function throwIfPartyError(result: unknown, fallback: { message: string; code: string }): string {
  if (typeof result !== 'string') {
    throw new AppError(fallback.message, 409, fallback.code);
  }
  if (result.startsWith('ERR:')) {
    const mapped = PARTY_ERROR_MAP[result.slice(4)];
    if (mapped) throw new AppError(mapped.message, mapped.status, mapped.code);
    throw new AppError(fallback.message, 409, fallback.code);
  }
  return result;
}

// Lua script for atomic party join (prevents race conditions).
// KEYS[1] = party key, KEYS[2] = player:party:<userId> key
// ARGV[1] = max size, ARGV[2] = user id (string), ARGV[3] = username, ARGV[4] = ttl, ARGV[5] = party id
// Returns: party JSON on success, or 'ERR:*'
const JOIN_PARTY_LUA = `
  local partyKey = KEYS[1]
  local playerKey = KEYS[2]
  local maxSize = tonumber(ARGV[1])
  local userId = ARGV[2]
  local username = ARGV[3]
  local ttl = tonumber(ARGV[4])
  local partyId = ARGV[5]

  -- Exclusivity is checked here, atomically with the join. It used to be a separate GET in JS
  -- before the eval, so two invites accepted at the same moment both passed and the player was
  -- left as a ghost member of the first party. (audit B5)
  local currentParty = redis.call('GET', playerKey)
  if currentParty and currentParty ~= partyId then
    return 'ERR:ALREADY_IN_OTHER_PARTY'
  end

  local partyData = redis.call('GET', partyKey)
  if not partyData then
    return 'ERR:PARTY_NOT_FOUND'
  end

  local party = cjson.decode(partyData)
  if #party.members >= maxSize then
    return 'ERR:PARTY_FULL'
  end

  for _, m in ipairs(party.members) do
    if tostring(m.userId) == userId then
      return 'ERR:ALREADY_IN_PARTY'
    end
  end

  table.insert(party.members, {userId = tonumber(userId), username = username})
  redis.call('SET', partyKey, cjson.encode(party), 'EX', ttl)
  redis.call('SET', playerKey, party.id, 'EX', ttl)
  return cjson.encode(party)
`;

// Atomic create: refuse if the player is already in a party, then set both keys in one call.
// A plain GET-then-SET let two concurrent party:create calls both create a party. (audit REDIS-RACE-1)
const CREATE_PARTY_LUA = `
  local partyKey = KEYS[1]
  local playerKey = KEYS[2]
  local partyJson = ARGV[1]
  local partyId = ARGV[2]
  local ttl = tonumber(ARGV[3])

  if redis.call('EXISTS', playerKey) == 1 then
    return 'ERR:ALREADY_IN_PARTY'
  end

  redis.call('SET', partyKey, partyJson, 'EX', ttl)
  redis.call('SET', playerKey, partyId, 'EX', ttl)
  return 'OK'
`;

export async function createParty(userId: number, username: string): Promise<Party> {
  const redis = getRedis();

  const partyId = uuidv4();
  const party: Party = {
    id: partyId,
    leaderId: userId,
    members: [{ userId, username }],
    createdAt: new Date().toISOString(),
  };

  // 'ERR:ALREADY_IN_PARTY' if the player already has a party. (audit B4)
  const result = await redis.eval(
    CREATE_PARTY_LUA,
    2,
    `${PARTY_KEY_PREFIX}${partyId}`,
    `${PLAYER_PARTY_PREFIX}${userId}`,
    JSON.stringify(party),
    partyId,
    PARTY_TTL,
  );
  throwIfPartyError(result, { message: 'Failed to create party', code: 'PARTY_CREATE_FAILED' });

  return party;
}

export async function getParty(partyId: string): Promise<Party | null> {
  const redis = getRedis();
  const raw = await redis.get(`${PARTY_KEY_PREFIX}${partyId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Party;
  } catch {
    return null;
  }
}

export async function getPlayerParty(userId: number): Promise<string | null> {
  const redis = getRedis();
  return redis.get(`${PLAYER_PARTY_PREFIX}${userId}`);
}

export async function joinParty(partyId: string, userId: number, username: string): Promise<Party> {
  const redis = getRedis();

  // The "already in another party" check lives inside the script (audit B5).
  const result = await redis.eval(
    JOIN_PARTY_LUA,
    2,
    `${PARTY_KEY_PREFIX}${partyId}`,
    `${PLAYER_PARTY_PREFIX}${userId}`,
    MAX_PARTY_SIZE,
    userId.toString(),
    username,
    PARTY_TTL,
    partyId,
  );

  const json = throwIfPartyError(result, {
    message: 'Failed to join party',
    code: 'PARTY_JOIN_FAILED',
  });
  return JSON.parse(json) as Party;
}

// Atomic leave: remove the member (or disband if leader leaves / party empties) in one call.
// A read-modify-write in JS lost updates under concurrent leaves. (audit REDIS-RACE-3)
const LEAVE_PARTY_LUA = `
  local partyKey = KEYS[1]
  local playerKey = KEYS[2]
  local userId = tonumber(ARGV[1])
  local ttl = tonumber(ARGV[2])
  local playerPrefix = ARGV[3]

  redis.call('DEL', playerKey)

  local partyData = redis.call('GET', partyKey)
  if not partyData then
    return 'disbanded'
  end
  local party = cjson.decode(partyData)

  local newMembers = {}
  for _, m in ipairs(party.members) do
    if m.userId ~= userId then
      table.insert(newMembers, m)
    end
  end

  if #newMembers == 0 or party.leaderId == userId then
    redis.call('DEL', partyKey)
    for _, m in ipairs(party.members) do
      redis.call('DEL', playerPrefix .. m.userId)
    end
    return 'disbanded'
  end

  party.members = newMembers
  redis.call('SET', partyKey, cjson.encode(party), 'EX', ttl)
  return 'left'
`;

export async function leaveParty(partyId: string, userId: number): Promise<'left' | 'disbanded'> {
  const redis = getRedis();
  const result = await redis.eval(
    LEAVE_PARTY_LUA,
    2,
    `${PARTY_KEY_PREFIX}${partyId}`,
    `${PLAYER_PARTY_PREFIX}${userId}`,
    userId.toString(),
    PARTY_TTL,
    PLAYER_PARTY_PREFIX,
  );
  return result === 'disbanded' ? 'disbanded' : 'left';
}

// Atomic kick: verify leadership + membership and remove the target in one call, so a concurrent
// leadership change or leave cannot be raced past the stale leader check. (audit REDIS-RACE-4)
const KICK_FROM_PARTY_LUA = `
  local partyKey = KEYS[1]
  local targetPlayerKey = KEYS[2]
  local leaderId = tonumber(ARGV[1])
  local targetId = tonumber(ARGV[2])
  local ttl = tonumber(ARGV[3])

  local partyData = redis.call('GET', partyKey)
  if not partyData then
    return 'ERR:PARTY_NOT_FOUND'
  end
  local party = cjson.decode(partyData)
  if party.leaderId ~= leaderId then
    return 'ERR:NOT_LEADER'
  end
  if targetId == leaderId then
    return 'ERR:CANNOT_KICK_SELF'
  end

  local found = false
  local newMembers = {}
  for _, m in ipairs(party.members) do
    if m.userId == targetId then
      found = true
    else
      table.insert(newMembers, m)
    end
  end
  if not found then
    return 'ERR:NOT_IN_PARTY'
  end

  party.members = newMembers
  redis.call('DEL', targetPlayerKey)
  redis.call('SET', partyKey, cjson.encode(party), 'EX', ttl)
  return cjson.encode(party)
`;

export async function kickFromParty(
  partyId: string,
  leaderId: number,
  targetId: number,
): Promise<Party> {
  const redis = getRedis();
  const result = await redis.eval(
    KICK_FROM_PARTY_LUA,
    2,
    `${PARTY_KEY_PREFIX}${partyId}`,
    `${PLAYER_PARTY_PREFIX}${targetId}`,
    leaderId.toString(),
    targetId.toString(),
    PARTY_TTL,
  );

  const json = throwIfPartyError(result, {
    message: 'Failed to kick member',
    code: 'PARTY_KICK_FAILED',
  });
  return JSON.parse(json) as Party;
}

// Invite management via Redis with TTL
const INVITE_PREFIX = 'invite:';
const INVITE_TTL = 60; // 60 seconds

export async function createInvite(
  recipientId: number,
  invite: {
    type: 'party' | 'room';
    fromUserId: number;
    fromUsername: string;
    partyId?: string;
    roomCode?: string;
    roomName?: string;
  },
): Promise<string> {
  const redis = getRedis();
  const inviteId = uuidv4();
  const inviteData = {
    inviteId,
    ...invite,
    createdAt: new Date().toISOString(),
  };
  await redis.set(
    `${INVITE_PREFIX}${recipientId}:${inviteId}`,
    JSON.stringify(inviteData),
    'EX',
    INVITE_TTL,
  );
  return inviteId;
}

/** Invite payload as stored in Redis by sendInvite(); party invites always carry a partyId. */
type StoredInvite = PartyInvite & ({ type: 'party'; partyId: string } | { type: 'room' });

export async function getInvite(
  recipientId: number,
  inviteId: string,
): Promise<StoredInvite | null> {
  const redis = getRedis();
  const raw = await redis.get(`${INVITE_PREFIX}${recipientId}:${inviteId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function removeInvite(recipientId: number, inviteId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(`${INVITE_PREFIX}${recipientId}:${inviteId}`);
}

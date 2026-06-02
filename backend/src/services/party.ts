import { getRedis } from '../db/redis';
import { Party, MAX_PARTY_SIZE } from '@blast-arena/shared';
import { v4 as uuidv4 } from 'uuid';

const PARTY_TTL = 3600; // 1 hour
const PARTY_KEY_PREFIX = 'party:';
const PLAYER_PARTY_PREFIX = 'player:party:';

// Lua script for atomic party join (prevents race conditions)
const JOIN_PARTY_LUA = `
  local partyKey = KEYS[1]
  local playerKey = KEYS[2]
  local maxSize = tonumber(ARGV[1])
  local userId = ARGV[2]
  local username = ARGV[3]
  local ttl = tonumber(ARGV[4])

  local partyData = redis.call('GET', partyKey)
  if not partyData then
    return {err = 'Party not found'}
  end

  local party = cjson.decode(partyData)
  if #party.members >= maxSize then
    return {err = 'Party is full'}
  end

  for _, m in ipairs(party.members) do
    if tostring(m.userId) == userId then
      return {err = 'Already in party'}
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
    return {err = 'Already in a party'}
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

  // Rejects with 'Already in a party' (Lua error reply) if the player already has a party.
  await redis.eval(
    CREATE_PARTY_LUA,
    2,
    `${PARTY_KEY_PREFIX}${partyId}`,
    `${PLAYER_PARTY_PREFIX}${userId}`,
    JSON.stringify(party),
    partyId,
    PARTY_TTL,
  );

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

  // Check player not already in a different party
  const existingParty = await redis.get(`${PLAYER_PARTY_PREFIX}${userId}`);
  if (existingParty && existingParty !== partyId) {
    throw new Error('Already in another party');
  }

  const result = await redis.eval(
    JOIN_PARTY_LUA,
    2,
    `${PARTY_KEY_PREFIX}${partyId}`,
    `${PLAYER_PARTY_PREFIX}${userId}`,
    MAX_PARTY_SIZE,
    userId.toString(),
    username,
    PARTY_TTL,
  );

  if (typeof result === 'string') {
    return JSON.parse(result) as Party;
  }

  throw new Error('Failed to join party');
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
    return {err = 'Party not found'}
  end
  local party = cjson.decode(partyData)
  if party.leaderId ~= leaderId then
    return {err = 'Only the party leader can kick members'}
  end
  if targetId == leaderId then
    return {err = 'Cannot kick yourself'}
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
    return {err = 'User is not in the party'}
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

  if (typeof result === 'string') {
    return JSON.parse(result) as Party;
  }
  throw new Error('Failed to kick member');
}

export async function disbandParty(partyId: string): Promise<number[]> {
  const redis = getRedis();
  const party = await getParty(partyId);
  if (!party) return [];

  const memberIds = party.members.map((m) => m.userId);
  const pipeline = redis.pipeline();
  pipeline.del(`${PARTY_KEY_PREFIX}${partyId}`);
  for (const member of party.members) {
    pipeline.del(`${PLAYER_PARTY_PREFIX}${member.userId}`);
  }
  await pipeline.exec();

  return memberIds;
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

export async function getInvite(recipientId: number, inviteId: string): Promise<any | null> {
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

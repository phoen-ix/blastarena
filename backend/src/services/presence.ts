import { getRedis } from '../db/redis';
import { ActivityStatus } from '@blast-arena/shared';

interface PresenceData {
  status: ActivityStatus;
  roomCode?: string;
  gameMode?: string;
}

const PRESENCE_TTL = 120; // seconds
const KEY_PREFIX = 'presence:';

export async function setPresence(
  userId: number,
  status: ActivityStatus,
  extra?: { roomCode?: string; gameMode?: string },
): Promise<void> {
  const redis = getRedis();
  const data: PresenceData = { status, ...extra };
  await redis.set(`${KEY_PREFIX}${userId}`, JSON.stringify(data), 'EX', PRESENCE_TTL);
}

export async function getPresence(userId: number): Promise<PresenceData | null> {
  const redis = getRedis();
  const raw = await redis.get(`${KEY_PREFIX}${userId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PresenceData;
  } catch {
    return null;
  }
}

export async function getPresenceBatch(userIds: number[]): Promise<Map<number, PresenceData>> {
  if (userIds.length === 0) return new Map();
  const redis = getRedis();
  const keys = userIds.map((id) => `${KEY_PREFIX}${id}`);
  const values = await redis.mget(...keys);
  const result = new Map<number, PresenceData>();
  for (let i = 0; i < userIds.length; i++) {
    const raw = values[i];
    if (raw) {
      try {
        result.set(userIds[i], JSON.parse(raw));
      } catch {
        // skip corrupt entries
      }
    }
  }
  return result;
}

export async function setPresenceBatch(
  entries: {
    userId: number;
    status: ActivityStatus;
    extra?: { roomCode?: string; gameMode?: string };
  }[],
): Promise<void> {
  if (entries.length === 0) return;
  const redis = getRedis();
  const pipeline = redis.pipeline();
  for (const entry of entries) {
    const data: PresenceData = { status: entry.status, ...entry.extra };
    pipeline.set(`${KEY_PREFIX}${entry.userId}`, JSON.stringify(data), 'EX', PRESENCE_TTL);
  }
  await pipeline.exec();
}

export async function removePresence(userId: number): Promise<void> {
  const redis = getRedis();
  await redis.del(`${KEY_PREFIX}${userId}`);
}

export async function refreshPresence(userId: number): Promise<void> {
  const redis = getRedis();
  await redis.expire(`${KEY_PREFIX}${userId}`, PRESENCE_TTL);
}

/**
 * Extend the presence TTL for a batch of connected users.
 *
 * Presence keys carry a 120s TTL so an unclean disconnect eventually stops showing the user as
 * online. But setPresence is only called on state TRANSITIONS, and nothing ever refreshed the
 * key — so any match or campaign level lasting longer than two minutes silently expired, and the
 * player's friends saw them drop to offline mid-game. A heartbeat over the live sockets keeps the
 * key alive without changing the disconnect semantics the TTL exists for.
 * (audit PRESENCE-TTL-1)
 */
export async function refreshPresenceBatch(userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  const redis = getRedis();
  const pipeline = redis.pipeline();
  for (const userId of userIds) {
    pipeline.expire(`${KEY_PREFIX}${userId}`, PRESENCE_TTL);
  }
  await pipeline.exec();
}

// fleet-copy: openGCP@bae0815 backend/src/db/redis.ts
import Redis from 'ioredis';
import { getConfig } from '../config';
import { logger } from '../utils/logger';

let redis: Redis;

/** How long startup waits for the first connection to become ready before giving up. */
const READY_TIMEOUT_MS = 30_000;

/**
 * Resolves once the client is `ready`, not on the TCP `connect` before it: the rate limiter
 * treats any other status as Redis being down. Rejects when the first connection attempt fails
 * or isn't ready within READY_TIMEOUT_MS.
 */
export async function createRedisClient(): Promise<Redis> {
  const config = getConfig();

  redis = new Redis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
    maxRetriesPerRequest: 3,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Redis not ready after ${READY_TIMEOUT_MS} ms (${redis.status})`)),
      READY_TIMEOUT_MS,
    );

    redis.on('ready', () => {
      clearTimeout(timer);
      logger.info('Redis connection established');
      resolve(redis);
    });

    redis.on('error', (err) => {
      logger.error({ err }, 'Redis connection error');
      if (!redis.status || redis.status === 'connecting') {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

export function getRedis(): Redis {
  if (!redis) {
    throw new Error('Redis not initialized. Call createRedisClient() first.');
  }
  return redis;
}

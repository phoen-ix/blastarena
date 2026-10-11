// fleet-copy: openGCP@d1f0a16 backend/src/db/redis.ts
import Redis from 'ioredis';
import { getConfig } from '../config';
import { logger } from '../utils/logger';

let redis: Redis;

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
    redis.on('connect', () => {
      logger.info('Redis connection established');
      resolve(redis);
    });

    redis.on('error', (err) => {
      logger.error({ err }, 'Redis connection error');
      if (!redis.status || redis.status === 'connecting') {
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

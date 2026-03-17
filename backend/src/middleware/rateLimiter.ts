import { Request, Response, NextFunction } from 'express';
import { getRedis } from '../db/redis';
import { logger } from '../utils/logger';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

/** In-memory fallback when Redis is unavailable */
const fallbackWindows = new Map<string, { count: number; resetAt: number }>();

function fallbackCheck(key: string, config: RateLimitConfig): boolean {
  const now = Date.now();
  const entry = fallbackWindows.get(key);

  if (!entry || now >= entry.resetAt) {
    fallbackWindows.set(key, { count: 1, resetAt: now + config.windowMs });
    return true;
  }

  entry.count++;
  return entry.count <= config.maxRequests;
}

// Periodic cleanup of stale fallback entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of fallbackWindows) {
    if (now >= entry.resetAt) {
      fallbackWindows.delete(key);
    }
  }
}, 60000).unref();

export function rateLimiter(config: RateLimitConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const redis = getRedis();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `ratelimit:${ip}:${req.path}`;
    const windowSeconds = Math.ceil(config.windowMs / 1000);

    try {
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }

      if (current > config.maxRequests) {
        const ttl = await redis.ttl(key);
        res.set('Retry-After', String(ttl));
        res.status(429).json({
          error: 'Too many requests',
          code: 'RATE_LIMITED',
          retryAfter: ttl,
        });
        return;
      }

      next();
    } catch {
      // Redis unavailable — fall back to in-memory rate limiting
      logger.warn({ ip, path: req.path }, 'Redis unavailable for rate limiting, using in-memory fallback');
      if (fallbackCheck(key, config)) {
        next();
      } else {
        res.status(429).json({
          error: 'Too many requests',
          code: 'RATE_LIMITED',
        });
      }
    }
  };
}

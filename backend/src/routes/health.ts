import { Router } from 'express';
import { getPool } from '../db/connection';
import { getRedis } from '../db/redis';
import { logger } from '../utils/logger';
import { getErrorMessage } from '@blast-arena/shared';

const router = Router();

// Stable identifier for this server process — changes on every restart/rebuild
export const BUILD_ID = Date.now().toString(36);

router.get('/health', async (_req, res) => {
  try {
    // Check DB
    const pool = getPool();
    await pool.execute('SELECT 1');

    // Check Redis
    const redis = getRedis();
    await redis.ping();

    res.json({ status: 'ok', buildId: BUILD_ID, timestamp: new Date().toISOString() });
  } catch (err) {
    // This 503 IS the signal that the database or Redis is unreachable, and it used to discard the
    // reason entirely — Docker's healthcheck would flip the container to "unhealthy" with nothing
    // in the log to say which dependency failed. (audit APPERROR-LOG-1)
    logger.error({ err: getErrorMessage(err) }, 'Health check failed');
    res.status(503).json({ status: 'error', message: 'Service unavailable' });
  }
});

export default router;

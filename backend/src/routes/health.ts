import { Router } from 'express';
import { getPool } from '../db/connection';
import { getRedis } from '../db/redis';

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
  } catch (_err) {
    res.status(503).json({ status: 'error', message: 'Service unavailable' });
  }
});

export default router;

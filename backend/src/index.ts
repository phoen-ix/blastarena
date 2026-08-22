import http from 'http';
import { loadConfig } from './config';
import { logger } from './utils/logger';
import { createPool } from './db/connection';
import { createRedisClient } from './db/redis';
import { runMigrations } from './db/migrations/runner';
import { createApp } from './app';
import { createSocketServer } from './socket';
import { getBotAIRegistry } from './services/botai-registry';

async function main(): Promise<void> {
  // 1. Load and validate config
  const config = loadConfig();
  logger.info({ env: config.NODE_ENV }, 'Starting BlastArena server');

  // 2. Connect to database
  await createPool();

  // 3. Connect to Redis
  await createRedisClient();

  // 4. Backfill email hashes (must run before migration 030 can finalize)
  const { backfillEmailHashes } = await import('./db/backfill-emails');
  await backfillEmailHashes();

  // 4.1. Run migrations
  await runMigrations();

  // 4.5. Initialize i18n
  const { initI18n } = await import('./i18n');
  await initI18n();
  logger.info('i18n initialized');

  // 5. Initialize AI registries
  await getBotAIRegistry().initialize();
  const { getEnemyAIRegistry } = await import('./services/enemyai-registry');
  await getEnemyAIRegistry().initialize();
  const { seedDefaultEnemyAIs } = await import('./game/enemy-ai-defaults');
  await seedDefaultEnemyAIs();

  // 6. Create Express app
  const app = createApp();
  const httpServer = http.createServer(app);

  // 6. Attach Socket.io
  const io = createSocketServer(httpServer);
  logger.info('Socket.io server attached');

  // 7. Start listening
  const port = config.PORT;
  httpServer.listen(port, () => {
    logger.info({ port }, 'Server listening');
  });

  // Reap expired/revoked refresh tokens. Rows were inserted on every login and every rotation and
  // only ever flagged revoked, so the table grew without bound and the token_hash lookup on
  // /auth/refresh degraded with it. (audit REFRESH-TOKEN-REAP-1)
  const { cleanupExpiredRefreshTokens } = await import('./services/auth');
  const reapRefreshTokens = () => {
    cleanupExpiredRefreshTokens()
      .then((removed) => {
        if (removed > 0) logger.info({ removed }, 'Reaped refresh tokens');
      })
      .catch((err) => logger.warn({ err }, 'Refresh token cleanup failed'));
  };
  reapRefreshTokens();
  const refreshTokenReaper = setInterval(reapRefreshTokens, 24 * 60 * 60 * 1000);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    clearInterval(refreshTokenReaper);
    io.close();
    httpServer.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Last-resort safety nets: log unhandled async failures instead of letting them crash the
  // process (or be silently swallowed). Individual handlers still do their own error handling. (audit ERR-004)
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});

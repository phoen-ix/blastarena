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

  // 4. Run migrations
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

  // Graceful shutdown. Order matters: the open world flushes its pending stats BEFORE the sockets
  // are closed (so per-player leave flushes have nothing left to do), and the DB pool is drained
  // before exit so in-flight match persistence completes. This used to call process.exit() in the
  // same tick as the flush was started. (audit OPENWORLD-FLUSH-1)
  const { openWorldManager } = await import('./game/OpenWorldManager');
  const { getPool } = await import('./db/connection');
  const { getRedis } = await import('./db/redis');
  let shuttingDown = false;
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down...');
    clearInterval(refreshTokenReaper);
    const forceExit = setTimeout(() => {
      logger.warn('Shutdown timed out, exiting');
      process.exit(1);
    }, 10_000);
    forceExit.unref();
    try {
      await openWorldManager.shutdown();
    } catch (err) {
      logger.error({ err }, 'Open world shutdown failed');
    }
    // io.close() disconnects every socket and closes the attached HTTP server; awaited, so every
    // socket is disconnected (its disconnect handlers called) before the pool below is ended.
    try {
      await io.close();
    } catch (err) {
      logger.error({ err }, 'Socket.io close failed');
    }
    httpServer.close();
    try {
      await getPool().end();
    } catch (err) {
      logger.error({ err }, 'DB pool close failed');
    }
    try {
      await getRedis().quit();
    } catch (err) {
      logger.error({ err }, 'Redis close failed');
    }
    process.exit(exitCode);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  // Last-resort safety nets. An unhandled rejection is logged, not fatal: individual handlers do
  // their own error handling. (audit ERR-004) An uncaught exception leaves the process in an
  // unknown state, so it is logged and the server shuts down gracefully with exit code 1 (the
  // container restarts it) instead of running on.
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception, shutting down');
    void shutdown(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});

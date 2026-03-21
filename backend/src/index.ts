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

  // 5. Initialize AI registries
  await getBotAIRegistry().initialize();
  const { getEnemyAIRegistry } = await import('./services/enemyai-registry');
  await getEnemyAIRegistry().initialize();

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

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    io.close();
    httpServer.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});

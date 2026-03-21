import { Express } from 'express';
import healthRouter from './health';
import authRouter from './auth';
import userRouter from './user';
import lobbyRouter from './lobby';
import adminRouter from './admin';
import campaignRouter from './campaign';
import friendsRouter from './friends';
import messagesRouter from './messages';
import leaderboardRouter from './leaderboard';
import cosmeticsRouter from './cosmetics';
import docsRouter from './docs';

export function registerRoutes(app: Express): void {
  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', userRouter);
  app.use('/api', lobbyRouter);
  app.use('/api', adminRouter);
  app.use('/api', campaignRouter);
  app.use('/api', friendsRouter);
  app.use('/api', messagesRouter);
  app.use('/api', leaderboardRouter);
  app.use('/api', cosmeticsRouter);
  app.use('/api', docsRouter);
}

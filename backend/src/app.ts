import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { registerRoutes } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { getConfig } from './config';

export function createApp(): express.Express {
  const app = express();

  const allowedOrigin = new URL(getConfig().APP_URL).origin;
  app.use(cors({
    origin: allowedOrigin,
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Trust proxy (behind nginx)
  app.set('trust proxy', 1);

  registerRoutes(app);

  app.use(errorHandler);

  return app;
}

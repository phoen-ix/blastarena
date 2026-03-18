import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { staffMiddleware, adminOnlyMiddleware } from '../middleware/admin';
import { validate } from '../middleware/validation';
import * as adminService from '../services/admin';
import * as replayService from '../services/replay';
import * as settingsService from '../services/settings';
import { getSimulationManager, getIO } from '../game/registry';
import { execute } from '../db/connection';
import { SimulationConfig } from '@blast-arena/shared';

const router = Router();

const roleSchema = z.object({
  role: z.enum(['user', 'moderator', 'admin']),
});

const deactivateSchema = z.object({
  deactivated: z.boolean(),
});

const toastSchema = z.object({
  message: z.string().min(1).max(500),
});

const bannerSchema = z.object({
  message: z.string().min(1).max(1000),
});

const createUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_-]+$/),
  email: z.string().email().max(255),
  password: z.string().min(6).max(128),
  role: z.enum(['user', 'moderator', 'admin']).optional(),
});

// Public: get recordings enabled setting (no auth required, like banner)
router.get('/admin/settings/recordings_enabled', async (_req, res, next) => {
  try {
    const enabled = await settingsService.isRecordingEnabled();
    res.json({ enabled });
  } catch (err) {
    next(err);
  }
});

// Public: get active banner (no auth required)
router.get('/admin/announcements/banner', async (_req, res, next) => {
  try {
    const banner = await adminService.getActiveBanner();
    res.json(banner);
  } catch (err) {
    next(err);
  }
});

// All other admin routes require auth + staff role (admin or moderator)
router.use(authMiddleware, staffMiddleware);

// --- Settings ---

const recordingsSchema = z.object({
  enabled: z.boolean(),
});

router.put(
  '/admin/settings/recordings_enabled',
  adminOnlyMiddleware,
  validate(recordingsSchema),
  async (req, res, next) => {
    try {
      await settingsService.setSetting('recordings_enabled', String(req.body.enabled));
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [req.user!.userId, 'update_setting', 'setting', 0, JSON.stringify({ key: 'recordings_enabled', value: req.body.enabled })],
      );
      // Broadcast to all connected clients
      const io = getIO();
      io.emit('admin:settingsChanged' as any, {
        key: 'recordings_enabled',
        value: req.body.enabled,
      });
      res.json({ message: 'Setting updated' });
    } catch (err) {
      next(err);
    }
  },
);

// --- Users ---

router.post(
  '/admin/users',
  adminOnlyMiddleware,
  validate(createUserSchema),
  async (req, res, next) => {
    try {
      const user = await adminService.createUser(
        req.user!.userId,
        req.body.username,
        req.body.email,
        req.body.password,
        req.body.role,
      );
      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  },
);

router.get('/admin/users', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string | undefined;
    const result = await adminService.listUsers(page, limit, search);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.put(
  '/admin/users/:id/role',
  adminOnlyMiddleware,
  validate(roleSchema),
  async (req, res, next) => {
    try {
      const userId = parseInt(req.params.id);
      await adminService.changeUserRole(req.user!.userId, userId, req.body.role);
      res.json({ message: 'Role updated' });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/users/:id/deactivate',
  adminOnlyMiddleware,
  validate(deactivateSchema),
  async (req, res, next) => {
    try {
      const userId = parseInt(req.params.id);
      await adminService.deactivateUser(req.user!.userId, userId, req.body.deactivated);
      res.json({ message: req.body.deactivated ? 'User deactivated' : 'User reactivated' });
    } catch (err) {
      next(err);
    }
  },
);

router.delete('/admin/users/:id', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);
    await adminService.deleteUser(req.user!.userId, userId);
    res.json({ message: 'User deleted' });
  } catch (err) {
    next(err);
  }
});

// --- Stats ---

router.get('/admin/stats', adminOnlyMiddleware, async (_req, res, next) => {
  try {
    const stats = await adminService.getServerStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// --- Matches ---

router.get('/admin/matches', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const result = await adminService.getMatchHistory(page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/admin/matches/:id', async (req, res, next) => {
  try {
    const matchId = parseInt(req.params.id);
    const result = await adminService.getMatchDetail(matchId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// --- Active Rooms ---

router.get('/admin/rooms', async (_req, res, next) => {
  try {
    const rooms = await adminService.getActiveRooms();
    res.json(rooms);
  } catch (err) {
    next(err);
  }
});

// --- Admin Action Log ---

router.get('/admin/actions', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const action = req.query.action as string | undefined;
    const result = await adminService.getAdminActions(page, limit, action);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// --- Announcements ---

router.post('/admin/announcements/toast', validate(toastSchema), async (req, res, next) => {
  try {
    await adminService.sendToast(req.user!.userId, req.body.message);
    res.json({ message: 'Toast sent' });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/admin/announcements/banner',
  adminOnlyMiddleware,
  validate(bannerSchema),
  async (req, res, next) => {
    try {
      await adminService.setBanner(req.user!.userId, req.body.message);
      res.json({ message: 'Banner set' });
    } catch (err) {
      next(err);
    }
  },
);

router.delete('/admin/announcements/banner', adminOnlyMiddleware, async (req, res, next) => {
  try {
    await adminService.clearBanner(req.user!.userId);
    res.json({ message: 'Banner cleared' });
  } catch (err) {
    next(err);
  }
});

// --- Replays ---

router.get('/admin/replays', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const result = await replayService.listReplays(page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/admin/replays/:matchId', async (req, res, next) => {
  try {
    const matchId = parseInt(req.params.matchId);
    const replay = await replayService.getReplay(matchId);
    if (!replay) {
      res.status(404).json({ error: 'Replay not found' });
      return;
    }
    res.json(replay);
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/replays/:matchId', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const matchId = parseInt(req.params.matchId);
    const deleted = replayService.deleteReplay(matchId);
    if (!deleted) {
      res.status(404).json({ error: 'Replay not found' });
      return;
    }
    res.json({ message: 'Replay deleted' });
  } catch (err) {
    next(err);
  }
});

// --- Simulations ---

const simulationConfigSchema = z.object({
  gameMode: z.enum([
    'ffa',
    'teams',
    'battle_royale',
    'sudden_death',
    'deathmatch',
    'king_of_the_hill',
  ]),
  botCount: z.number().int().min(2).max(8),
  botDifficulty: z.enum(['easy', 'normal', 'hard']),
  mapWidth: z.number().int().min(11).max(61),
  mapHeight: z.number().int().min(11).max(61),
  roundTime: z.number().int().min(30).max(600),
  wallDensity: z.number().min(0).max(1),
  enabledPowerUps: z.array(
    z.enum([
      'bomb_up',
      'fire_up',
      'speed_up',
      'shield',
      'kick',
      'pierce_bomb',
      'remote_bomb',
      'line_bomb',
    ]),
  ),
  powerUpDropRate: z.number().min(0).max(1),
  friendlyFire: z.boolean(),
  hazardTiles: z.boolean(),
  reinforcedWalls: z.boolean(),
  enableMapEvents: z.boolean(),
  totalGames: z.number().int().min(1).max(1000),
  speed: z.enum(['fast', 'realtime']),
  logVerbosity: z.enum(['normal', 'detailed', 'full']),
  botTeams: z.array(z.number().nullable()).optional(),
  recordReplays: z.boolean().optional(),
});

router.get('/admin/simulations', adminOnlyMiddleware, (_req, res) => {
  const mgr = getSimulationManager();
  res.json(mgr.getHistory());
});

router.get('/admin/simulations/:batchId', adminOnlyMiddleware, (req, res) => {
  const mgr = getSimulationManager();
  const data = mgr.getBatchResults(req.params.batchId);
  if (!data) {
    res.status(404).json({ error: 'Batch not found' });
    return;
  }
  res.json(data);
});

router.get('/admin/simulations/:batchId/replay/:gameIndex', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const mgr = getSimulationManager();
    const gameIndex = parseInt(req.params.gameIndex);
    if (isNaN(gameIndex) || gameIndex < 0) {
      res.status(400).json({ error: 'Invalid game index' });
      return;
    }
    const replay = await mgr.getSimulationReplay(req.params.batchId, gameIndex);
    if (!replay) {
      res.status(404).json({ error: 'Replay not found' });
      return;
    }
    res.json(replay);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/admin/simulations',
  adminOnlyMiddleware,
  validate(simulationConfigSchema),
  (req, res) => {
    const mgr = getSimulationManager();
    const result = mgr.startBatch(req.body as SimulationConfig, req.user!.userId);
    if ('error' in result) {
      res.status(429).json(result);
      return;
    }
    res.status(201).json(result);
  },
);

router.delete('/admin/simulations/:batchId', adminOnlyMiddleware, (req, res) => {
  const mgr = getSimulationManager();
  // Try cancelling if running
  mgr.cancelBatch(req.params.batchId);
  // Delete from disk and memory
  const deleted = mgr.deleteBatch(req.params.batchId);
  if (!deleted) {
    res.status(404).json({ error: 'Batch not found' });
    return;
  }
  res.json({ message: 'Batch deleted' });
});

export default router;

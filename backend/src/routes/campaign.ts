import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { adminOnlyMiddleware } from '../middleware/admin';
import { validate } from '../middleware/validation';
import * as campaignService from '../services/campaign';
import * as enemyTypeService from '../services/enemy-type';
import * as progressService from '../services/campaign-progress';

const router = Router();

// --- Zod schemas ---

const worldSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional().default(''),
  theme: z.string().min(1).max(50).optional().default('classic'),
});

const worldUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  theme: z.string().min(1).max(50).optional(),
  isPublished: z.boolean().optional(),
});

const orderSchema = z.object({
  sortOrder: z.number().int().min(0),
});

const enemyTypeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional().default(''),
  config: z.object({
    speed: z.number().min(0.5).max(4),
    movementPattern: z.enum(['random_walk', 'chase_player', 'patrol_path', 'wall_follow', 'stationary']),
    canPassWalls: z.boolean(),
    canPassBombs: z.boolean(),
    canBomb: z.boolean(),
    bombConfig: z.object({
      fireRange: z.number().int().min(1).max(8),
      cooldownTicks: z.number().int().min(10).max(200),
      trigger: z.enum(['timer', 'proximity', 'random']),
      proximityRange: z.number().int().min(1).max(20).optional(),
    }).optional(),
    hp: z.number().int().min(1).max(100),
    contactDamage: z.boolean(),
    sprite: z.object({
      bodyShape: z.enum(['blob', 'spiky', 'ghost', 'robot', 'bug', 'skull']),
      primaryColor: z.string(),
      secondaryColor: z.string(),
      eyeStyle: z.enum(['round', 'angry', 'sleepy', 'crazy']),
      hasTeeth: z.boolean(),
      hasHorns: z.boolean(),
    }),
    dropChance: z.number().min(0).max(1),
    dropTable: z.array(z.string()),
    isBoss: z.boolean(),
    sizeMultiplier: z.number().min(1).max(3),
    bossPhases: z.array(z.object({
      hpThreshold: z.number().min(0).max(1),
      speedMultiplier: z.number().optional(),
      movementPattern: z.enum(['random_walk', 'chase_player', 'patrol_path', 'wall_follow', 'stationary']).optional(),
      canBomb: z.boolean().optional(),
      bombConfig: z.any().optional(),
      spawnEnemies: z.array(z.object({
        enemyTypeId: z.number().int(),
        count: z.number().int().min(1).max(10),
      })).optional(),
    })).optional(),
  }),
});

const levelSchema = z.object({
  worldId: z.number().int().optional(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  mapWidth: z.number().int().min(7).max(51).optional(),
  mapHeight: z.number().int().min(7).max(51).optional(),
  tiles: z.array(z.array(z.string())).optional(),
  fillMode: z.enum(['handcrafted', 'hybrid']).optional(),
  wallDensity: z.number().min(0.1).max(0.9).optional(),
  playerSpawns: z.array(z.object({ x: z.number().int(), y: z.number().int() })).optional(),
  enemyPlacements: z.array(z.any()).optional(),
  powerupPlacements: z.array(z.any()).optional(),
  winCondition: z.enum(['kill_all', 'find_exit', 'reach_goal', 'survive_time']).optional(),
  winConditionConfig: z.any().optional(),
  lives: z.number().int().min(1).max(99).optional(),
  timeLimit: z.number().int().min(0).max(3600).optional(),
  parTime: z.number().int().min(0).max(3600).optional(),
  carryOverPowerups: z.boolean().optional(),
  startingPowerups: z.any().optional(),
  availablePowerupTypes: z.array(z.string()).optional(),
  powerupDropRate: z.number().min(0).max(1).optional(),
  reinforcedWalls: z.boolean().optional(),
  hazardTiles: z.boolean().optional(),
  isPublished: z.boolean().optional(),
});

// ==========================
// Player endpoints (auth required)
// ==========================

// List published worlds with levels and user progress
router.get('/campaign/worlds', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const worlds = await campaignService.listWorldsWithProgress(userId);

    // Nest levels with progress inside each world
    const worldsWithLevels = await Promise.all(
      worlds.map(async (w) => {
        const levels = await campaignService.listLevelsWithProgress(w.id, userId);
        return { ...w, levels };
      }),
    );

    res.json({ worlds: worldsWithLevels });
  } catch (err) {
    next(err);
  }
});

// List published levels in a world with user progress
router.get('/campaign/worlds/:worldId/levels', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const worldId = parseInt(req.params.worldId, 10);
    const levels = await campaignService.listLevelsWithProgress(worldId, userId);
    res.json({ levels });
  } catch (err) {
    next(err);
  }
});

// Get full level data (published only)
router.get('/campaign/levels/:levelId', authMiddleware, async (req, res, next) => {
  try {
    const levelId = parseInt(req.params.levelId, 10);
    const level = await campaignService.getLevel(levelId);
    if (!level || !level.isPublished) {
      return res.status(404).json({ error: 'Level not found' });
    }
    res.json({ level });
  } catch (err) {
    next(err);
  }
});

// User's overall campaign state
router.get('/campaign/progress', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const state = await progressService.getUserState(userId);
    res.json({ state });
  } catch (err) {
    next(err);
  }
});

// List all enemy types (for texture generation on client)
router.get('/campaign/enemy-types', authMiddleware, async (_req, res, next) => {
  try {
    const types = await enemyTypeService.listEnemyTypes();
    res.json({ enemyTypes: types });
  } catch (err) {
    next(err);
  }
});

// ==========================
// Admin endpoints
// ==========================

// --- Worlds ---
router.get('/admin/campaign/worlds', authMiddleware, adminOnlyMiddleware, async (_req, res, next) => {
  try {
    const worlds = await campaignService.listWorlds(true);
    res.json({ worlds });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/campaign/worlds', authMiddleware, adminOnlyMiddleware, validate(worldSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const { name, description, theme } = req.body;
    const id = await campaignService.createWorld(name, description || '', theme || 'classic', userId);
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

router.put('/admin/campaign/worlds/:id', authMiddleware, adminOnlyMiddleware, validate(worldUpdateSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await campaignService.updateWorld(id, req.body);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/campaign/worlds/:id', authMiddleware, adminOnlyMiddleware, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await campaignService.deleteWorld(id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.put('/admin/campaign/worlds/:id/order', authMiddleware, adminOnlyMiddleware, validate(orderSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await campaignService.reorderWorld(id, req.body.sortOrder);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// --- Levels ---
router.get('/admin/campaign/levels', authMiddleware, adminOnlyMiddleware, async (req, res, next) => {
  try {
    const worldId = parseInt(req.query.worldId as string, 10);
    if (isNaN(worldId)) return res.status(400).json({ error: 'worldId required' });
    const levels = await campaignService.listLevels(worldId, true);
    res.json({ levels });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/campaign/levels', authMiddleware, adminOnlyMiddleware, validate(levelSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const worldId = parseInt(req.body.worldId ?? req.query.worldId, 10);
    if (isNaN(worldId)) return res.status(400).json({ error: 'worldId required' });
    const id = await campaignService.createLevel(worldId, req.body, userId);
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/campaign/levels/:id', authMiddleware, adminOnlyMiddleware, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const level = await campaignService.getLevel(id);
    if (!level) return res.status(404).json({ error: 'Level not found' });
    res.json({ level });
  } catch (err) {
    next(err);
  }
});

router.put('/admin/campaign/levels/:id', authMiddleware, adminOnlyMiddleware, validate(levelSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await campaignService.updateLevel(id, req.body);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/campaign/levels/:id', authMiddleware, adminOnlyMiddleware, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await campaignService.deleteLevel(id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.put('/admin/campaign/levels/:id/order', authMiddleware, adminOnlyMiddleware, validate(orderSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await campaignService.reorderLevel(id, req.body.sortOrder);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// --- Enemy Types ---
router.get('/admin/campaign/enemy-types', authMiddleware, adminOnlyMiddleware, async (_req, res, next) => {
  try {
    const types = await enemyTypeService.listEnemyTypes();
    res.json({ enemyTypes: types });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/campaign/enemy-types', authMiddleware, adminOnlyMiddleware, validate(enemyTypeSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const { name, description, config } = req.body;
    const id = await enemyTypeService.createEnemyType(name, description || '', config, userId);
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

router.put('/admin/campaign/enemy-types/:id', authMiddleware, adminOnlyMiddleware, validate(enemyTypeSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await enemyTypeService.updateEnemyType(id, req.body);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/campaign/enemy-types/:id', authMiddleware, adminOnlyMiddleware, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await enemyTypeService.deleteEnemyType(id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { emailVerifiedMiddleware } from '../middleware/emailVerified';
import { adminOnlyMiddleware } from '../middleware/admin';
import { validate } from '../middleware/validation';
import * as campaignService from '../services/campaign';
import * as enemyTypeService from '../services/enemy-type';
import * as progressService from '../services/campaign-progress';
import * as enemyaiService from '../services/enemyai';
import { AppError } from '../middleware/errorHandler';
import { withTransaction } from '../db/connection';
import {
  CampaignLevel,
  EnemyPlacement,
  EnemyTypeEntry,
  ImportConflict,
  EnemyTypeConfig,
  TileType,
} from '@blast-arena/shared';
import { param } from '../utils/params';
import { logAdminAction } from '../services/admin-audit';

interface LevelImportData extends Record<string, unknown> {
  _format?: string;
  _version?: number;
  name?: string;
  tiles?: TileType[][];
  level?: LevelImportData;
  enemyTypes?: unknown;
  enemyPlacements?: EnemyPlacement[];
}

const router = Router();

function parseIntParam(value: string, paramName: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n)) throw new AppError(`Invalid ${paramName}`, 400);
  return n;
}

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

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const enemyTypeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional().default(''),
  config: z.object({
    speed: z.number().min(0.1).max(5),
    movementPattern: z.enum([
      'random_walk',
      'chase_player',
      'patrol_path',
      'wall_follow',
      'stationary',
    ]),
    canPassWalls: z.boolean(),
    canPassBombs: z.boolean(),
    canBomb: z.boolean(),
    bombConfig: z
      .object({
        fireRange: z.number().int().min(1).max(8),
        cooldownTicks: z.number().int().min(10).max(200),
        trigger: z.enum(['timer', 'proximity', 'random']),
        proximityRange: z.number().int().min(1).max(20).optional(),
      })
      .optional(),
    hp: z.number().int().min(1).max(100),
    contactDamage: z.boolean(),
    sprite: z.object({
      bodyShape: z.enum(['blob', 'spiky', 'ghost', 'robot', 'bug', 'skull']),
      // Drawn as canvas fill styles and shown in the admin UI: a colour, nothing else
      primaryColor: z.string().regex(HEX_COLOR),
      secondaryColor: z.string().regex(HEX_COLOR),
      eyeStyle: z.enum(['round', 'angry', 'sleepy', 'crazy']),
      hasTeeth: z.boolean(),
      hasHorns: z.boolean(),
      hasTail: z.boolean().optional().default(false),
      hasAura: z.boolean().optional().default(false),
      hasCrown: z.boolean().optional().default(false),
      hasScar: z.boolean().optional().default(false),
      hasWings: z.boolean().optional().default(false),
      accessory: z.enum(['none', 'bow_tie', 'monocle', 'bandana']).optional().default('none'),
    }),
    dropChance: z.number().min(0).max(1),
    dropTable: z.array(z.string()),
    isBoss: z.boolean(),
    sizeMultiplier: z.number().min(1).max(3),
    bossPhases: z
      .array(
        z.object({
          hpThreshold: z.number().min(0).max(1),
          speedMultiplier: z.number().min(0.01).optional(),
          movementPattern: z
            .enum(['random_walk', 'chase_player', 'patrol_path', 'wall_follow', 'stationary'])
            .optional(),
          canBomb: z.boolean().optional(),
          bombConfig: z.any().optional(),
          spawnEnemies: z
            .array(
              z.object({
                enemyTypeId: z.number().int(),
                count: z.number().int().min(1).max(10),
              }),
            )
            .optional(),
        }),
      )
      .optional(),
    enemyAiId: z.uuid().optional(),
    difficulty: z.enum(['easy', 'normal', 'hard']).optional(),
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
  // Typed: an import's ids are remapped by number, and a string id slipped past the remap
  enemyPlacements: z
    .array(
      z.object({
        enemyTypeId: z.number().int(),
        x: z.number().int(),
        y: z.number().int(),
        patrolPath: z.array(z.object({ x: z.number().int(), y: z.number().int() })).optional(),
      }),
    )
    .optional(),
  powerupPlacements: z.array(z.any()).optional(),
  winCondition: z.enum(['kill_all', 'find_exit', 'reach_goal', 'survive_time']).optional(),
  winConditionConfig: z.any().optional(),
  lives: z.number().int().min(1).max(99).optional(),
  timeLimit: z.number().int().min(0).max(3600).optional(),
  parTime: z.number().int().min(0).max(3600).optional(),
  carryOverPowerups: z.boolean().optional(),
  startingPowerups: z.any().optional(),
  // null = every type (what the editor's export writes for a level that never restricted them)
  availablePowerupTypes: z.array(z.string()).nullable().optional(),
  powerupDropRate: z.number().min(0).max(1).optional(),
  reinforcedWalls: z.boolean().optional(),
  hazardTiles: z.boolean().optional(),
  coveredTiles: z
    .array(z.object({ x: z.number().int(), y: z.number().int(), type: z.string() }))
    .optional(),
  puzzleConfig: z
    .object({
      switchVariants: z.record(z.string(), z.enum(['toggle', 'pressure', 'oneshot'])).optional(),
    })
    .nullable()
    .optional(),
  isPublished: z.boolean().optional(),
});

// ==========================
// Player endpoints (auth required)
// ==========================

// List published worlds with levels and user progress
router.get('/campaign/worlds', authMiddleware, emailVerifiedMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const worlds = await campaignService.listWorldsWithProgress(userId);

    // Nest levels with progress inside each world. One grouped lookup, not one per world:
    // this was `worlds.map(async w => listLevelsWithProgress(w.id, userId))`, which is itself two
    // queries, so the menu cost 1 + 2N round-trips. (audit CAMPAIGN-NPLUS1-1)
    const levelsByWorld = await campaignService.listLevelsWithProgressForWorlds(
      worlds.map((w) => w.id),
      userId,
    );
    const worldsWithLevels = worlds.map((w) => ({ ...w, levels: levelsByWorld.get(w.id) ?? [] }));

    res.json({ worlds: worldsWithLevels });
  } catch (err) {
    next(err);
  }
});

// List published levels in a world with user progress
router.get(
  '/campaign/worlds/:worldId/levels',
  authMiddleware,
  emailVerifiedMiddleware,
  async (req, res, next) => {
    try {
      const userId = req.user!.userId;
      const worldId = parseIntParam(param(req.params.worldId), 'worldId');
      const levels = await campaignService.listLevelsWithProgress(worldId, userId);
      res.json({ levels });
    } catch (err) {
      next(err);
    }
  },
);

// Get full level data (published only)
router.get(
  '/campaign/levels/:levelId',
  authMiddleware,
  emailVerifiedMiddleware,
  async (req, res, next) => {
    try {
      const levelId = parseIntParam(param(req.params.levelId), 'levelId');
      const level = await campaignService.getLevel(levelId);
      if (!level || !level.isPublished) {
        return res.status(404).json({ error: 'Level not found' });
      }
      res.json({ level });
    } catch (err) {
      next(err);
    }
  },
);

// User's overall campaign state
router.get(
  '/campaign/progress',
  authMiddleware,
  emailVerifiedMiddleware,
  async (req, res, next) => {
    try {
      const userId = req.user!.userId;
      const state = await progressService.getUserState(userId);
      res.json({ state });
    } catch (err) {
      next(err);
    }
  },
);

// List all enemy types (for texture generation on client)
router.get(
  '/campaign/enemy-types',
  authMiddleware,
  emailVerifiedMiddleware,
  async (_req, res, next) => {
    try {
      const types = await enemyTypeService.listEnemyTypes();
      res.json({ enemyTypes: types });
    } catch (err) {
      next(err);
    }
  },
);

// ==========================
// Admin endpoints
// ==========================

// --- Worlds ---
router.get(
  '/admin/campaign/worlds',
  authMiddleware,
  adminOnlyMiddleware,
  async (_req, res, next) => {
    try {
      const worlds = await campaignService.listWorlds(true);
      res.json({ worlds });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/admin/campaign/worlds',
  authMiddleware,
  adminOnlyMiddleware,
  validate(worldSchema),
  async (req, res, next) => {
    try {
      const userId = req.user!.userId;
      const { name, description, theme } = req.body;
      const id = await campaignService.createWorld(
        name,
        description || '',
        theme || 'classic',
        userId,
      );
      await logAdminAction(
        userId,
        'campaign_world_create',
        'campaign_world',
        id,
        JSON.stringify({ name }),
      );
      res.status(201).json({ id });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/campaign/worlds/:id',
  authMiddleware,
  adminOnlyMiddleware,
  validate(worldUpdateSchema),
  async (req, res, next) => {
    try {
      const id = parseIntParam(param(req.params.id), 'id');
      if (!(await campaignService.updateWorld(id, req.body)))
        return res.status(404).json({ error: 'World not found' });
      await logAdminAction(
        req.user!.userId,
        'campaign_world_update',
        'campaign_world',
        id,
        JSON.stringify({ fields: Object.keys(req.body) }),
      );
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/admin/campaign/worlds/:id',
  authMiddleware,
  adminOnlyMiddleware,
  async (req, res, next) => {
    try {
      const id = parseIntParam(param(req.params.id), 'id');
      if (!(await campaignService.deleteWorld(id)))
        return res.status(404).json({ error: 'World not found' });
      await logAdminAction(req.user!.userId, 'campaign_world_delete', 'campaign_world', id, null);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/campaign/worlds/:id/order',
  authMiddleware,
  adminOnlyMiddleware,
  validate(orderSchema),
  async (req, res, next) => {
    try {
      const id = parseIntParam(param(req.params.id), 'id');
      if (!(await campaignService.reorderWorld(id, req.body.sortOrder)))
        return res.status(404).json({ error: 'World not found' });
      await logAdminAction(
        req.user!.userId,
        'campaign_world_update',
        'campaign_world',
        id,
        JSON.stringify({ sortOrder: req.body.sortOrder }),
      );
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// --- Levels ---
router.get(
  '/admin/campaign/levels',
  authMiddleware,
  adminOnlyMiddleware,
  async (req, res, next) => {
    try {
      const worldId = parseIntParam(req.query.worldId as string, 'worldId');
      const levels = await campaignService.listLevels(worldId, true);
      res.json({ levels });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/admin/campaign/levels',
  authMiddleware,
  adminOnlyMiddleware,
  validate(levelSchema),
  async (req, res, next) => {
    try {
      const userId = req.user!.userId;
      const worldId = parseIntParam(String(req.body.worldId ?? req.query.worldId ?? ''), 'worldId');
      const id = await campaignService.createLevel(worldId, req.body, userId);
      await logAdminAction(
        userId,
        'campaign_level_create',
        'campaign_level',
        id,
        JSON.stringify({ worldId, name: req.body.name }),
      );
      res.status(201).json({ id });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/admin/campaign/levels/:id',
  authMiddleware,
  adminOnlyMiddleware,
  async (req, res, next) => {
    try {
      const id = parseIntParam(param(req.params.id), 'id');
      const level = await campaignService.getLevel(id);
      if (!level) return res.status(404).json({ error: 'Level not found' });
      res.json({ level });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/campaign/levels/:id',
  authMiddleware,
  adminOnlyMiddleware,
  validate(levelSchema),
  async (req, res, next) => {
    try {
      const id = parseIntParam(param(req.params.id), 'id');
      if (!(await campaignService.updateLevel(id, req.body)))
        return res.status(404).json({ error: 'Level not found' });
      await logAdminAction(
        req.user!.userId,
        'campaign_level_update',
        'campaign_level',
        id,
        JSON.stringify({ name: req.body.name }),
      );
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/admin/campaign/levels/:id',
  authMiddleware,
  adminOnlyMiddleware,
  async (req, res, next) => {
    try {
      const id = parseIntParam(param(req.params.id), 'id');
      if (!(await campaignService.deleteLevel(id)))
        return res.status(404).json({ error: 'Level not found' });
      await logAdminAction(req.user!.userId, 'campaign_level_delete', 'campaign_level', id, null);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/campaign/levels/:id/order',
  authMiddleware,
  adminOnlyMiddleware,
  validate(orderSchema),
  async (req, res, next) => {
    try {
      const id = parseIntParam(param(req.params.id), 'id');
      if (!(await campaignService.reorderLevel(id, req.body.sortOrder)))
        return res.status(404).json({ error: 'Level not found' });
      await logAdminAction(
        req.user!.userId,
        'campaign_level_update',
        'campaign_level',
        id,
        JSON.stringify({ sortOrder: req.body.sortOrder }),
      );
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// --- Enemy Types ---
router.get(
  '/admin/campaign/enemy-types',
  authMiddleware,
  adminOnlyMiddleware,
  async (_req, res, next) => {
    try {
      const types = await enemyTypeService.listEnemyTypes();
      res.json({ enemyTypes: types });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/admin/campaign/enemy-types',
  authMiddleware,
  adminOnlyMiddleware,
  validate(enemyTypeSchema),
  async (req, res, next) => {
    try {
      const userId = req.user!.userId;
      const { name, description, config } = req.body;
      const id = await enemyTypeService.createEnemyType(name, description || '', config, userId);
      await logAdminAction(userId, 'enemy_type_create', 'enemy_type', id, JSON.stringify({ name }));
      res.status(201).json({ id });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/campaign/enemy-types/:id',
  authMiddleware,
  adminOnlyMiddleware,
  validate(enemyTypeSchema),
  async (req, res, next) => {
    try {
      const id = parseIntParam(param(req.params.id), 'id');
      if (!(await enemyTypeService.updateEnemyType(id, req.body)))
        return res.status(404).json({ error: 'Enemy type not found' });
      await logAdminAction(
        req.user!.userId,
        'enemy_type_update',
        'enemy_type',
        id,
        JSON.stringify({ name: req.body.name }),
      );
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/admin/campaign/enemy-types/:id',
  authMiddleware,
  adminOnlyMiddleware,
  async (req, res, next) => {
    try {
      const id = parseIntParam(param(req.params.id), 'id');
      if (!(await enemyTypeService.deleteEnemyType(id)))
        return res.status(404).json({ error: 'Enemy type not found' });
      await logAdminAction(req.user!.userId, 'enemy_type_delete', 'enemy_type', id, null);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// --- Export/Import ---

function stripLevelDbFields(level: CampaignLevel) {
  const {
    id: _id,
    worldId: _wid,
    createdBy: _cb,
    createdAt: _ca,
    updatedAt: _ua,
    sortOrder: _so,
    isPublished: _ip,
    ...rest
  } = level as CampaignLevel & { createdBy?: unknown; createdAt?: unknown; updatedAt?: unknown };
  return rest;
}

function stripEnemyTypeDbFields(et: EnemyTypeEntry) {
  const { id: _id, createdAt: _ca, isBoss: _ib, ...rest } = et;
  return rest;
}

// Export single level
router.get(
  '/admin/campaign/levels/:id/export',
  authMiddleware,
  adminOnlyMiddleware,
  async (req, res, next) => {
    try {
      const id = parseIntParam(param(req.params.id), 'id');
      const level = await campaignService.getLevel(id);
      if (!level) return res.status(404).json({ error: 'Level not found' });

      const data = {
        _format: 'blast-arena-level',
        _version: 1,
        ...stripLevelDbFields(level),
      };

      const filename = `level-${level.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/json');
      res.json(data);
    } catch (err) {
      next(err);
    }
  },
);

// Export level bundle (level + enemy types)
router.get(
  '/admin/campaign/levels/:id/export-bundle',
  authMiddleware,
  adminOnlyMiddleware,
  async (req, res, next) => {
    try {
      const id = parseIntParam(param(req.params.id), 'id');
      const level = await campaignService.getLevel(id);
      if (!level) return res.status(404).json({ error: 'Level not found' });

      // Collect unique enemy type IDs from placements
      const enemyTypeIds = [...new Set(level.enemyPlacements.map((ep) => ep.enemyTypeId))];
      const enemyTypes: Record<string, unknown>[] = [];

      for (const etId of enemyTypeIds) {
        const et = await enemyTypeService.getEnemyType(etId);
        if (et) {
          const etEntry: Record<string, unknown> = {
            originalId: et.id,
            name: et.name,
            description: et.description,
            config: et.config,
          };
          // Bundle AI source if custom AI is assigned
          if (et.config.enemyAiId) {
            const aiSource = await enemyaiService.downloadEnemyAISource(et.config.enemyAiId);
            const aiEntry = await enemyaiService.getEnemyAI(et.config.enemyAiId);
            if (aiSource && aiEntry) {
              etEntry.enemyAiSource = aiSource.content.toString('utf-8');
              etEntry.enemyAiName = aiEntry.name;
            }
          }
          enemyTypes.push(etEntry);
        }
      }

      const data = {
        _format: 'blast-arena-level-bundle',
        _version: 2,
        level: stripLevelDbFields(level),
        enemyTypes,
      };

      const filename = `level-bundle-${level.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/json');
      res.json(data);
    } catch (err) {
      next(err);
    }
  },
);

// Export single enemy type
router.get(
  '/admin/campaign/enemy-types/:id/export',
  authMiddleware,
  adminOnlyMiddleware,
  async (req, res, next) => {
    try {
      const id = parseIntParam(param(req.params.id), 'id');
      const et = await enemyTypeService.getEnemyType(id);
      if (!et) return res.status(404).json({ error: 'Enemy type not found' });

      const data: Record<string, unknown> = {
        _format: 'blast-arena-enemy-type',
        _version: 2,
        ...stripEnemyTypeDbFields(et),
      };

      // Bundle AI source if custom AI is assigned
      if (et.config.enemyAiId) {
        const aiSource = await enemyaiService.downloadEnemyAISource(et.config.enemyAiId);
        const aiEntry = await enemyaiService.getEnemyAI(et.config.enemyAiId);
        if (aiSource && aiEntry) {
          data.enemyAiSource = aiSource.content.toString('utf-8');
          data.enemyAiName = aiEntry.name;
        }
      }

      const filename = `enemy-${et.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/json');
      res.json(data);
    } catch (err) {
      next(err);
    }
  },
);

// An enemy type bundled with a level export: the create schema plus the id it had at the source.
// Bundles used to be trusted as is and stored straight into campaign_enemy_types.
const bundledEnemyTypeSchema = z.object({
  originalId: z.number().int(),
  name: enemyTypeSchema.shape.name,
  description: enemyTypeSchema.shape.description,
  config: enemyTypeSchema.shape.config,
  enemyAiSource: z.string().optional(),
  enemyAiName: z.string().optional(),
});
type BundledEnemyType = z.infer<typeof bundledEnemyTypeSchema>;

// Import level (with optional bundled enemy types)
const importLevelSchema = z.object({
  level: z.any(),
  enemyTypes: z.array(z.any()).optional(),
  worldId: z.number().int(),
  enemyIdMap: z
    .record(z.string(), z.union([z.number(), z.literal('create'), z.literal('skip')]))
    .optional(),
});

router.post(
  '/admin/campaign/levels/import',
  authMiddleware,
  adminOnlyMiddleware,
  validate(importLevelSchema),
  async (req, res, next) => {
    try {
      const userId = req.user!.userId;
      const { worldId, enemyIdMap } = req.body;

      // Accept both plain level and bundle format
      let levelData: LevelImportData;
      let rawEnemyTypes: unknown;

      if (req.body.level?._format === 'blast-arena-level-bundle') {
        // Bundle wrapped in `level`. A bundle posted at the top level loses its `_format` to
        // validation and is handled by the last branch, which reads the same two fields.
        const bundle = req.body.level;
        levelData = bundle.level;
        rawEnemyTypes = bundle.enemyTypes;
      } else if (req.body.level?._format === 'blast-arena-level') {
        // Plain level export
        const { _format, _version, ...rest } = req.body.level;
        levelData = rest;
      } else {
        // Raw level data or stripped bundle
        levelData = req.body.level;
        rawEnemyTypes = req.body.enemyTypes;
      }

      if (!levelData || !levelData.name || !levelData.tiles) {
        return res.status(400).json({ error: 'Invalid level data' });
      }
      // Same bounds as creating a level (map size, lives, times, …); unknown export fields pass
      // through. Imports used to skip validation entirely, so a level could carry any map size.
      const checked = levelSchema.loose().safeParse(levelData);
      if (!checked.success) {
        return res.status(400).json({
          error: 'Invalid level data',
          details: checked.error.issues.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }

      // Before anything is created: createLevel checks the world too, but only after phase 2 has
      // created the enemy types mapped to `create`, which an unknown world then left behind.
      if (!(await campaignService.getWorld(worldId))) {
        return res.status(400).json({ error: 'World not found', code: 'WORLD_NOT_FOUND' });
      }

      let bundledEnemyTypes: BundledEnemyType[] | undefined;
      if (rawEnemyTypes !== undefined) {
        const bundled = z.array(bundledEnemyTypeSchema).safeParse(rawEnemyTypes);
        if (!bundled.success) {
          return res.status(400).json({
            error: 'Invalid enemy type data',
            details: bundled.error.issues.map((e) => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          });
        }
        bundledEnemyTypes = bundled.data;
      }

      // Collect enemy type IDs referenced in placements
      const referencedIds = [
        ...new Set((levelData.enemyPlacements || []).map((ep: EnemyPlacement) => ep.enemyTypeId)),
      ];

      // Phase 1: Check for conflicts if no enemyIdMap provided
      if (!enemyIdMap && referencedIds.length > 0) {
        const conflicts: ImportConflict[] = [];

        for (const origId of referencedIds) {
          const existing = await enemyTypeService.getEnemyType(origId as number);
          const bundled = bundledEnemyTypes?.find((et) => et.originalId === origId);

          if (existing) {
            // ID exists in DB — might be a different enemy type
            if (bundled) {
              conflicts.push({
                originalId: origId,
                name: bundled.name,
                existingId: existing.id,
                existingName: existing.name,
              });
            }
            // If no bundled data and ID exists, we can just use it as-is (no conflict)
          } else if (bundled) {
            // ID doesn't exist, but we have bundled data to create it
            conflicts.push({
              originalId: origId,
              name: bundled.name,
            });
          } else {
            // ID doesn't exist and no bundled data — this is also a conflict
            conflicts.push({
              originalId: origId,
              name: `Unknown (ID ${origId})`,
            });
          }
        }

        if (conflicts.length > 0) {
          return res.json({ conflicts });
        }
      }

      // Phase 2: Remap enemy IDs
      const skippedIds = new Set<number>();
      const createIds = new Set<number>();
      const idMap = new Map<number, number>();
      for (const [origIdStr, action] of Object.entries(enemyIdMap ?? {})) {
        const origId = Number(origIdStr);
        if (action === 'skip') skippedIds.add(origId);
        else if (action === 'create') {
          if (bundledEnemyTypes?.some((et) => et.originalId === origId)) createIds.add(origId);
        } else if (typeof action === 'number') idMap.set(origId, action);
      }

      // Every placement must end up on an enemy type that exists here, or on one this import
      // creates. A numeric mapping to an unknown id, or an unmapped id the database does not
      // have, used to be stored as a placement of nothing.
      const missing: number[] = [];
      for (const origId of enemyIdMap ? referencedIds : []) {
        if (skippedIds.has(origId) || createIds.has(origId)) continue;
        const targetId = idMap.get(origId) ?? origId;
        if (!(await enemyTypeService.getEnemyType(targetId))) missing.push(targetId);
      }
      if (missing.length > 0) {
        return res.status(400).json({
          error: `Enemy type not found: ${missing.join(', ')}`,
          code: 'ENEMY_TYPE_NOT_FOUND',
        });
      }

      // An enemy AI is referenced by its id on the exporting server. Kept only when that id exists
      // here (an export re-imported on the same server), otherwise dropped with its difficulty:
      // the type falls back to its movement pattern instead of pointing at nothing.
      const toCreate: BundledEnemyType[] = [];
      for (const et of bundledEnemyTypes ?? []) {
        if (!createIds.has(et.originalId)) continue;
        const config = { ...et.config };
        if (config.enemyAiId && !(await enemyaiService.getEnemyAI(config.enemyAiId))) {
          delete config.enemyAiId;
          delete config.difficulty;
        }
        toCreate.push({ ...et, config });
      }

      // All or nothing: a failing level insert used to leave the enemy types created for it.
      const { levelId, createdEnemyTypes } = await withTransaction(async (conn) => {
        const created: { id: number; name: string; enemyAiId: string | null }[] = [];
        for (const et of toCreate) {
          const newId = await enemyTypeService.createEnemyType(
            et.name,
            et.description || '',
            et.config as EnemyTypeConfig,
            userId,
            conn,
          );
          idMap.set(et.originalId, newId);
          created.push({ id: newId, name: et.name, enemyAiId: et.config.enemyAiId ?? null });
        }

        const remappedPlacements = (levelData.enemyPlacements || [])
          .filter((ep: EnemyPlacement) => !skippedIds.has(ep.enemyTypeId))
          .map((ep: EnemyPlacement) => ({
            ...ep,
            enemyTypeId: idMap.get(ep.enemyTypeId) ?? ep.enemyTypeId,
          }));

        const id = await campaignService.createLevel(
          worldId,
          { ...levelData, enemyPlacements: remappedPlacements },
          userId,
          conn,
        );
        return { levelId: id, createdEnemyTypes: created };
      });

      // Logged once committed, like a single enemy type import
      for (const et of createdEnemyTypes) {
        await logAdminAction(
          userId,
          'enemy_type_import',
          'enemy_type',
          et.id,
          JSON.stringify({ name: et.name, enemyAiId: et.enemyAiId }),
        );
      }
      await logAdminAction(
        userId,
        'campaign_level_import',
        'campaign_level',
        levelId,
        JSON.stringify({
          worldId,
          name: levelData.name,
          createdEnemyTypes: createdEnemyTypes.map((et) => et.id),
        }),
      );
      res.status(201).json({ id: levelId });
    } catch (err) {
      next(err);
    }
  },
);

// Import enemy type (with optional bundled AI source)
const importEnemyTypeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional().default(''),
  config: enemyTypeSchema.shape.config,
  enemyAiSource: z.string().optional(),
  enemyAiName: z.string().optional(),
  enemyAiAction: z
    .union([z.literal('create'), z.literal('skip'), z.string().regex(/^use-existing:.+/)])
    .optional(),
});

router.post(
  '/admin/campaign/enemy-types/import',
  authMiddleware,
  adminOnlyMiddleware,
  validate(importEnemyTypeSchema),
  async (req, res, next) => {
    try {
      const userId = req.user!.userId;
      const { name, description, config, enemyAiSource, enemyAiName, enemyAiAction } = req.body;

      // Handle bundled AI source
      if (enemyAiSource && config.enemyAiId) {
        if (!enemyAiAction) {
          // Phase 1: detect conflicts - check if an AI with same name exists
          const existing = await enemyaiService.getEnemyAIByName(enemyAiName || 'Imported AI');
          const conflict = {
            aiName: enemyAiName || 'Imported AI',
            existingId: existing?.id,
            existingName: existing?.name,
          };
          res.json({ needsResolution: true, conflict });
          return;
        }

        if (enemyAiAction === 'create') {
          // Create new enemy AI from bundled source
          const result = await enemyaiService.uploadEnemyAIFromSource(
            enemyAiName || 'Imported AI',
            '',
            enemyAiSource,
            `${(enemyAiName || 'imported').replace(/[^a-zA-Z0-9_-]/g, '_')}.ts`,
            userId,
          );
          if (result.errors || !result.entry) {
            res.status(400).json({ error: 'Failed to compile bundled AI', errors: result.errors });
            return;
          }
          config.enemyAiId = result.entry.id;
        } else if (enemyAiAction.startsWith('use-existing:')) {
          // Checked: an unknown id was stored as is, pointing the enemy type at nothing
          const aiId = enemyAiAction.replace('use-existing:', '');
          if (!(await enemyaiService.getEnemyAI(aiId))) {
            res.status(400).json({ error: 'Enemy AI not found', code: 'AI_NOT_FOUND' });
            return;
          }
          config.enemyAiId = aiId;
        } else {
          // skip - clear the AI reference
          delete config.enemyAiId;
          delete config.difficulty;
        }
      }

      const id = await enemyTypeService.createEnemyType(name, description || '', config, userId);
      await logAdminAction(
        userId,
        'enemy_type_import',
        'enemy_type',
        id,
        JSON.stringify({ name, enemyAiId: config.enemyAiId ?? null }),
      );
      res.status(201).json({ id });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

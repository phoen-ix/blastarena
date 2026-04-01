import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { emailVerifiedMiddleware } from '../middleware/emailVerified';
import { validate } from '../middleware/validation';
import { AppError } from '../middleware/errorHandler';
import * as customMapsService from '../services/custom-maps';
import { validateCustomMap, TileType, Position } from '@blast-arena/shared';

const router = Router();

const customMapSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().default(''),
  mapWidth: z.number().int().min(9).max(51),
  mapHeight: z.number().int().min(9).max(51),
  tiles: z.array(z.array(z.string())),
  spawnPoints: z.array(z.object({ x: z.number().int(), y: z.number().int() })),
  isPublished: z.boolean().optional().default(false),
});

// List current user's maps
router.get('/maps/mine', authMiddleware, emailVerifiedMiddleware, async (req, res, next) => {
  try {
    const maps = await customMapsService.listMyMaps(req.user!.userId);
    res.json({ maps });
  } catch (err) {
    next(err);
  }
});

// List all published maps
router.get('/maps/published', authMiddleware, emailVerifiedMiddleware, async (req, res, next) => {
  try {
    const maps = await customMapsService.listPublishedMaps();
    res.json({ maps });
  } catch (err) {
    next(err);
  }
});

// Get full map data (own or published)
router.get('/maps/:id', authMiddleware, emailVerifiedMiddleware, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new AppError('Invalid map ID', 400);

    const map = await customMapsService.getMap(id);
    if (!map) throw new AppError('Map not found', 404);

    // Allow access if owner or published
    if (map.createdBy !== req.user!.userId && !map.isPublished) {
      throw new AppError('Map not found', 404);
    }

    res.json({ map });
  } catch (err) {
    next(err);
  }
});

// Create new map
router.post(
  '/maps',
  authMiddleware,
  emailVerifiedMiddleware,
  validate(customMapSchema),
  async (req, res, next) => {
    try {
      const data = req.body;
      const tiles = data.tiles as TileType[][];
      const spawnPoints = data.spawnPoints as Position[];

      // Server-side validation
      const errors = validateCustomMap(tiles, data.mapWidth, data.mapHeight);
      if (errors.length > 0) {
        throw new AppError(errors[0], 400);
      }

      const id = await customMapsService.createMap(
        {
          name: data.name,
          description: data.description,
          mapWidth: data.mapWidth,
          mapHeight: data.mapHeight,
          tiles,
          spawnPoints,
          isPublished: data.isPublished,
        },
        req.user!.userId,
      );

      res.status(201).json({ id });
    } catch (err) {
      next(err);
    }
  },
);

// Update map (owner only)
router.put(
  '/maps/:id',
  authMiddleware,
  emailVerifiedMiddleware,
  validate(customMapSchema),
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) throw new AppError('Invalid map ID', 400);

      const data = req.body;
      const tiles = data.tiles as TileType[][];
      const spawnPoints = data.spawnPoints as Position[];

      const errors = validateCustomMap(tiles, data.mapWidth, data.mapHeight);
      if (errors.length > 0) {
        throw new AppError(errors[0], 400);
      }

      const updated = await customMapsService.updateMap(
        id,
        {
          name: data.name,
          description: data.description,
          mapWidth: data.mapWidth,
          mapHeight: data.mapHeight,
          tiles,
          spawnPoints,
          isPublished: data.isPublished,
        },
        req.user!.userId,
      );

      if (!updated) throw new AppError('Map not found or not owned by you', 404);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// Rate a published map (1-5 stars)
const ratingSchema = z.object({ rating: z.number().int().min(1).max(5) });

router.post(
  '/maps/:id/rate',
  authMiddleware,
  emailVerifiedMiddleware,
  validate(ratingSchema),
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) throw new AppError('Invalid map ID', 400);

      const map = await customMapsService.getMap(id);
      if (!map || !map.isPublished) throw new AppError('Map not found', 404);
      if (map.createdBy === req.user!.userId) {
        throw new AppError('Cannot rate your own map', 400);
      }

      const result = await customMapsService.rateMap(id, req.user!.userId, req.body.rating);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// Get user's rating for a map
router.get('/maps/:id/rating', authMiddleware, emailVerifiedMiddleware, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new AppError('Invalid map ID', 400);

    const rating = await customMapsService.getUserRating(id, req.user!.userId);
    res.json({ rating });
  } catch (err) {
    next(err);
  }
});

// Delete map (owner only)
router.delete('/maps/:id', authMiddleware, emailVerifiedMiddleware, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new AppError('Invalid map ID', 400);

    const deleted = await customMapsService.deleteMap(id, req.user!.userId);
    if (!deleted) throw new AppError('Map not found or not owned by you', 404);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;

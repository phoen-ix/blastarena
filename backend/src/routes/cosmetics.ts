import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { emailVerifiedMiddleware } from '../middleware/emailVerified';
import { validate } from '../middleware/validation';
import * as cosmeticsService from '../services/cosmetics';
import * as achievementsService from '../services/achievements';

const router = Router();

const equipSchema = z.object({
  slot: z.enum(['color', 'eyes', 'trail', 'bomb_skin']),
  cosmeticId: z.number().int().nullable(),
});

// Public: all active cosmetics
router.get('/cosmetics', async (_req, res, next) => {
  try {
    const cosmetics = await cosmeticsService.getAllCosmetics(true);
    res.json({ cosmetics });
  } catch (err) {
    next(err);
  }
});

// Auth: user's unlocked cosmetics
router.get('/cosmetics/mine', authMiddleware, emailVerifiedMiddleware, async (req, res, next) => {
  try {
    const cosmetics = await cosmeticsService.getUserCosmetics(req.user!.userId);
    res.json({ cosmetics });
  } catch (err) {
    next(err);
  }
});

// Auth: user's equipped cosmetics
router.get(
  '/cosmetics/equipped',
  authMiddleware,
  emailVerifiedMiddleware,
  async (req, res, next) => {
    try {
      const equipped = await cosmeticsService.getEquippedCosmetics(req.user!.userId);
      res.json(equipped);
    } catch (err) {
      next(err);
    }
  },
);

// Auth: equip/unequip cosmetic
router.put(
  '/cosmetics/equip',
  authMiddleware,
  emailVerifiedMiddleware,
  validate(equipSchema),
  async (req, res, next) => {
    try {
      const { slot, cosmeticId } = req.body;
      await cosmeticsService.equipCosmetic(req.user!.userId, slot, cosmeticId);
      const equipped = await cosmeticsService.getEquippedCosmetics(req.user!.userId);
      res.json(equipped);
    } catch (err) {
      next(err);
    }
  },
);

// Public: all active achievements
router.get('/achievements', async (_req, res, next) => {
  try {
    const achievements = await achievementsService.getAllAchievements(true);
    res.json({ achievements });
  } catch (err) {
    next(err);
  }
});

// Auth: user's achievement progress
router.get(
  '/achievements/mine',
  authMiddleware,
  emailVerifiedMiddleware,
  async (req, res, next) => {
    try {
      const achievements = await achievementsService.getUserAchievements(req.user!.userId);
      res.json({ achievements });
    } catch (err) {
      next(err);
    }
  },
);

// Auth: achievement progress for current user
router.get(
  '/achievements/progress',
  authMiddleware,
  emailVerifiedMiddleware,
  async (req, res, next) => {
    try {
      const progress = await achievementsService.getAchievementProgress(req.user!.userId);
      res.json({ progress });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

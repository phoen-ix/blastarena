import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import * as leaderboardService from '../services/leaderboard';
import * as seasonService from '../services/season';

const router = Router();

// Public: paginated leaderboard
router.get('/leaderboard', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const seasonId = req.query.season_id ? parseInt(req.query.season_id as string) : undefined;

    const result = await leaderboardService.getLeaderboard({ page, limit, seasonId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Public: rank tier configuration
router.get('/leaderboard/tiers', async (_req, res, next) => {
  try {
    const config = await leaderboardService.getRankConfig();
    res.json(config);
  } catch (err) {
    next(err);
  }
});

// Public: seasons list
router.get('/leaderboard/seasons', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const result = await seasonService.getSeasons(page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Public: user public profile
router.get('/user/:id/public', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });

    const profile = await leaderboardService.getPublicProfile(userId);
    if (!profile) return res.status(404).json({ error: 'Profile not found or is private' });

    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// Auth: own rank info
router.get('/user/rank', authMiddleware, async (req, res, next) => {
  try {
    const rank = await leaderboardService.getUserRank(req.user!.userId);
    res.json(rank);
  } catch (err) {
    next(err);
  }
});

export default router;

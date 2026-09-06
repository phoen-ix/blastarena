import { Router } from 'express';
import * as challengesService from '../services/challenges';
import * as settingsService from '../services/settings';

const router = Router();

// GET /challenges/:id/leaderboard and GET /challenges/history had no caller — the challenge view
// only reads /challenges/active (which carries the top scores), and the admin panel uses
// /admin/challenges. Removed. (audit G6)

// Public: get active challenge info
router.get('/challenges/active', async (_req, res, next) => {
  try {
    const enabled = await settingsService.getSetting('challenges_enabled');
    if (enabled === 'false') {
      return res.json({ challenge: null });
    }
    const info = await challengesService.getActiveChallengeInfo();
    res.json(info || { challenge: null });
  } catch (err) {
    next(err);
  }
});

export default router;

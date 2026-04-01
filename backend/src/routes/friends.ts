import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { emailVerifiedMiddleware } from '../middleware/emailVerified';
import { validate } from '../middleware/validation';
import * as friendsService from '../services/friends';

const router = Router();

const searchSchema = z.object({
  query: z.string().min(2).max(20),
});

// List friends + pending requests (enriched with presence)
router.get('/friends', authMiddleware, emailVerifiedMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const [friends, pending, blocked] = await Promise.all([
      friendsService.getFriends(userId),
      friendsService.getPendingRequests(userId),
      friendsService.getBlockedUsers(userId),
    ]);
    res.json({ friends, incoming: pending.incoming, outgoing: pending.outgoing, blocked });
  } catch (err) {
    next(err);
  }
});

// List blocked users
router.get('/friends/blocked', authMiddleware, emailVerifiedMiddleware, async (req, res, next) => {
  try {
    const blocked = await friendsService.getBlockedUsers(req.user!.userId);
    res.json({ blocked });
  } catch (err) {
    next(err);
  }
});

// Search users by username prefix
router.post(
  '/friends/search',
  authMiddleware,
  emailVerifiedMiddleware,
  validate(searchSchema),
  async (req, res, next) => {
    try {
      const results = await friendsService.searchUsers(req.body.query, req.user!.userId);
      res.json({ users: results });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

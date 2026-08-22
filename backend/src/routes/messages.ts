import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { emailVerifiedMiddleware } from '../middleware/emailVerified';
import * as messageService from '../services/messages';

const router = Router();

// GET /messages — conversation list
router.get('/messages', authMiddleware, emailVerifiedMiddleware, async (req, res, next) => {
  try {
    const conversations = await messageService.getConversationList(req.user!.userId);
    res.json({ conversations });
  } catch (err) {
    next(err);
  }
});

// GET /messages/unread — unread counts per user
router.get('/messages/unread', authMiddleware, emailVerifiedMiddleware, async (req, res, next) => {
  try {
    const counts = await messageService.getUnreadCounts(req.user!.userId);
    res.json({ counts });
  } catch (err) {
    next(err);
  }
});

// GET /messages/:userId — paginated conversation history
router.get('/messages/:userId', authMiddleware, emailVerifiedMiddleware, async (req, res, next) => {
  try {
    const otherUserId = parseInt(req.params.userId);
    if (isNaN(otherUserId)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    // Clamped like /leaderboard and every /admin listing already are. This was the last route
    // missing a lower bound: `?page=-5` produced a negative SQL OFFSET and `?limit=-5` a negative
    // LIMIT, both of which the driver rejects — surfacing as an opaque 500 plus an error-level log
    // for anyone who edits the URL. (audit ADMIN-PAGINATION-1)
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const result = await messageService.getConversation(req.user!.userId, otherUserId, page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PUT /messages/:userId/read — mark messages from userId as read
router.put(
  '/messages/:userId/read',
  authMiddleware,
  emailVerifiedMiddleware,
  async (req, res, next) => {
    try {
      const senderId = parseInt(req.params.userId);
      if (isNaN(senderId)) {
        res.status(400).json({ error: 'Invalid user ID' });
        return;
      }
      await messageService.markRead(req.user!.userId, senderId);
      res.json({ message: 'Messages marked as read' });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

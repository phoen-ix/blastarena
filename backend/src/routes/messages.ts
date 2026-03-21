import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import * as messageService from '../services/messages';

const router = Router();

// GET /messages — conversation list
router.get('/messages', authMiddleware, async (req, res, next) => {
  try {
    const conversations = await messageService.getConversationList(req.user!.userId);
    res.json({ conversations });
  } catch (err) {
    next(err);
  }
});

// GET /messages/unread — unread counts per user
router.get('/messages/unread', authMiddleware, async (req, res, next) => {
  try {
    const counts = await messageService.getUnreadCounts(req.user!.userId);
    res.json({ counts });
  } catch (err) {
    next(err);
  }
});

// GET /messages/:userId — paginated conversation history
router.get('/messages/:userId', authMiddleware, async (req, res, next) => {
  try {
    const otherUserId = parseInt(req.params.userId);
    if (isNaN(otherUserId)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const result = await messageService.getConversation(req.user!.userId, otherUserId, page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PUT /messages/:userId/read — mark messages from userId as read
router.put('/messages/:userId/read', authMiddleware, async (req, res, next) => {
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
});

export default router;

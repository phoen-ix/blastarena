import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { emailVerifiedMiddleware } from '../middleware/emailVerified';
import * as lobbyService from '../services/lobby';

const router = Router();

// Rooms are created over the socket (`room:create`), which validates the full MatchConfig, joins
// the creator's socket to the room and broadcasts the list. The REST `POST /lobby/rooms` that
// used to live here had no caller, accepted a MatchConfig missing eight fields and did none of
// that — a worse duplicate, so it is gone. (audit G6)

router.get('/lobby/rooms', authMiddleware, emailVerifiedMiddleware, async (_req, res, next) => {
  try {
    const rooms = await lobbyService.listRooms();
    res.json(rooms);
  } catch (err) {
    next(err);
  }
});

export default router;

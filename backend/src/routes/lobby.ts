import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import * as lobbyService from '../services/lobby';

const router = Router();

const createRoomSchema = z.object({
  name: z.string().min(3).max(30),
  config: z.object({
    gameMode: z.enum(['ffa', 'teams', 'battle_royale']),
    maxPlayers: z.number().min(2).max(8),
    mapWidth: z.number().min(11).max(21).optional().default(15),
    mapHeight: z.number().min(9).max(17).optional().default(13),
    mapSeed: z.number().optional(),
    roundTime: z.number().min(60).max(600).optional().default(180),
  }),
});

router.get('/lobby/rooms', authMiddleware, async (_req, res, next) => {
  try {
    const rooms = await lobbyService.listRooms();
    res.json(rooms);
  } catch (err) {
    next(err);
  }
});

router.post('/lobby/rooms', authMiddleware, validate(createRoomSchema), async (req, res, next) => {
  try {
    const room = await lobbyService.createRoom(
      { id: req.user!.userId, username: req.user!.username, role: req.user!.role },
      req.body.name,
      req.body.config
    );
    res.status(201).json(room);
  } catch (err) {
    next(err);
  }
});

export default router;

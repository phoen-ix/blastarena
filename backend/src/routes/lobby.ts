import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { emailVerifiedMiddleware } from '../middleware/emailVerified';
import { validate } from '../middleware/validation';
import * as lobbyService from '../services/lobby';

const router = Router();

const createRoomSchema = z.object({
  name: z.string().min(1).max(50),
  config: z.object({
    gameMode: z.enum([
      'ffa',
      'teams',
      'battle_royale',
      'sudden_death',
      'deathmatch',
      'king_of_the_hill',
    ]),
    maxPlayers: z.number().int().min(2).max(8),
    mapWidth: z.number().int().min(9).max(51).optional().default(15),
    mapHeight: z.number().int().min(9).max(51).optional().default(13),
    mapSeed: z.number().int().optional(),
    roundTime: z.number().int().min(30).max(600).optional().default(180),
    wallDensity: z.number().min(0).max(1).optional(),
    enabledPowerUps: z
      .array(
        z.enum([
          'bomb_up',
          'fire_up',
          'speed_up',
          'shield',
          'kick',
          'pierce_bomb',
          'remote_bomb',
          'line_bomb',
          'bomb_throw',
        ]),
      )
      .optional(),
    powerUpDropRate: z.number().min(0).max(1).optional(),
    botCount: z.number().int().min(0).max(7).optional(),
    botDifficulty: z.enum(['easy', 'normal', 'hard']).optional(),
    friendlyFire: z.boolean().optional(),
    hazardTiles: z.boolean().optional(),
    enableMapEvents: z.boolean().optional(),
    reinforcedWalls: z.boolean().optional(),
    recordGame: z.boolean().optional(),
    botAiId: z.string().optional(),
  }),
});

router.get('/lobby/rooms', authMiddleware, emailVerifiedMiddleware, async (_req, res, next) => {
  try {
    const rooms = await lobbyService.listRooms();
    res.json(rooms);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/lobby/rooms',
  authMiddleware,
  emailVerifiedMiddleware,
  validate(createRoomSchema),
  async (req, res, next) => {
    try {
      const room = await lobbyService.createRoom(
        {
          id: req.user!.userId,
          username: req.user!.username,
          role: req.user!.role,
          language: 'en',
          emailVerified: true,
        },
        req.body.name,
        req.body.config,
      );
      res.status(201).json(room);
    } catch (err) {
      next(err);
    }
  },
);

export default router;

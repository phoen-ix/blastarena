import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { staffMiddleware, adminOnlyMiddleware } from '../middleware/admin';
import { validate } from '../middleware/validation';
import { getConfig } from '../config';
import * as adminService from '../services/admin';
import * as replayService from '../services/replay';
import * as settingsService from '../services/settings';
import * as botaiService from '../services/botai';
import * as enemyaiService from '../services/enemyai';
import * as seasonService from '../services/season';
import * as achievementsService from '../services/achievements';
import * as cosmeticsService from '../services/cosmetics';
import { invalidateTransporter, sendTestEmail } from '../services/email';
import { getSimulationManager, getIO } from '../game/registry';
import { execute } from '../db/connection';
import {
  SimulationConfig,
  GameDefaults,
  SimulationDefaults,
  EmailSettings,
  RankConfig,
  AchievementExportData,
  AchievementBundleExportData,
  CosmeticExportData,
  AchievementImportConflict,
  THEME_IDS,
} from '@blast-arena/shared';
import { getErrorMessage } from '@blast-arena/shared';
import multer from 'multer';

const router = Router();

const roleSchema = z.object({
  role: z.enum(['user', 'moderator', 'admin']),
});

const deactivateSchema = z.object({
  deactivated: z.boolean(),
});

const toastSchema = z.object({
  message: z.string().min(1).max(500),
});

const bannerSchema = z.object({
  message: z.string().min(1).max(1000),
});

const resetPasswordSchema = z.object({
  password: z.string().min(6).max(128),
});

const createUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_-]+$/),
  email: z.string().email().max(255),
  password: z.string().min(6).max(128),
  role: z.enum(['user', 'moderator', 'admin']).optional(),
});

// Public: batched public settings (no auth required) — reduces 3 requests to 1
router.get('/admin/settings/public', async (_req, res, next) => {
  try {
    const [registrationEnabled, displayImprint, imprintText, displayGithub] = await Promise.all([
      settingsService.isRegistrationEnabled(),
      settingsService.getSetting('display_imprint'),
      settingsService.getSetting('imprint_text'),
      settingsService.getSetting('display_github'),
    ]);
    const imprint = displayImprint === 'true';
    res.json({
      registrationEnabled,
      imprint: imprint,
      imprintText: imprint ? (imprintText ?? '') : '',
      displayGithub: displayGithub === 'true',
    });
  } catch (err) {
    next(err);
  }
});

// Public: get registration enabled setting (no auth required, needed by auth UI)
router.get('/admin/settings/registration_enabled', async (_req, res, next) => {
  try {
    const enabled = await settingsService.isRegistrationEnabled();
    res.json({ enabled });
  } catch (err) {
    next(err);
  }
});

// Public: get recordings enabled setting (no auth required, like banner)
router.get('/admin/settings/recordings_enabled', async (_req, res, next) => {
  try {
    const enabled = await settingsService.isRecordingEnabled();
    res.json({ enabled });
  } catch (err) {
    next(err);
  }
});

// Public: get game creation defaults (no auth required)
router.get('/admin/settings/game_defaults', async (_req, res, next) => {
  try {
    const defaults = await settingsService.getGameDefaults();
    res.json({ defaults });
  } catch (err) {
    next(err);
  }
});

// Public: get active AIs (no auth required, needed by room creation dropdown)
router.get('/admin/ai/active', async (_req, res, next) => {
  try {
    const ais = await botaiService.listActiveAIs();
    res.json({ ais });
  } catch (err) {
    next(err);
  }
});

// Public: get active banner (no auth required)
router.get('/admin/announcements/banner', async (_req, res, next) => {
  try {
    const banner = await adminService.getActiveBanner();
    res.json(banner);
  } catch (err) {
    next(err);
  }
});

// Public: get party chat mode (no auth required, needed by PartyBar)
router.get('/admin/settings/party_chat_mode', async (_req, res, next) => {
  try {
    const mode = await settingsService.getChatMode();
    res.json({ mode });
  } catch (err) {
    next(err);
  }
});

// Public: get lobby chat mode (no auth required, needed by LobbyChatPanel)
router.get('/admin/settings/lobby_chat_mode', async (_req, res, next) => {
  try {
    const mode = await settingsService.getLobbyChatMode();
    res.json({ mode });
  } catch (err) {
    next(err);
  }
});

// Public: get DM mode (no auth required, needed by DMPanel)
router.get('/admin/settings/dm_mode', async (_req, res, next) => {
  try {
    const mode = await settingsService.getDMMode();
    res.json({ mode });
  } catch (err) {
    next(err);
  }
});

// Public: get emote mode (no auth required, needed by GameScene)
router.get('/admin/settings/emote_mode', async (_req, res, next) => {
  try {
    const mode = await settingsService.getEmoteMode();
    res.json({ mode });
  } catch (err) {
    next(err);
  }
});

// Public: get spectator chat mode (no auth required, needed by SpectatorChat)
router.get('/admin/settings/spectator_chat_mode', async (_req, res, next) => {
  try {
    const mode = await settingsService.getSpectatorChatMode();
    res.json({ mode });
  } catch (err) {
    next(err);
  }
});

// Public: get XP multiplier (no auth required)
router.get('/admin/settings/xp_multiplier', async (_req, res, next) => {
  try {
    const value = await settingsService.getSetting('xp_multiplier');
    res.json({ multiplier: parseFloat(value ?? '1') });
  } catch (err) {
    next(err);
  }
});

// Public: get default theme
router.get('/admin/settings/default_theme', async (_req, res, next) => {
  try {
    const theme = await settingsService.getSetting('default_theme');
    res.json({ theme: theme || 'inferno' });
  } catch (err) {
    next(err);
  }
});

// Public: get imprint settings (no auth required, needed by AuthUI + HelpUI)
router.get('/admin/settings/imprint', async (_req, res, next) => {
  try {
    const enabled = (await settingsService.getSetting('display_imprint')) === 'true';
    const text = enabled ? ((await settingsService.getSetting('imprint_text')) ?? '') : '';
    res.json({ enabled, text });
  } catch (err) {
    next(err);
  }
});

// Public: get github display setting (no auth required, needed by AuthUI + HelpUI)
router.get('/admin/settings/display_github', async (_req, res, next) => {
  try {
    const enabled = (await settingsService.getSetting('display_github')) === 'true';
    res.json({ enabled });
  } catch (err) {
    next(err);
  }
});

// All other admin routes require auth + staff role (admin or moderator)
router.use(authMiddleware, staffMiddleware);

// --- Settings ---

const toggleSchema = z.object({
  enabled: z.boolean(),
});

router.put(
  '/admin/settings/registration_enabled',
  adminOnlyMiddleware,
  validate(toggleSchema),
  async (req, res, next) => {
    try {
      await settingsService.setSetting('registration_enabled', String(req.body.enabled));
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'update_setting',
          'setting',
          0,
          JSON.stringify({ key: 'registration_enabled', value: req.body.enabled }),
        ],
      );
      const io = getIO();
      io.emit('admin:settingsChanged', {
        key: 'registration_enabled',
        value: req.body.enabled,
      });
      res.json({ message: 'Setting updated' });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/settings/recordings_enabled',
  adminOnlyMiddleware,
  validate(toggleSchema),
  async (req, res, next) => {
    try {
      await settingsService.setSetting('recordings_enabled', String(req.body.enabled));
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'update_setting',
          'setting',
          0,
          JSON.stringify({ key: 'recordings_enabled', value: req.body.enabled }),
        ],
      );
      // Broadcast to all connected clients
      const io = getIO();
      io.emit('admin:settingsChanged', {
        key: 'recordings_enabled',
        value: req.body.enabled,
      });
      res.json({ message: 'Setting updated' });
    } catch (err) {
      next(err);
    }
  },
);

const chatModeSchema = z.object({
  mode: z.enum(['everyone', 'staff', 'admin_only', 'disabled']),
});

router.put(
  '/admin/settings/party_chat_mode',
  adminOnlyMiddleware,
  validate(chatModeSchema),
  async (req, res, next) => {
    try {
      await settingsService.setSetting('party_chat_mode', req.body.mode);
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'update_setting',
          'setting',
          0,
          JSON.stringify({ key: 'party_chat_mode', value: req.body.mode }),
        ],
      );
      const io = getIO();
      io.emit('admin:settingsChanged', {
        key: 'party_chat_mode',
        value: req.body.mode,
      });
      res.json({ message: 'Setting updated' });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/settings/lobby_chat_mode',
  adminOnlyMiddleware,
  validate(chatModeSchema),
  async (req, res, next) => {
    try {
      await settingsService.setSetting('lobby_chat_mode', req.body.mode);
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'update_setting',
          'setting',
          0,
          JSON.stringify({ key: 'lobby_chat_mode', value: req.body.mode }),
        ],
      );
      const io = getIO();
      io.emit('admin:settingsChanged', { key: 'lobby_chat_mode', value: req.body.mode });
      res.json({ message: 'Setting updated' });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/settings/dm_mode',
  adminOnlyMiddleware,
  validate(chatModeSchema),
  async (req, res, next) => {
    try {
      await settingsService.setSetting('dm_mode', req.body.mode);
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'update_setting',
          'setting',
          0,
          JSON.stringify({ key: 'dm_mode', value: req.body.mode }),
        ],
      );
      const io = getIO();
      io.emit('admin:settingsChanged', { key: 'dm_mode', value: req.body.mode });
      res.json({ message: 'Setting updated' });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/settings/emote_mode',
  adminOnlyMiddleware,
  validate(chatModeSchema),
  async (req, res, next) => {
    try {
      await settingsService.setSetting('emote_mode', req.body.mode);
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'update_setting',
          'setting',
          0,
          JSON.stringify({ key: 'emote_mode', value: req.body.mode }),
        ],
      );
      const io = getIO();
      io.emit('admin:settingsChanged', { key: 'emote_mode', value: req.body.mode });
      res.json({ message: 'Setting updated' });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/settings/spectator_chat_mode',
  adminOnlyMiddleware,
  validate(chatModeSchema),
  async (req, res, next) => {
    try {
      await settingsService.setSetting('spectator_chat_mode', req.body.mode);
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'update_setting',
          'setting',
          0,
          JSON.stringify({ key: 'spectator_chat_mode', value: req.body.mode }),
        ],
      );
      const io = getIO();
      io.emit('admin:settingsChanged', { key: 'spectator_chat_mode', value: req.body.mode });
      res.json({ message: 'Setting updated' });
    } catch (err) {
      next(err);
    }
  },
);

router.put('/admin/settings/xp_multiplier', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const multiplier = parseFloat(req.body.multiplier);
    if (isNaN(multiplier) || multiplier < 0 || multiplier > 10) {
      return res.status(400).json({ error: 'Multiplier must be between 0 and 10' });
    }
    await settingsService.setSetting('xp_multiplier', String(multiplier));
    await execute(
      'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [
        req.user!.userId,
        'update_setting',
        'setting',
        0,
        JSON.stringify({ key: 'xp_multiplier', value: multiplier }),
      ],
    );
    const io = getIO();
    io.emit('admin:settingsChanged', { key: 'xp_multiplier', value: multiplier });
    res.json({ message: 'XP multiplier updated' });
  } catch (err) {
    next(err);
  }
});

const themeSchema = z.object({
  theme: z.enum(THEME_IDS as unknown as [string, ...string[]]),
});

router.put(
  '/admin/settings/default_theme',
  adminOnlyMiddleware,
  validate(themeSchema),
  async (req, res, next) => {
    try {
      await settingsService.setSetting('default_theme', req.body.theme);
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'update_setting',
          'setting',
          0,
          JSON.stringify({ key: 'default_theme', value: req.body.theme }),
        ],
      );
      const io = getIO();
      io.emit('admin:settingsChanged', { key: 'default_theme', value: req.body.theme });
      res.json({ message: 'Default theme updated' });
    } catch (err) {
      next(err);
    }
  },
);

// --- Imprint & GitHub Display ---

const imprintSchema = z.object({
  enabled: z.boolean(),
  text: z.string().max(10000).optional(),
});

router.put(
  '/admin/settings/imprint',
  adminOnlyMiddleware,
  validate(imprintSchema),
  async (req, res, next) => {
    try {
      await settingsService.setSetting('display_imprint', String(req.body.enabled));
      if (req.body.text !== undefined) {
        await settingsService.setSetting('imprint_text', req.body.text);
      }
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'update_setting',
          'setting',
          0,
          JSON.stringify({ key: 'imprint', value: req.body.enabled }),
        ],
      );
      res.json({ message: 'Imprint settings updated' });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/settings/display_github',
  adminOnlyMiddleware,
  validate(toggleSchema),
  async (req, res, next) => {
    try {
      await settingsService.setSetting('display_github', String(req.body.enabled));
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'update_setting',
          'setting',
          0,
          JSON.stringify({ key: 'display_github', value: req.body.enabled }),
        ],
      );
      res.json({ message: 'Setting updated' });
    } catch (err) {
      next(err);
    }
  },
);

// --- Game/Simulation Defaults ---

const gameDefaultsSchema = z.object({
  defaults: z.object({
    gameMode: z
      .enum(['ffa', 'teams', 'battle_royale', 'sudden_death', 'deathmatch', 'king_of_the_hill'])
      .optional(),
    maxPlayers: z.number().int().min(2).max(8).optional(),
    roundTime: z.number().int().min(30).max(600).optional(),
    mapWidth: z.number().int().min(11).max(61).optional(),
    wallDensity: z.number().min(0).max(1).optional(),
    powerUpDropRate: z.number().min(0).max(1).optional(),
    botCount: z.number().int().min(0).max(7).optional(),
    botDifficulty: z.enum(['easy', 'normal', 'hard']).optional(),
    reinforcedWalls: z.boolean().optional(),
    enableMapEvents: z.boolean().optional(),
    hazardTiles: z.boolean().optional(),
    friendlyFire: z.boolean().optional(),
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
    botAiId: z.string().max(36).optional(),
  }),
});

const simulationDefaultsSchema = z.object({
  defaults: z.object({
    gameMode: z
      .enum(['ffa', 'teams', 'battle_royale', 'sudden_death', 'deathmatch', 'king_of_the_hill'])
      .optional(),
    maxPlayers: z.number().int().min(2).max(8).optional(),
    roundTime: z.number().int().min(30).max(600).optional(),
    mapWidth: z.number().int().min(11).max(61).optional(),
    wallDensity: z.number().min(0).max(1).optional(),
    powerUpDropRate: z.number().min(0).max(1).optional(),
    botCount: z.number().int().min(0).max(8).optional(),
    botDifficulty: z.enum(['easy', 'normal', 'hard']).optional(),
    reinforcedWalls: z.boolean().optional(),
    enableMapEvents: z.boolean().optional(),
    hazardTiles: z.boolean().optional(),
    friendlyFire: z.boolean().optional(),
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
    totalGames: z.number().int().min(1).max(1000).optional(),
    speed: z.enum(['fast', 'realtime']).optional(),
    logVerbosity: z.enum(['normal', 'detailed', 'full']).optional(),
    recordReplays: z.boolean().optional(),
    botAiId: z.string().max(36).optional(),
  }),
});

router.get('/admin/settings/simulation_defaults', async (_req, res, next) => {
  try {
    const defaults = await settingsService.getSimulationDefaults();
    res.json({ defaults });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/admin/settings/game_defaults',
  adminOnlyMiddleware,
  validate(gameDefaultsSchema),
  async (req, res, next) => {
    try {
      const defaults = req.body.defaults as GameDefaults;
      await settingsService.setGameDefaults(defaults);
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'update_setting',
          'setting',
          0,
          JSON.stringify({ key: 'game_defaults', value: defaults }),
        ],
      );
      const io = getIO();
      io.emit('admin:settingsChanged', { key: 'game_defaults', value: defaults });
      res.json({ message: 'Game defaults updated' });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/settings/simulation_defaults',
  adminOnlyMiddleware,
  validate(simulationDefaultsSchema),
  async (req, res, next) => {
    try {
      const defaults = req.body.defaults as SimulationDefaults;
      await settingsService.setSimulationDefaults(defaults);
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'update_setting',
          'setting',
          0,
          JSON.stringify({ key: 'simulation_defaults', value: defaults }),
        ],
      );
      const io = getIO();
      io.emit('admin:settingsChanged', { key: 'simulation_defaults', value: defaults });
      res.json({ message: 'Simulation defaults updated' });
    } catch (err) {
      next(err);
    }
  },
);

// --- Email Settings ---

const PASSWORD_MASK = '••••••••';

const emailSettingsSchema = z.object({
  smtpHost: z.string().max(255).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpUser: z.string().max(255).optional(),
  smtpPassword: z.string().max(255).optional(),
  fromEmail: z.union([z.string().email().max(255), z.literal('')]).optional(),
  fromName: z.string().max(100).optional(),
});

const testEmailSchema = z.object({
  to: z.string().email(),
});

router.get('/admin/settings/email_settings', adminOnlyMiddleware, async (_req, res, next) => {
  try {
    const config = getConfig();
    const dbSettings = await settingsService.getEmailSettings();

    const effective: EmailSettings = {
      smtpHost: dbSettings.smtpHost ?? config.SMTP_HOST,
      smtpPort: dbSettings.smtpPort ?? config.SMTP_PORT,
      smtpUser: dbSettings.smtpUser ?? config.SMTP_USER,
      smtpPassword: (dbSettings.smtpPassword ?? config.SMTP_PASSWORD) ? PASSWORD_MASK : '',
      fromEmail: dbSettings.fromEmail ?? config.SMTP_FROM_EMAIL,
      fromName: dbSettings.fromName ?? config.SMTP_FROM_NAME,
    };

    res.json({ settings: effective });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/admin/settings/email_settings',
  adminOnlyMiddleware,
  validate(emailSettingsSchema),
  async (req, res, next) => {
    try {
      const incoming = req.body as EmailSettings;
      const existing = await settingsService.getEmailSettings();

      // Password handling: preserve existing if masked/undefined, clear if empty string
      if (incoming.smtpPassword === PASSWORD_MASK || incoming.smtpPassword === undefined) {
        incoming.smtpPassword = existing.smtpPassword;
      } else if (incoming.smtpPassword === '') {
        delete incoming.smtpPassword;
      }

      await settingsService.setEmailSettings(incoming);
      invalidateTransporter();

      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'update_setting',
          'setting',
          0,
          JSON.stringify({ key: 'email_settings' }),
        ],
      );

      const io = getIO();
      io.emit('admin:settingsChanged', { key: 'email_settings' });

      res.json({ message: 'Email settings updated' });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/admin/settings/email_settings/test',
  adminOnlyMiddleware,
  validate(testEmailSchema),
  async (req, res, _next) => {
    try {
      await sendTestEmail(req.body.to, req.locale || 'en');
      res.json({ message: 'Test email sent successfully' });
    } catch (err) {
      res.status(400).json({ error: `Failed to send test email: ${getErrorMessage(err)}` });
    }
  },
);

// --- Users ---

router.post(
  '/admin/users',
  adminOnlyMiddleware,
  validate(createUserSchema),
  async (req, res, next) => {
    try {
      const user = await adminService.createUser(
        req.user!.userId,
        req.body.username,
        req.body.email,
        req.body.password,
        req.body.role,
      );
      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  },
);

router.get('/admin/users', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string | undefined;
    const result = await adminService.listUsers(page, limit, search);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.put(
  '/admin/users/:id/role',
  adminOnlyMiddleware,
  validate(roleSchema),
  async (req, res, next) => {
    try {
      const userId = parseInt(req.params.id);
      if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });
      await adminService.changeUserRole(req.user!.userId, userId, req.body.role);
      res.json({ message: 'Role updated' });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/users/:id/deactivate',
  adminOnlyMiddleware,
  validate(deactivateSchema),
  async (req, res, next) => {
    try {
      const userId = parseInt(req.params.id);
      if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });
      await adminService.deactivateUser(req.user!.userId, userId, req.body.deactivated);
      res.json({ message: req.body.deactivated ? 'User deactivated' : 'User reactivated' });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/users/:id/password',
  adminOnlyMiddleware,
  validate(resetPasswordSchema),
  async (req, res, next) => {
    try {
      const userId = parseInt(req.params.id);
      if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });
      await adminService.resetUserPassword(req.user!.userId, userId, req.body.password);
      res.json({ message: 'Password reset' });
    } catch (err) {
      next(err);
    }
  },
);

router.delete('/admin/users/:id', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });
    await adminService.deleteUser(req.user!.userId, userId);
    res.json({ message: 'User deleted' });
  } catch (err) {
    next(err);
  }
});

// --- Stats ---

router.get('/admin/stats', adminOnlyMiddleware, async (_req, res, next) => {
  try {
    const stats = await adminService.getServerStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// --- Matches ---

router.get('/admin/matches', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const result = await adminService.getMatchHistory(page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/admin/matches/:id', async (req, res, next) => {
  try {
    const matchId = parseInt(req.params.id);
    if (isNaN(matchId)) return res.status(400).json({ error: 'Invalid match ID' });
    const result = await adminService.getMatchDetail(matchId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/matches/:id', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const matchId = parseInt(req.params.id);
    if (isNaN(matchId)) return res.status(400).json({ error: 'Invalid match ID' });
    // Delete replay file if it exists
    replayService.deleteReplay(matchId);
    // Delete match record (cascades to match_players)
    await execute('DELETE FROM matches WHERE id = ?', [matchId]);
    await execute(
      'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user!.userId, 'delete_match', 'match', matchId, JSON.stringify({ matchId })],
    );
    res.json({ message: 'Match deleted' });
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/matches', adminOnlyMiddleware, async (req, res, next) => {
  try {
    // Get all match IDs to clean up replay files
    const matches = await adminService.getMatchHistory(1, 100000);
    let replaysCleaned = 0;
    for (const m of matches.matches) {
      if (replayService.deleteReplay(m.id)) replaysCleaned++;
    }
    // Delete all match records (cascades to match_players)
    await execute('DELETE FROM matches');
    await execute(
      'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [
        req.user!.userId,
        'delete_all_matches',
        'match',
        0,
        JSON.stringify({ count: matches.total, replaysCleaned }),
      ],
    );
    res.json({ message: 'All matches deleted', count: matches.total, replaysCleaned });
  } catch (err) {
    next(err);
  }
});

// --- Active Rooms ---

router.get('/admin/rooms', async (_req, res, next) => {
  try {
    const rooms = await adminService.getActiveRooms();
    res.json(rooms);
  } catch (err) {
    next(err);
  }
});

// --- Admin Action Log ---

router.get('/admin/actions', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const action = req.query.action as string | undefined;
    const result = await adminService.getAdminActions(page, limit, action);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// --- Announcements ---

router.post('/admin/announcements/toast', validate(toastSchema), async (req, res, next) => {
  try {
    await adminService.sendToast(req.user!.userId, req.body.message);
    res.json({ message: 'Toast sent' });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/admin/announcements/banner',
  adminOnlyMiddleware,
  validate(bannerSchema),
  async (req, res, next) => {
    try {
      await adminService.setBanner(req.user!.userId, req.body.message);
      res.json({ message: 'Banner set' });
    } catch (err) {
      next(err);
    }
  },
);

router.delete('/admin/announcements/banner', adminOnlyMiddleware, async (req, res, next) => {
  try {
    await adminService.clearBanner(req.user!.userId);
    res.json({ message: 'Banner cleared' });
  } catch (err) {
    next(err);
  }
});

// --- Replays ---

router.get('/admin/replays', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const result = await replayService.listReplays(page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/admin/replays/:matchId', async (req, res, next) => {
  try {
    const matchId = parseInt(req.params.matchId);
    const replay = await replayService.getReplay(matchId);
    if (!replay) {
      res.status(404).json({ error: 'Replay not found' });
      return;
    }
    res.json(replay);
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/replays/:matchId', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const matchId = parseInt(req.params.matchId);
    const deleted = replayService.deleteReplay(matchId);
    if (!deleted) {
      res.status(404).json({ error: 'Replay not found' });
      return;
    }
    res.json({ message: 'Replay deleted' });
  } catch (err) {
    next(err);
  }
});

// --- Campaign Replays ---

router.get('/admin/campaign-replays', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const userId = req.query.userId ? parseInt(req.query.userId as string) : undefined;
    const levelId = req.query.levelId ? parseInt(req.query.levelId as string) : undefined;
    const result = await replayService.listCampaignReplays(page, limit, userId, levelId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/admin/campaign-replays/:sessionId', async (req, res, next) => {
  try {
    const replay = await replayService.getCampaignReplay(req.params.sessionId);
    if (!replay) {
      res.status(404).json({ error: 'Campaign replay not found' });
      return;
    }
    res.json(replay);
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/campaign-replays/:sessionId', adminOnlyMiddleware, async (req, res, next) => {
  try {
    await replayService.deleteCampaignReplay(req.params.sessionId);
    res.json({ message: 'Campaign replay deleted' });
  } catch (err) {
    next(err);
  }
});

// --- Simulations ---

const simulationConfigSchema = z.object({
  gameMode: z.enum([
    'ffa',
    'teams',
    'battle_royale',
    'sudden_death',
    'deathmatch',
    'king_of_the_hill',
  ]),
  botCount: z.number().int().min(2).max(8),
  botDifficulty: z.enum(['easy', 'normal', 'hard']),
  mapWidth: z.number().int().min(11).max(61),
  mapHeight: z.number().int().min(11).max(61),
  roundTime: z.number().int().min(30).max(600),
  wallDensity: z.number().min(0).max(1),
  enabledPowerUps: z.array(
    z.enum([
      'bomb_up',
      'fire_up',
      'speed_up',
      'shield',
      'kick',
      'pierce_bomb',
      'remote_bomb',
      'line_bomb',
    ]),
  ),
  powerUpDropRate: z.number().min(0).max(1),
  friendlyFire: z.boolean(),
  hazardTiles: z.boolean(),
  reinforcedWalls: z.boolean(),
  enableMapEvents: z.boolean(),
  totalGames: z.number().int().min(1).max(1000),
  speed: z.enum(['fast', 'realtime']),
  logVerbosity: z.enum(['normal', 'detailed', 'full']),
  botTeams: z.array(z.number().nullable()).optional(),
  recordReplays: z.boolean().optional(),
  botAiId: z.string().max(36).optional(),
});

router.get('/admin/simulations', adminOnlyMiddleware, (req, res) => {
  const mgr = getSimulationManager();
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  res.json(mgr.getHistory(page, limit));
});

router.get('/admin/simulations/:batchId', adminOnlyMiddleware, (req, res) => {
  const mgr = getSimulationManager();
  const data = mgr.getBatchResults(req.params.batchId);
  if (!data) {
    res.status(404).json({ error: 'Batch not found' });
    return;
  }
  res.json(data);
});

router.get(
  '/admin/simulations/:batchId/replay/:gameIndex',
  adminOnlyMiddleware,
  async (req, res, next) => {
    try {
      const mgr = getSimulationManager();
      const gameIndex = parseInt(req.params.gameIndex);
      if (isNaN(gameIndex) || gameIndex < 0) {
        res.status(400).json({ error: 'Invalid game index' });
        return;
      }
      const replay = await mgr.getSimulationReplay(req.params.batchId, gameIndex);
      if (!replay) {
        res.status(404).json({ error: 'Replay not found' });
        return;
      }
      res.json(replay);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/admin/simulations',
  adminOnlyMiddleware,
  validate(simulationConfigSchema),
  (req, res) => {
    const mgr = getSimulationManager();
    const result = mgr.startBatch(req.body as SimulationConfig, req.user!.userId);
    if ('error' in result) {
      res.status(429).json(result);
      return;
    }
    res.status(201).json(result);
  },
);

router.delete('/admin/simulations/:batchId', adminOnlyMiddleware, (req, res) => {
  const mgr = getSimulationManager();
  // Try cancelling if running
  mgr.cancelBatch(req.params.batchId);
  // Delete from disk and memory
  const deleted = mgr.deleteBatch(req.params.batchId);
  if (!deleted) {
    res.status(404).json({ error: 'Batch not found' });
    return;
  }
  res.json({ message: 'Batch deleted' });
});

// --- Bot AI Management ---

const aiUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 }, // 500KB
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.endsWith('.ts')) {
      cb(new Error('Only TypeScript (.ts) files are accepted'));
      return;
    }
    cb(null, true);
  },
});

const aiUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
});

router.get('/admin/ai', adminOnlyMiddleware, async (_req, res, next) => {
  try {
    const ais = await botaiService.listAllAIs();
    res.json({ ais });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/ai', adminOnlyMiddleware, aiUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    const name = req.body.name as string;
    const description = (req.body.description as string) || '';
    if (!name || name.length < 1 || name.length > 100) {
      res.status(400).json({ error: 'Name is required (1-100 characters)' });
      return;
    }
    const result = await botaiService.uploadAI(
      name,
      description,
      req.file.buffer,
      req.file.originalname,
      req.user!.userId,
    );
    if (result.errors && result.errors.length > 0) {
      res.status(400).json({ error: 'Compilation/validation failed', errors: result.errors });
      return;
    }
    res.status(201).json({ ai: result.entry });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/admin/ai/:id',
  adminOnlyMiddleware,
  validate(aiUpdateSchema),
  async (req, res, next) => {
    try {
      await botaiService.updateAI(req.params.id, req.body, req.user!.userId);
      res.json({ message: 'AI updated' });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/ai/:id/upload',
  adminOnlyMiddleware,
  aiUpload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      const result = await botaiService.reuploadAI(
        req.params.id,
        req.file.buffer,
        req.file.originalname,
        req.user!.userId,
      );
      if (!result.success) {
        res.status(400).json({ error: 'Compilation/validation failed', errors: result.errors });
        return;
      }
      res.json({ message: 'AI updated' });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/admin/ai/:id/download', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const source = await botaiService.downloadSource(req.params.id);
    if (!source) {
      res.status(404).json({ error: 'AI source not found' });
      return;
    }
    res.setHeader('Content-Type', 'text/typescript');
    res.setHeader('Content-Disposition', `attachment; filename="${source.filename}"`);
    res.send(source.content);
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/ai/:id', adminOnlyMiddleware, async (req, res, next) => {
  try {
    await botaiService.deleteAI(req.params.id, req.user!.userId);
    res.json({ message: 'AI deleted' });
  } catch (err) {
    next(err);
  }
});

// --- Enemy AI Management ---

const enemyAiUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.endsWith('.ts')) {
      cb(new Error('Only TypeScript (.ts) files are accepted'));
      return;
    }
    cb(null, true);
  },
});

const enemyAiUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
});

router.get('/admin/enemy-ai/active', async (_req, res, next) => {
  try {
    const ais = await enemyaiService.listActiveEnemyAIs();
    res.json({ ais });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/enemy-ai', adminOnlyMiddleware, async (_req, res, next) => {
  try {
    const ais = await enemyaiService.listAllEnemyAIs();
    res.json({ ais });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/admin/enemy-ai',
  adminOnlyMiddleware,
  enemyAiUpload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      const name = req.body.name?.trim();
      if (!name) {
        res.status(400).json({ error: 'Name is required' });
        return;
      }
      const description = req.body.description?.trim() || '';
      const result = await enemyaiService.uploadEnemyAI(
        name,
        description,
        req.file.buffer,
        req.file.originalname,
        req.user!.userId,
      );
      if (result.errors) {
        res.status(400).json({ error: 'Compilation/validation failed', errors: result.errors });
        return;
      }
      res.json({ ai: result.entry });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/enemy-ai/:id',
  adminOnlyMiddleware,
  validate(enemyAiUpdateSchema),
  async (req, res, next) => {
    try {
      await enemyaiService.updateEnemyAI(req.params.id, req.body, req.user!.userId);
      res.json({ message: 'Enemy AI updated' });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/admin/enemy-ai/:id/upload',
  adminOnlyMiddleware,
  enemyAiUpload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      const result = await enemyaiService.reuploadEnemyAI(
        req.params.id,
        req.file.buffer,
        req.file.originalname,
        req.user!.userId,
      );
      if (!result.success) {
        res.status(400).json({ error: 'Compilation/validation failed', errors: result.errors });
        return;
      }
      res.json({ message: 'Enemy AI updated' });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/admin/enemy-ai/:id/download', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const source = await enemyaiService.downloadEnemyAISource(req.params.id);
    if (!source) {
      res.status(404).json({ error: 'Enemy AI source not found' });
      return;
    }
    res.setHeader('Content-Type', 'text/typescript');
    res.setHeader('Content-Disposition', `attachment; filename="${source.filename}"`);
    res.send(source.content);
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/enemy-ai/:id', adminOnlyMiddleware, async (req, res, next) => {
  try {
    await enemyaiService.deleteEnemyAI(req.params.id, req.user!.userId);
    res.json({ message: 'Enemy AI deleted' });
  } catch (err) {
    next(err);
  }
});

// ===== Seasons =====

router.get('/admin/seasons', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const result = await seasonService.getSeasons(page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const seasonSchema = z.object({
  name: z.string().min(1).max(100),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

router.post(
  '/admin/seasons',
  adminOnlyMiddleware,
  validate(seasonSchema),
  async (req, res, next) => {
    try {
      const season = await seasonService.createSeason(
        req.body.name,
        req.body.startDate,
        req.body.endDate,
      );
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [req.user!.userId, 'season_create', 'season', season.id, `Created season: ${season.name}`],
      );
      res.json(season);
    } catch (err) {
      next(err);
    }
  },
);

router.put('/admin/seasons/:id', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await seasonService.updateSeason(id, req.body);
    await execute(
      'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user!.userId, 'season_update', 'season', id, 'Updated season'],
    );
    const season = await seasonService.getSeasonById(id);
    res.json(season);
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/seasons/:id', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await seasonService.deleteSeason(id);
    await execute(
      'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user!.userId, 'season_delete', 'season', id, 'Deleted season'],
    );
    res.json({ message: 'Season deleted' });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/seasons/:id/activate', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await seasonService.activateSeason(id);
    await execute(
      'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user!.userId, 'season_activate', 'season', id, 'Activated season'],
    );
    res.json({ message: 'Season activated' });
  } catch (err) {
    next(err);
  }
});

const endSeasonSchema = z.object({
  resetMode: z.enum(['hard', 'soft']),
});

router.post(
  '/admin/seasons/:id/end',
  adminOnlyMiddleware,
  validate(endSeasonSchema),
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      await seasonService.endSeason(id, req.body.resetMode);
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'season_end',
          'season',
          id,
          `Ended season (${req.body.resetMode} reset)`,
        ],
      );
      res.json({ message: 'Season ended' });
    } catch (err) {
      next(err);
    }
  },
);

// ===== Rank Tiers =====

router.get('/admin/settings/rank_tiers', adminOnlyMiddleware, async (_req, res, next) => {
  try {
    const config = await settingsService.getRankConfig();
    res.json(config);
  } catch (err) {
    next(err);
  }
});

router.put('/admin/settings/rank_tiers', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const config = req.body as RankConfig;
    if (!config.tiers || !Array.isArray(config.tiers)) {
      return res.status(400).json({ error: 'Invalid rank config: tiers must be an array' });
    }
    await settingsService.setRankConfig(config);
    await execute(
      'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user!.userId, 'settings_update', 'setting', 0, 'Updated rank tiers'],
    );
    res.json(config);
  } catch (err) {
    next(err);
  }
});

// ===== Achievements (admin CRUD) =====

router.get('/admin/achievements', adminOnlyMiddleware, async (_req, res, next) => {
  try {
    const achievements = await achievementsService.getAllAchievements();
    res.json({ achievements });
  } catch (err) {
    next(err);
  }
});

const achievementSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  icon: z.string().max(10).optional(),
  category: z.string().max(50).optional(),
  conditionType: z.enum(['cumulative', 'per_game', 'mode_specific', 'campaign']),
  conditionConfig: z.record(z.unknown()),
  rewardType: z.enum(['cosmetic', 'title', 'none']).optional(),
  rewardId: z.number().int().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

router.post(
  '/admin/achievements',
  adminOnlyMiddleware,
  validate(achievementSchema),
  async (req, res, next) => {
    try {
      const achievement = await achievementsService.createAchievement(req.body);
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'achievement_create',
          'achievement',
          achievement.id,
          `Created achievement: ${achievement.name}`,
        ],
      );
      res.json(achievement);
    } catch (err) {
      next(err);
    }
  },
);

router.put('/admin/achievements/:id', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await achievementsService.updateAchievement(id, req.body);
    await execute(
      'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user!.userId, 'achievement_update', 'achievement', id, 'Updated achievement'],
    );
    const achievement = await achievementsService.getAchievementById(id);
    res.json(achievement);
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/achievements/:id', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await achievementsService.deleteAchievement(id);
    await execute(
      'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user!.userId, 'achievement_delete', 'achievement', id, 'Deleted achievement'],
    );
    res.json({ message: 'Achievement deleted' });
  } catch (err) {
    next(err);
  }
});

// ===== Cosmetics (admin CRUD) =====

router.get('/admin/cosmetics', adminOnlyMiddleware, async (_req, res, next) => {
  try {
    const cosmetics = await cosmeticsService.getAllCosmetics();
    res.json({ cosmetics });
  } catch (err) {
    next(err);
  }
});

const cosmeticSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['color', 'eyes', 'trail', 'bomb_skin']),
  config: z.record(z.unknown()),
  rarity: z.enum(['common', 'rare', 'epic', 'legendary']).optional(),
  unlockType: z.enum(['achievement', 'campaign_stars', 'default']).optional(),
  unlockRequirement: z.record(z.unknown()).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

router.post(
  '/admin/cosmetics',
  adminOnlyMiddleware,
  validate(cosmeticSchema),
  async (req, res, next) => {
    try {
      const cosmetic = await cosmeticsService.createCosmetic(req.body);
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'cosmetic_create',
          'cosmetic',
          cosmetic.id,
          `Created cosmetic: ${cosmetic.name}`,
        ],
      );
      res.json(cosmetic);
    } catch (err) {
      next(err);
    }
  },
);

router.put('/admin/cosmetics/:id', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await cosmeticsService.updateCosmetic(id, req.body);
    await execute(
      'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user!.userId, 'cosmetic_update', 'cosmetic', id, 'Updated cosmetic'],
    );
    const cosmetic = await cosmeticsService.getCosmeticById(id);
    res.json(cosmetic);
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/cosmetics/:id', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await cosmeticsService.deleteCosmetic(id);
    await execute(
      'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user!.userId, 'cosmetic_delete', 'cosmetic', id, 'Deleted cosmetic'],
    );
    res.json({ message: 'Cosmetic deleted' });
  } catch (err) {
    next(err);
  }
});

// ===== Achievement Export/Import =====

router.get('/admin/achievements/:id/export', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const achievement = await achievementsService.getAchievementById(id);
    if (!achievement) {
      res.status(404).json({ error: 'Achievement not found' });
      return;
    }

    let reward: Omit<CosmeticExportData, '_format' | '_version'> | null = null;
    if (achievement.rewardType === 'cosmetic' && achievement.rewardId) {
      const cosmetic = await cosmeticsService.getCosmeticById(achievement.rewardId);
      if (cosmetic) {
        reward = {
          name: cosmetic.name,
          type: cosmetic.type,
          config: cosmetic.config,
          rarity: cosmetic.rarity,
          unlockType: cosmetic.unlockType,
          unlockRequirement: cosmetic.unlockRequirement,
          sortOrder: cosmetic.sortOrder,
        };
      }
    }

    const exportData: AchievementExportData = {
      _format: 'blast-arena-achievement',
      _version: 1,
      name: achievement.name,
      description: achievement.description,
      icon: achievement.icon,
      category: achievement.category,
      conditionType: achievement.conditionType,
      conditionConfig: achievement.conditionConfig,
      rewardType: achievement.rewardType,
      reward,
      sortOrder: achievement.sortOrder,
    };

    const filename = `achievement-${achievement.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(exportData);
  } catch (err) {
    next(err);
  }
});

router.get('/admin/achievements/export-all', adminOnlyMiddleware, async (_req, res, next) => {
  try {
    const achievements = await achievementsService.getAllAchievements();
    const allCosmetics = await cosmeticsService.getAllCosmetics();
    const cosmeticMap = new Map(allCosmetics.map((c) => [c.id, c]));

    const rewardCosmeticIds = new Set<number>();
    for (const a of achievements) {
      if (a.rewardType === 'cosmetic' && a.rewardId) {
        rewardCosmeticIds.add(a.rewardId);
      }
    }

    const bundleCosmetics: AchievementBundleExportData['cosmetics'] = [];
    for (const cosId of rewardCosmeticIds) {
      const c = cosmeticMap.get(cosId);
      if (c) {
        bundleCosmetics.push({
          originalId: c.id,
          data: {
            name: c.name,
            type: c.type,
            config: c.config,
            rarity: c.rarity,
            unlockType: c.unlockType,
            unlockRequirement: c.unlockRequirement,
            sortOrder: c.sortOrder,
          },
        });
      }
    }

    const bundleAchievements: AchievementBundleExportData['achievements'] = achievements.map(
      (a) => {
        let reward: Omit<CosmeticExportData, '_format' | '_version'> | null = null;
        if (a.rewardType === 'cosmetic' && a.rewardId) {
          const c = cosmeticMap.get(a.rewardId);
          if (c) {
            reward = {
              name: c.name,
              type: c.type,
              config: c.config,
              rarity: c.rarity,
              unlockType: c.unlockType,
              unlockRequirement: c.unlockRequirement,
              sortOrder: c.sortOrder,
            };
          }
        }
        return {
          name: a.name,
          description: a.description,
          icon: a.icon,
          category: a.category,
          conditionType: a.conditionType,
          conditionConfig: a.conditionConfig,
          rewardType: a.rewardType,
          reward,
          sortOrder: a.sortOrder,
        };
      },
    );

    const exportData: AchievementBundleExportData = {
      _format: 'blast-arena-achievement-bundle',
      _version: 1,
      achievements: bundleAchievements,
      cosmetics: bundleCosmetics,
    };

    res.setHeader('Content-Disposition', 'attachment; filename="achievements-bundle.json"');
    res.json(exportData);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/achievements/import', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const {
      achievements: achData,
      cosmetics: cosData,
      cosmeticIdMap,
    } = req.body as {
      achievements: AchievementBundleExportData['achievements'];
      cosmetics?: AchievementBundleExportData['cosmetics'];
      cosmeticIdMap?: Record<string, 'create' | 'skip' | number>;
    };

    if (!achData || !Array.isArray(achData)) {
      res.status(400).json({ error: 'Invalid import data: achievements array required' });
      return;
    }

    // Phase 1: detect conflicts if no cosmeticIdMap provided
    if (!cosmeticIdMap) {
      const referencedCosmetics = cosData || [];
      const allExisting = await cosmeticsService.getAllCosmetics();
      const existingByName = new Map(allExisting.map((c) => [c.name.toLowerCase(), c]));

      const conflicts: AchievementImportConflict[] = [];
      for (const entry of referencedCosmetics) {
        const existing = existingByName.get(entry.data.name.toLowerCase());
        conflicts.push({
          originalCosmeticId: entry.originalId,
          cosmeticName: entry.data.name,
          existingId: existing?.id,
          existingName: existing?.name,
        });
      }

      if (conflicts.length > 0) {
        res.json({ conflicts });
        return;
      }
    }

    // Phase 2: import with resolved cosmetic mapping
    const idMap = new Map<number, number | null>(); // originalId -> new/existing ID or null (skip)

    if (cosmeticIdMap && cosData) {
      for (const entry of cosData) {
        const key = String(entry.originalId);
        const action = cosmeticIdMap[key];

        if (action === 'create') {
          const created = await cosmeticsService.createCosmetic({
            name: entry.data.name,
            type: entry.data.type,
            config: entry.data.config,
            rarity: entry.data.rarity,
            unlockType: entry.data.unlockType,
            unlockRequirement: entry.data.unlockRequirement,
            sortOrder: entry.data.sortOrder,
          });
          idMap.set(entry.originalId, created.id);
          await execute(
            'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
            [
              req.user!.userId,
              'cosmetic_import',
              'cosmetic',
              created.id,
              `Imported cosmetic: ${created.name}`,
            ],
          );
        } else if (action === 'skip') {
          idMap.set(entry.originalId, null);
        } else if (typeof action === 'number') {
          idMap.set(entry.originalId, action);
        }
      }
    }

    let created = 0;
    for (const achEntry of achData) {
      let rewardType = achEntry.rewardType;
      let rewardId: number | null = null;

      if (rewardType === 'cosmetic' && achEntry.reward) {
        // Try to find by name match in the idMap via cosmetics data
        const matchedCos = cosData?.find((c) => c.data.name === achEntry.reward?.name);
        if (matchedCos) {
          const mappedId = idMap.get(matchedCos.originalId);
          if (mappedId === null || mappedId === undefined) {
            rewardType = 'none';
          } else {
            rewardId = mappedId;
          }
        } else {
          // No cosmetic in bundle — try name match in DB
          const allExisting = await cosmeticsService.getAllCosmetics();
          const match = allExisting.find(
            (c) => c.name.toLowerCase() === achEntry.reward!.name.toLowerCase(),
          );
          if (match) {
            rewardId = match.id;
          } else {
            rewardType = 'none';
          }
        }
      }

      const achievement = await achievementsService.createAchievement({
        name: achEntry.name,
        description: achEntry.description,
        icon: achEntry.icon,
        category: achEntry.category,
        conditionType: achEntry.conditionType,
        conditionConfig: achEntry.conditionConfig,
        rewardType,
        rewardId,
        sortOrder: achEntry.sortOrder,
      });
      await execute(
        'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user!.userId,
          'achievement_import',
          'achievement',
          achievement.id,
          `Imported achievement: ${achievement.name}`,
        ],
      );
      created++;
    }

    res.json({ message: `Imported ${created} achievement(s)`, created });
  } catch (err) {
    next(err);
  }
});

// ===== Cosmetic Export/Import =====

router.get('/admin/cosmetics/:id/export', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const cosmetic = await cosmeticsService.getCosmeticById(id);
    if (!cosmetic) {
      res.status(404).json({ error: 'Cosmetic not found' });
      return;
    }

    const exportData: CosmeticExportData = {
      _format: 'blast-arena-cosmetic',
      _version: 1,
      name: cosmetic.name,
      type: cosmetic.type,
      config: cosmetic.config,
      rarity: cosmetic.rarity,
      unlockType: cosmetic.unlockType,
      unlockRequirement: cosmetic.unlockRequirement,
      sortOrder: cosmetic.sortOrder,
    };

    const filename = `cosmetic-${cosmetic.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(exportData);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/cosmetics/import', adminOnlyMiddleware, async (req, res, next) => {
  try {
    const data = req.body as CosmeticExportData;
    if (!data.name || !data.type || !data.config) {
      res.status(400).json({ error: 'Invalid cosmetic import data' });
      return;
    }

    const cosmetic = await cosmeticsService.createCosmetic({
      name: data.name,
      type: data.type,
      config: data.config,
      rarity: data.rarity || 'common',
      unlockType: data.unlockType || 'default',
      unlockRequirement: data.unlockRequirement || null,
      sortOrder: data.sortOrder || 0,
    });

    await execute(
      'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [
        req.user!.userId,
        'cosmetic_import',
        'cosmetic',
        cosmetic.id,
        `Imported cosmetic: ${cosmetic.name}`,
      ],
    );

    res.json(cosmetic);
  } catch (err) {
    next(err);
  }
});

export default router;

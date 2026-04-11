import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation';
import { authMiddleware } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import * as authService from '../services/auth';
import * as cosmeticsService from '../services/cosmetics';
import { isRegistrationEnabled } from '../services/settings';
import { getConfig } from '../config';
import { query } from '../db/connection';
import { UserRow } from '../db/types';
import {
  validateUsername,
  validatePassword,
  validateEmail,
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '@blast-arena/shared';

const router = Router();

const registerSchema = z.object({
  username: z.string().min(USERNAME_MIN_LENGTH).max(USERNAME_MAX_LENGTH),
  email: z.string().email().max(255),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

router.post(
  '/auth/register',
  rateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 3 }),
  validate(registerSchema),
  async (req, res, next) => {
    try {
      if (!(await isRegistrationEnabled())) {
        return res.status(403).json({ error: 'Registration is currently disabled' });
      }

      const { username, email, password } = req.body;

      const usernameError = validateUsername(username);
      if (usernameError) return res.status(400).json({ error: usernameError });

      const passwordError = validatePassword(password);
      if (passwordError) return res.status(400).json({ error: passwordError });

      const emailError = validateEmail(email);
      if (emailError) return res.status(400).json({ error: emailError });

      const result = await authService.register(username, email, password, req.locale || 'en');
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/auth/login',
  rateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 10 }),
  validate(loginSchema),
  async (req, res, next) => {
    try {
      const { username, password } = req.body;
      const result = await authService.login(username, password);

      if ('totpRequired' in result) {
        return res.json(result);
      }

      // Set refresh token as httpOnly cookie
      const config = getConfig();
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: config.APP_URL.startsWith('https'),
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/api/auth',
      });

      res.json(result.auth);
    } catch (err) {
      next(err);
    }
  },
);

const verifyTotpSchema = z.object({
  totpToken: z.string(),
  code: z.string().min(6).max(10),
});

router.post(
  '/auth/verify-totp',
  rateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 10 }),
  validate(verifyTotpSchema),
  async (req, res, next) => {
    try {
      const { totpToken, code } = req.body;
      const { auth, refreshToken } = await authService.completeTotpLogin(totpToken, code);

      const config = getConfig();
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: config.APP_URL.startsWith('https'),
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/auth',
      });

      res.json(auth);
    } catch (err) {
      next(err);
    }
  },
);

router.post('/auth/logout', authMiddleware, async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
      await authService.logout(refreshToken);
    }

    res.clearCookie('refreshToken', { path: '/api/auth' });
    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token', code: 'NO_REFRESH_TOKEN' });
    }

    const { auth, refreshToken: newRefreshToken } =
      await authService.refreshAccessToken(refreshToken);

    const config = getConfig();
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: config.APP_URL.startsWith('https'),
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth',
    });

    res.json(auth);
  } catch (err) {
    next(err);
  }
});

router.get(
  '/auth/verify-email/:token',
  rateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 10 }),
  async (req, res, next) => {
    try {
      await authService.verifyEmail(req.params.token);
      const config = getConfig();
      res.redirect(`${config.APP_URL}?emailVerified=true`);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/auth/resend-verification',
  rateLimiter({ windowMs: 120_000, maxRequests: 1 }),
  authMiddleware,
  async (req, res, next) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Email is required' });
      }
      const { remainingResends } = await authService.resendVerificationEmail(
        req.user!.userId,
        email,
      );
      res.json({
        message: 'If the email matches, a new verification link has been sent',
        remainingResends,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/auth/forgot-password',
  rateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 3 }),
  validate(forgotPasswordSchema),
  async (req, res, next) => {
    try {
      await authService.forgotPassword(req.body.email);
      res.json({ message: 'If the email exists, a reset link has been sent' });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/auth/reset-password',
  rateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 5 }),
  validate(resetPasswordSchema),
  async (req, res, next) => {
    try {
      await authService.resetPassword(req.body.token, req.body.password);
      res.json({ message: 'Password reset successfully' });
    } catch (err) {
      next(err);
    }
  },
);

// --- Local Co-Op P2 Auth (isolated cookie) ---

const VALID_DURATIONS = [0, 1, 6, 12, 24];
const LOCAL_COOP_COOKIE = 'localCoopP2';
const LOCAL_COOP_COOKIE_PATH = '/api/local-coop';

const localCoopLoginSchema = z.object({
  username: z.string().min(1).max(USERNAME_MAX_LENGTH),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  duration: z.number().refine((v) => VALID_DURATIONS.includes(v), {
    message: 'Duration must be 0, 1, 6, 12, or 24 hours',
  }),
});

router.post(
  '/local-coop/login',
  rateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 10 }),
  authMiddleware,
  validate(localCoopLoginSchema),
  async (req, res, next) => {
    try {
      const { username, password, duration } = req.body;
      const p2User = await authService.verifyCredentials(username, password);

      if (p2User.id === req.user!.userId) {
        return res.status(400).json({ error: 'Cannot log in as yourself' });
      }

      const token = authService.generateLocalCoopToken(p2User.id, p2User.username, duration);
      const config = getConfig();

      const cookieOptions: {
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'strict';
        path: string;
        maxAge?: number;
      } = {
        httpOnly: true,
        secure: config.APP_URL.startsWith('https'),
        sameSite: 'strict',
        path: LOCAL_COOP_COOKIE_PATH,
      };

      if (duration > 0) {
        cookieOptions.maxAge = duration * 60 * 60 * 1000;
      }

      res.cookie(LOCAL_COOP_COOKIE, token, cookieOptions);

      const cosmeticsMap = await cosmeticsService.getPlayerCosmeticsForGame([p2User.id]);
      const cosmetics = cosmeticsMap.get(p2User.id) || {};

      res.json({ user: { id: p2User.id, username: p2User.username }, cosmetics });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/local-coop/session', async (req, res, next) => {
  try {
    const token = req.cookies?.[LOCAL_COOP_COOKIE];
    if (!token) {
      return res.status(401).json({ error: 'No session' });
    }

    const decoded = authService.verifyLocalCoopToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const rows = await query<UserRow[]>(
      'SELECT id, username, is_deactivated FROM users WHERE id = ?',
      [decoded.userId],
    );

    if (rows.length === 0 || rows[0].is_deactivated) {
      res.clearCookie(LOCAL_COOP_COOKIE, { path: LOCAL_COOP_COOKIE_PATH });
      return res.status(401).json({ error: 'User not found or deactivated' });
    }

    const cosmeticsMap = await cosmeticsService.getPlayerCosmeticsForGame([decoded.userId]);
    const cosmetics = cosmeticsMap.get(decoded.userId) || {};

    res.json({ user: { id: rows[0].id, username: rows[0].username }, cosmetics });
  } catch (err) {
    next(err);
  }
});

router.get('/local-coop/socket-token', authMiddleware, async (req, res, next) => {
  try {
    const cookieToken = req.cookies?.[LOCAL_COOP_COOKIE];
    if (!cookieToken) {
      return res.status(401).json({ error: 'No local co-op session' });
    }
    const decoded = authService.verifyLocalCoopToken(cookieToken);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    const socketToken = authService.generateLocalCoopSocketToken(decoded.userId, decoded.username);
    res.json({ token: socketToken });
  } catch (err) {
    next(err);
  }
});

router.post('/local-coop/logout', (_req, res) => {
  res.clearCookie(LOCAL_COOP_COOKIE, { path: LOCAL_COOP_COOKIE_PATH });
  res.json({ message: 'Logged out' });
});

export default router;

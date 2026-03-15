import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation';
import { authMiddleware } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import * as authService from '../services/auth';
import { getConfig } from '../config';
import {
  validateUsername, validatePassword, validateEmail,
  USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH,
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

router.post('/auth/register',
  rateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 3 }),
  validate(registerSchema),
  async (req, res, next) => {
    try {
      const { username, email, password } = req.body;

      const usernameError = validateUsername(username);
      if (usernameError) return res.status(400).json({ error: usernameError });

      const passwordError = validatePassword(password);
      if (passwordError) return res.status(400).json({ error: passwordError });

      const emailError = validateEmail(email);
      if (emailError) return res.status(400).json({ error: emailError });

      const result = await authService.register(username, email, password);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.post('/auth/login',
  rateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 10 }),
  validate(loginSchema),
  async (req, res, next) => {
    try {
      const { username, password } = req.body;
      const { auth, refreshToken } = await authService.login(username, password);

      // Set refresh token as httpOnly cookie
      const config = getConfig();
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: config.APP_URL.startsWith('https'),
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/api/auth',
      });

      res.json(auth);
    } catch (err) {
      next(err);
    }
  }
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

    const { auth, refreshToken: newRefreshToken } = await authService.refreshAccessToken(refreshToken);

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

router.get('/auth/verify-email/:token', async (req, res, next) => {
  try {
    await authService.verifyEmail(req.params.token);
    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/forgot-password',
  rateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 3 }),
  validate(forgotPasswordSchema),
  async (req, res, next) => {
    try {
      await authService.forgotPassword(req.body.email);
      res.json({ message: 'If the email exists, a reset link has been sent' });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/auth/reset-password',
  validate(resetPasswordSchema),
  async (req, res, next) => {
    try {
      await authService.resetPassword(req.body.token, req.body.password);
      res.json({ message: 'Password reset successfully' });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

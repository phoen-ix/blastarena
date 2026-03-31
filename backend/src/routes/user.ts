import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import * as userService from '../services/user';
import * as buddyService from '../services/buddy';
import {
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  validateUsername,
  validateEmail as validateEmailFn,
  validatePassword,
} from '@blast-arena/shared';

const router = Router();

const updateProfileSchema = z.object({
  username: z.string().min(USERNAME_MIN_LENGTH).max(USERNAME_MAX_LENGTH).optional(),
});

const changeEmailSchema = z.object({
  email: z.string().email().max(255),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

router.get('/user/profile', authMiddleware, async (req, res, next) => {
  try {
    const profile = await userService.getUserProfile(req.user!.userId);
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

router.put(
  '/user/profile',
  authMiddleware,
  validate(updateProfileSchema),
  async (req, res, next) => {
    try {
      const { username } = req.body;

      if (username !== undefined) {
        const usernameError = validateUsername(username);
        if (usernameError) return res.status(400).json({ error: usernameError });
        await userService.updateUsername(req.user!.userId, username);
      }

      // Return updated profile
      const profile = await userService.getUserProfile(req.user!.userId);
      res.json(profile);
    } catch (err) {
      next(err);
    }
  },
);

router.post('/user/email', authMiddleware, validate(changeEmailSchema), async (req, res, next) => {
  try {
    const emailError = validateEmailFn(req.body.email);
    if (emailError) return res.status(400).json({ error: emailError });

    if (req.user!.role === 'admin') {
      await userService.updateEmailDirect(req.user!.userId, req.body.email);
      res.json({ message: 'Email address updated.' });
    } else {
      await userService.requestEmailChange(req.user!.userId, req.body.email, req.locale || 'en');
      res.json({
        message: 'Confirmation email sent to your new address. The link expires in 24 hours.',
      });
    }
  } catch (err) {
    next(err);
  }
});

router.post(
  '/user/password',
  authMiddleware,
  validate(changePasswordSchema),
  async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body;

      const passwordError = validatePassword(newPassword);
      if (passwordError) return res.status(400).json({ error: passwordError });

      if (currentPassword === newPassword) {
        return res
          .status(400)
          .json({ error: 'New password must be different from current password' });
      }

      await userService.changePassword(req.user!.userId, currentPassword, newPassword);
      res.json({ message: 'Password updated successfully' });
    } catch (err) {
      next(err);
    }
  },
);

router.delete('/user/email', authMiddleware, async (req, res, next) => {
  try {
    await userService.cancelEmailChange(req.user!.userId);
    res.json({ message: 'Pending email change cancelled' });
  } catch (err) {
    next(err);
  }
});

const privacySchema = z.object({
  isProfilePublic: z.boolean().optional(),
  acceptFriendRequests: z.boolean().optional(),
});

router.put('/user/privacy', authMiddleware, validate(privacySchema), async (req, res, next) => {
  try {
    await userService.updatePrivacySettings(req.user!.userId, req.body);
    const profile = await userService.getUserProfile(req.user!.userId);
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// --- Language Preference ---

const SUPPORTED_LANGUAGES = [
  'en',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'pl',
  'nl',
  'tr',
  'sv',
  'nb',
  'da',
] as const;

const languageSchema = z.object({
  language: z.enum(SUPPORTED_LANGUAGES),
});

router.put('/user/language', authMiddleware, validate(languageSchema), async (req, res, next) => {
  try {
    await userService.updateLanguage(req.user!.userId, req.body.language);
    res.json({ language: req.body.language });
  } catch (err) {
    next(err);
  }
});

// --- Buddy Settings ---

router.get('/user/buddy-settings', authMiddleware, async (req, res, next) => {
  try {
    const settings = await buddyService.getBuddySettings(req.user!.userId);
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

const buddySettingsSchema = z.object({
  name: z.string().min(1).max(20).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  size: z.number().min(0.4).max(0.8).optional(),
});

router.put(
  '/user/buddy-settings',
  authMiddleware,
  validate(buddySettingsSchema),
  async (req, res, next) => {
    try {
      await buddyService.saveBuddySettings(req.user!.userId, req.body);
      const settings = await buddyService.getBuddySettings(req.user!.userId);
      res.json(settings);
    } catch (err) {
      next(err);
    }
  },
);

const deleteAccountSchema = z.object({
  password: z.string().min(1),
});

router.delete(
  '/user/account',
  authMiddleware,
  validate(deleteAccountSchema),
  async (req, res, next) => {
    try {
      await userService.deleteAccount(req.user!.userId, req.body.password);
      // Clear refresh token cookie
      res.clearCookie('refreshToken', { path: '/api/auth' });
      res.json({ message: 'Account deleted successfully' });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/user/confirm-email/:token', async (req, res, next) => {
  try {
    await userService.confirmEmailChange(req.params.token);
    res.json({ message: 'Email address updated successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;

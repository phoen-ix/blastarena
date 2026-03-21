import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import * as userService from '../services/user';
import {
  USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH,
  validateUsername, validateEmail as validateEmailFn,
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

router.put('/user/profile', authMiddleware, validate(updateProfileSchema), async (req, res, next) => {
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
});

router.post('/user/email', authMiddleware, validate(changeEmailSchema), async (req, res, next) => {
  try {
    const emailError = validateEmailFn(req.body.email);
    if (emailError) return res.status(400).json({ error: emailError });

    if (req.user!.role === 'admin') {
      await userService.updateEmailDirect(req.user!.userId, req.body.email);
      res.json({ message: 'Email address updated.' });
    } else {
      await userService.requestEmailChange(req.user!.userId, req.body.email);
      res.json({ message: 'Confirmation email sent to your new address. The link expires in 24 hours.' });
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
        return res.status(400).json({ error: 'New password must be different from current password' });
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

router.get('/user/confirm-email/:token', async (req, res, next) => {
  try {
    await userService.confirmEmailChange(req.params.token);
    res.json({ message: 'Email address updated successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;

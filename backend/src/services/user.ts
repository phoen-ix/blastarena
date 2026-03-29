import { query, execute, withTransaction } from '../db/connection';
import { AppError } from '../middleware/errorHandler';
import {
  comparePassword,
  hashPassword,
  generateToken,
  hashToken,
  hashEmail,
  generateEmailHint,
} from '../utils/crypto';
import { getConfig } from '../config';
import { sendEmailChangeEmail, sendEmailTakenChangeWarning } from './email';
import { logger } from '../utils/logger';
import { UserRow, UserProfileRow, UserEmailChangeRow, IdRow } from '../db/types';

export async function getUserProfile(userId: number) {
  const rows = await query<UserProfileRow[]>(
    `SELECT u.id, u.username, u.email_hint, u.role, u.email_verified,
            u.pending_email_hint, u.created_at,
            s.total_matches, s.total_wins, s.total_kills, s.total_deaths,
            s.total_bombs, s.total_powerups, s.total_playtime,
            s.win_streak, s.best_win_streak, s.elo_rating, s.peak_elo,
            s.total_xp, s.level,
            u.is_profile_public, u.accept_friend_requests
     FROM users u
     LEFT JOIN user_stats s ON s.user_id = u.id
     WHERE u.id = ?`,
    [userId],
  );

  if (rows.length === 0) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }

  const row = rows[0];
  return {
    id: row.id,
    username: row.username,
    emailHint: row.email_hint,
    role: row.role,
    emailVerified: row.email_verified,
    pendingEmailHint: row.pending_email_hint || null,
    createdAt: row.created_at,
    stats: {
      totalMatches: row.total_matches || 0,
      totalWins: row.total_wins || 0,
      totalKills: row.total_kills || 0,
      totalDeaths: row.total_deaths || 0,
      totalBombs: row.total_bombs || 0,
      totalPowerups: row.total_powerups || 0,
      totalPlaytime: row.total_playtime || 0,
      winStreak: row.win_streak || 0,
      bestWinStreak: row.best_win_streak || 0,
      eloRating: row.elo_rating || 1000,
      peakElo: row.peak_elo || 1000,
      totalXp: row.total_xp || 0,
      level: row.level || 1,
    },
    isProfilePublic: row.is_profile_public ?? true,
    acceptFriendRequests: row.accept_friend_requests ?? true,
  };
}

export async function updateUsername(userId: number, newUsername: string): Promise<void> {
  // Check if username is already taken by another user
  const existing = await query<IdRow[]>('SELECT id FROM users WHERE username = ? AND id != ?', [
    newUsername,
    userId,
  ]);
  if (existing.length > 0) {
    throw new AppError('Username is already taken', 409, 'CONFLICT');
  }

  await execute('UPDATE users SET username = ? WHERE id = ?', [newUsername, userId]);
}

export async function updateEmailDirect(userId: number, newEmail: string): Promise<void> {
  const config = getConfig();
  const normalizedEmail = newEmail.toLowerCase();
  const emailHash = hashEmail(normalizedEmail, config.EMAIL_PEPPER);
  const emailHint = generateEmailHint(normalizedEmail);

  const existing = await query<IdRow[]>('SELECT id FROM users WHERE email_hash = ? AND id != ?', [
    emailHash,
    userId,
  ]);
  if (existing.length > 0) {
    throw new AppError('Email is already in use', 409, 'CONFLICT');
  }

  await execute(
    'UPDATE users SET email_hash = ?, email_hint = ?, email_verified = TRUE, pending_email_hash = NULL, pending_email_hint = NULL, email_change_token = NULL, email_change_expires = NULL WHERE id = ?',
    [emailHash, emailHint, userId],
  );
}

export async function requestEmailChange(userId: number, newEmail: string): Promise<void> {
  const config = getConfig();
  const normalizedEmail = newEmail.toLowerCase();
  const emailHash = hashEmail(normalizedEmail, config.EMAIL_PEPPER);
  const emailHint = generateEmailHint(normalizedEmail);

  // Check if the new email is already used by another user — never reveal existence
  const existing = await query<IdRow[]>('SELECT id FROM users WHERE email_hash = ? AND id != ?', [
    emailHash,
    userId,
  ]);
  if (existing.length > 0) {
    sendEmailTakenChangeWarning(normalizedEmail).catch((err) => {
      logger.error({ err }, 'Failed to send email-taken change warning');
    });
    return; // Silently succeed — don't update pending fields, don't reveal conflict
  }

  // Also check if another user has this as a pending email
  const pendingExisting = await query<IdRow[]>(
    'SELECT id FROM users WHERE pending_email_hash = ? AND id != ?',
    [emailHash, userId],
  );
  if (pendingExisting.length > 0) {
    sendEmailTakenChangeWarning(normalizedEmail).catch((err) => {
      logger.error({ err }, 'Failed to send email-taken change warning');
    });
    return; // Silently succeed
  }

  const token = generateToken();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await execute(
    'UPDATE users SET pending_email_hash = ?, pending_email_hint = ?, email_change_token = ?, email_change_expires = ? WHERE id = ?',
    [emailHash, emailHint, hashToken(token), expires, userId],
  );

  // Send confirmation to the NEW email address
  sendEmailChangeEmail(normalizedEmail, token).catch((err) => {
    logger.error({ err }, 'Failed to send email change confirmation');
  });
}

export async function confirmEmailChange(token: string): Promise<void> {
  const tokenHash = hashToken(token);

  await withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      'SELECT id, pending_email_hash, pending_email_hint, email_change_expires FROM users WHERE email_change_token = ? FOR UPDATE',
      [tokenHash],
    );

    const userRows = rows as UserEmailChangeRow[];
    if (userRows.length === 0) {
      throw new AppError('Invalid confirmation token', 400, 'INVALID_TOKEN');
    }

    const row = userRows[0];

    if (new Date(row.email_change_expires) < new Date()) {
      await conn.execute(
        'UPDATE users SET pending_email_hash = NULL, pending_email_hint = NULL, email_change_token = NULL, email_change_expires = NULL WHERE id = ?',
        [row.id],
      );
      throw new AppError('Confirmation link has expired', 400, 'TOKEN_EXPIRED');
    }

    // Uniqueness check within transaction — FOR UPDATE prevents concurrent claims
    const [conflict] = await conn.execute(
      'SELECT id FROM users WHERE email_hash = ? AND id != ? FOR UPDATE',
      [row.pending_email_hash, row.id],
    );
    if ((conflict as IdRow[]).length > 0) {
      await conn.execute(
        'UPDATE users SET pending_email_hash = NULL, pending_email_hint = NULL, email_change_token = NULL, email_change_expires = NULL WHERE id = ?',
        [row.id],
      );
      throw new AppError('Email is already in use by another account', 409, 'CONFLICT');
    }

    await conn.execute(
      'UPDATE users SET email_hash = ?, email_hint = ?, email_verified = TRUE, pending_email_hash = NULL, pending_email_hint = NULL, email_change_token = NULL, email_change_expires = NULL WHERE id = ?',
      [row.pending_email_hash, row.pending_email_hint, row.id],
    );
  });
}

export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const rows = await query<UserRow[]>('SELECT password_hash FROM users WHERE id = ?', [userId]);

  if (rows.length === 0) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }

  const valid = await comparePassword(currentPassword, rows[0].password_hash);
  if (!valid) {
    throw new AppError('Current password is incorrect', 401, 'INVALID_PASSWORD');
  }

  const newHash = await hashPassword(newPassword);
  await execute('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);
}

export async function cancelEmailChange(userId: number): Promise<void> {
  await execute(
    'UPDATE users SET pending_email_hash = NULL, pending_email_hint = NULL, email_change_token = NULL, email_change_expires = NULL WHERE id = ?',
    [userId],
  );
}

export async function updatePrivacySettings(
  userId: number,
  settings: { isProfilePublic?: boolean; acceptFriendRequests?: boolean },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (settings.isProfilePublic !== undefined) {
    sets.push('is_profile_public = ?');
    params.push(settings.isProfilePublic);
  }
  if (settings.acceptFriendRequests !== undefined) {
    sets.push('accept_friend_requests = ?');
    params.push(settings.acceptFriendRequests);
  }

  if (sets.length === 0) return;
  params.push(userId);
  await execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function updateLanguage(userId: number, language: string): Promise<void> {
  await execute('UPDATE users SET language = ? WHERE id = ?', [language, userId]);
}

export async function deleteAccount(userId: number, password: string): Promise<void> {
  const rows = await query<UserRow[]>('SELECT password_hash, role FROM users WHERE id = ?', [
    userId,
  ]);
  if (rows.length === 0) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }

  if (rows[0].role === 'admin') {
    throw new AppError('Admin accounts cannot be self-deleted', 403, 'FORBIDDEN');
  }

  const valid = await comparePassword(password, rows[0].password_hash);
  if (!valid) {
    throw new AppError('Password is incorrect', 401, 'INVALID_PASSWORD');
  }

  // Hard delete — FK cascades handle all related data
  await execute('DELETE FROM users WHERE id = ?', [userId]);
  logger.info(`User ${userId} deleted their own account`);
}

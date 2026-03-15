import { query, execute } from '../db/connection';
import { AppError } from '../middleware/errorHandler';
import { generateToken, hashToken } from '../utils/crypto';
import { sendEmailChangeEmail } from './email';
import { logger } from '../utils/logger';
import { UserProfileRow, UserEmailChangeRow, IdRow } from '../db/types';

export async function getUserProfile(userId: number) {
  const rows = await query<UserProfileRow[]>(
    `SELECT u.id, u.username, u.email, u.role, u.email_verified,
            u.pending_email, u.created_at,
            s.total_matches, s.total_wins, s.total_kills, s.total_deaths,
            s.total_bombs, s.total_powerups, s.total_playtime,
            s.win_streak, s.best_win_streak, s.elo_rating
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
    email: row.email,
    role: row.role,
    emailVerified: row.email_verified,
    pendingEmail: row.pending_email || null,
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
    },
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
  const existing = await query<IdRow[]>('SELECT id FROM users WHERE email = ? AND id != ?', [
    newEmail,
    userId,
  ]);
  if (existing.length > 0) {
    throw new AppError('Email is already in use', 409, 'CONFLICT');
  }

  await execute(
    'UPDATE users SET email = ?, email_verified = TRUE, pending_email = NULL, email_change_token = NULL, email_change_expires = NULL WHERE id = ?',
    [newEmail, userId],
  );
}

export async function requestEmailChange(userId: number, newEmail: string): Promise<void> {
  // Check if the new email is already used by another user
  const existing = await query<IdRow[]>('SELECT id FROM users WHERE email = ? AND id != ?', [
    newEmail,
    userId,
  ]);
  if (existing.length > 0) {
    throw new AppError('Email is already in use', 409, 'CONFLICT');
  }

  // Also check if another user has this as a pending email (optional but prevents race)
  const pendingExisting = await query<IdRow[]>(
    'SELECT id FROM users WHERE pending_email = ? AND id != ?',
    [newEmail, userId],
  );
  if (pendingExisting.length > 0) {
    throw new AppError('Email is already in use', 409, 'CONFLICT');
  }

  const token = generateToken();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await execute(
    'UPDATE users SET pending_email = ?, email_change_token = ?, email_change_expires = ? WHERE id = ?',
    [newEmail, hashToken(token), expires, userId],
  );

  // Send confirmation to the NEW email address
  sendEmailChangeEmail(newEmail, token).catch((err) => {
    logger.error({ err }, 'Failed to send email change confirmation');
  });
}

export async function confirmEmailChange(token: string): Promise<void> {
  const tokenHash = hashToken(token);

  const rows = await query<UserEmailChangeRow[]>(
    'SELECT id, pending_email, email_change_expires FROM users WHERE email_change_token = ?',
    [tokenHash],
  );

  if (rows.length === 0) {
    throw new AppError('Invalid confirmation token', 400, 'INVALID_TOKEN');
  }

  const row = rows[0];

  if (new Date(row.email_change_expires) < new Date()) {
    // Token expired — clean up pending fields
    await execute(
      'UPDATE users SET pending_email = NULL, email_change_token = NULL, email_change_expires = NULL WHERE id = ?',
      [row.id],
    );
    throw new AppError('Confirmation link has expired', 400, 'TOKEN_EXPIRED');
  }

  // Final uniqueness check at confirmation time (race condition guard)
  const conflict = await query<IdRow[]>('SELECT id FROM users WHERE email = ? AND id != ?', [
    row.pending_email,
    row.id,
  ]);
  if (conflict.length > 0) {
    await execute(
      'UPDATE users SET pending_email = NULL, email_change_token = NULL, email_change_expires = NULL WHERE id = ?',
      [row.id],
    );
    throw new AppError('Email is already in use by another account', 409, 'CONFLICT');
  }

  await execute(
    'UPDATE users SET email = ?, email_verified = TRUE, pending_email = NULL, email_change_token = NULL, email_change_expires = NULL WHERE id = ?',
    [row.pending_email, row.id],
  );
}

export async function cancelEmailChange(userId: number): Promise<void> {
  await execute(
    'UPDATE users SET pending_email = NULL, email_change_token = NULL, email_change_expires = NULL WHERE id = ?',
    [userId],
  );
}

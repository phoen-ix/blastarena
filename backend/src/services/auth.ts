import jwt from 'jsonwebtoken';
import { getConfig } from '../config';
import { query, execute } from '../db/connection';
import { getRedis } from '../db/redis';
import { hashPassword, comparePassword, generateToken, hashToken } from '../utils/crypto';
import { sendVerificationEmail, sendPasswordResetEmail } from './email';
import { AppError } from '../middleware/errorHandler';
import { AuthPayload, PublicUser, AuthResponse } from '@blast-arena/shared';
import { logger } from '../utils/logger';

function toPublicUser(row: any): PublicUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
  };
}

function generateAccessToken(payload: AuthPayload): string {
  const config = getConfig();
  return jwt.sign({ ...payload }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN } as jwt.SignOptions);
}

function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days
  const value = parseInt(match[1]);
  const unit = match[2];
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}

export async function register(
  username: string,
  email: string,
  password: string
): Promise<AuthResponse> {
  // Check existing user
  const existing = await query('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
  if (existing.length > 0) {
    throw new AppError('Username or email already taken', 409, 'CONFLICT');
  }

  const passwordHash = await hashPassword(password);
  const verifyToken = generateToken();

  const result = await execute(
    `INSERT INTO users (username, email, password_hash, email_verify_token) VALUES (?, ?, ?, ?)`,
    [username, email, passwordHash, hashToken(verifyToken)]
  );

  // Create user_stats row
  await execute('INSERT INTO user_stats (user_id) VALUES (?)', [result.insertId]);

  // Send verification email (non-blocking)
  sendVerificationEmail(email, verifyToken).catch(err => {
    logger.error({ err }, 'Failed to send verification email');
  });

  const user: PublicUser = { id: result.insertId, username, role: 'user' };
  const accessToken = generateAccessToken({ userId: user.id, username, role: 'user' });

  return { user, accessToken };
}

export async function login(username: string, password: string): Promise<{ auth: AuthResponse; refreshToken: string }> {
  const rows = await query(
    'SELECT id, username, email, password_hash, role, is_deactivated, email_verified FROM users WHERE username = ?',
    [username]
  );

  if (rows.length === 0) {
    throw new AppError('Invalid username or password', 401, 'INVALID_CREDENTIALS');
  }

  const user = rows[0] as any;

  if (user.is_deactivated) {
    throw new AppError('Account has been deactivated', 403, 'DEACTIVATED');
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    throw new AppError('Invalid username or password', 401, 'INVALID_CREDENTIALS');
  }

  // Update last login
  await execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

  const publicUser = toPublicUser(user);
  const accessToken = generateAccessToken({ userId: user.id, username: user.username, role: user.role });

  // Create refresh token
  const refreshToken = generateToken();
  const refreshHash = hashToken(refreshToken);
  const config = getConfig();
  const expiresMs = parseExpiresIn(config.JWT_REFRESH_EXPIRES_IN);
  const expiresAt = new Date(Date.now() + expiresMs);

  await execute(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [user.id, refreshHash, expiresAt]
  );

  return { auth: { user: publicUser, accessToken }, refreshToken };
}

export async function refreshAccessToken(refreshTokenValue: string): Promise<{ auth: AuthResponse; refreshToken: string }> {
  const tokenHash = hashToken(refreshTokenValue);

  const rows = await query(
    `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked,
            u.username, u.role, u.is_deactivated
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = ?`,
    [tokenHash]
  );

  if (rows.length === 0) {
    throw new AppError('Invalid refresh token', 401, 'INVALID_TOKEN');
  }

  const row = rows[0] as any;

  if (row.revoked) {
    // Potential token reuse - revoke all tokens for this user
    await execute('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = ?', [row.user_id]);
    throw new AppError('Token reuse detected', 401, 'TOKEN_REUSE');
  }

  if (new Date(row.expires_at) < new Date()) {
    throw new AppError('Refresh token expired', 401, 'TOKEN_EXPIRED');
  }

  if (row.is_deactivated) {
    throw new AppError('Account has been deactivated', 403, 'DEACTIVATED');
  }

  // Revoke old token
  await execute('UPDATE refresh_tokens SET revoked = TRUE WHERE id = ?', [row.id]);

  // Issue new refresh token (rotation)
  const newRefreshToken = generateToken();
  const newHash = hashToken(newRefreshToken);
  const config = getConfig();
  const expiresMs = parseExpiresIn(config.JWT_REFRESH_EXPIRES_IN);
  const expiresAt = new Date(Date.now() + expiresMs);

  await execute(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [row.user_id, newHash, expiresAt]
  );

  const publicUser: PublicUser = { id: row.user_id, username: row.username, role: row.role };
  const accessToken = generateAccessToken({ userId: row.user_id, username: row.username, role: row.role });

  return { auth: { user: publicUser, accessToken }, refreshToken: newRefreshToken };
}

export async function logout(refreshTokenValue: string): Promise<void> {
  const tokenHash = hashToken(refreshTokenValue);
  await execute('UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = ?', [tokenHash]);
}

export async function verifyEmail(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  const result = await execute(
    'UPDATE users SET email_verified = TRUE, email_verify_token = NULL WHERE email_verify_token = ?',
    [tokenHash]
  );
  if (result.affectedRows === 0) {
    throw new AppError('Invalid verification token', 400, 'INVALID_TOKEN');
  }
}

export async function forgotPassword(email: string): Promise<void> {
  const rows = await query('SELECT id FROM users WHERE email = ?', [email]);
  if (rows.length === 0) {
    // Don't reveal whether email exists
    return;
  }

  const resetToken = generateToken();
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await execute(
    'UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE email = ?',
    [hashToken(resetToken), expires, email]
  );

  await sendPasswordResetEmail(email, resetToken);
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const tokenHash = hashToken(token);
  const rows = await query(
    'SELECT id FROM users WHERE password_reset_token = ? AND password_reset_expires > NOW()',
    [tokenHash]
  );

  if (rows.length === 0) {
    throw new AppError('Invalid or expired reset token', 400, 'INVALID_TOKEN');
  }

  const passwordHash = await hashPassword(newPassword);
  await execute(
    'UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?',
    [passwordHash, (rows[0] as any).id]
  );

  // Revoke all refresh tokens for security
  await execute('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = ?', [(rows[0] as any).id]);
}

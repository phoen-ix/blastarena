import jwt from 'jsonwebtoken';
import { getConfig } from '../config';
import { query, execute } from '../db/connection';
import {
  hashPassword,
  comparePassword,
  generateToken,
  hashToken,
  hashEmail,
  generateEmailHint,
} from '../utils/crypto';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendEmailTakenRegistrationWarning,
} from './email';
import { AppError } from '../middleware/errorHandler';
import {
  AuthPayload,
  PublicUser,
  AuthResponse,
  UserRole,
  TotpChallengeResponse,
} from '@blast-arena/shared';
import * as totpService from './totp';
import { logger } from '../utils/logger';
import { UserRow, RefreshTokenJoinRow, IdRow, IdWithLanguageRow } from '../db/types';
import * as cosmeticsService from './cosmetics';

function toPublicUser(row: UserRow | RefreshTokenJoinRow): PublicUser {
  return {
    id: 'user_id' in row ? row.user_id : row.id,
    username: row.username,
    role: row.role as UserRole,
    language: 'language' in row ? (row.language as string) : 'en',
    emailVerified: !!row.email_verified,
    twoFactorEnabled: !!row.totp_enabled,
  };
}

function generateAccessToken(payload: AuthPayload): string {
  const config = getConfig();
  return jwt.sign({ ...payload }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function generateLocalCoopToken(
  userId: number,
  username: string,
  durationHours: number,
): string {
  const config = getConfig();
  const expiresIn = durationHours > 0 ? `${durationHours}h` : '24h';
  return jwt.sign({ userId, username, purpose: 'local-coop-p2' }, config.JWT_SECRET, {
    expiresIn,
  } as jwt.SignOptions);
}

export function verifyLocalCoopToken(token: string): { userId: number; username: string } | null {
  try {
    const config = getConfig();
    const decoded = jwt.verify(token, config.JWT_SECRET) as {
      userId: number;
      username: string;
      purpose?: string;
    };
    if (decoded.purpose !== 'local-coop-p2') return null;
    return { userId: decoded.userId, username: decoded.username };
  } catch {
    return null;
  }
}

export function generateLocalCoopSocketToken(userId: number, username: string): string {
  const config = getConfig();
  return jwt.sign({ userId, username, purpose: 'local-coop-socket' }, config.JWT_SECRET, {
    expiresIn: '5m',
  } as jwt.SignOptions);
}

export function verifyLocalCoopSocketToken(
  token: string,
): { userId: number; username: string } | null {
  try {
    const config = getConfig();
    const decoded = jwt.verify(token, config.JWT_SECRET) as {
      userId: number;
      username: string;
      purpose?: string;
    };
    if (decoded.purpose !== 'local-coop-socket') return null;
    return { userId: decoded.userId, username: decoded.username };
  } catch {
    return null;
  }
}

function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days
  const value = parseInt(match[1]);
  const unit = match[2];
  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return 7 * 24 * 60 * 60 * 1000;
  }
}

export async function register(
  username: string,
  email: string,
  password: string,
  language = 'en',
): Promise<AuthResponse> {
  const config = getConfig();
  const normalizedEmail = email.toLowerCase();
  const emailHash = hashEmail(normalizedEmail, config.EMAIL_PEPPER);
  const emailHint = generateEmailHint(normalizedEmail);

  // Check username (public info — safe to reveal)
  const usernameExists = await query<IdRow[]>('SELECT id FROM users WHERE username = ?', [
    username,
  ]);
  if (usernameExists.length > 0) {
    throw new AppError('Username already taken', 409, 'CONFLICT');
  }

  // Check email — never reveal existence
  const emailExists = await query<IdWithLanguageRow[]>(
    'SELECT id, language FROM users WHERE email_hash = ?',
    [emailHash],
  );
  if (emailExists.length > 0) {
    sendEmailTakenRegistrationWarning(normalizedEmail, emailExists[0].language || 'en').catch(
      (err) => {
        logger.error({ err }, 'Failed to send email-taken registration warning');
      },
    );
    throw new AppError('Registration could not be completed', 400, 'REGISTRATION_FAILED');
  }

  const passwordHash = await hashPassword(password);
  const verifyToken = generateToken();

  const result = await execute(
    `INSERT INTO users (username, email_hash, email_hint, password_hash, email_verify_token, language) VALUES (?, ?, ?, ?, ?, ?)`,
    [username, emailHash, emailHint, passwordHash, hashToken(verifyToken), language],
  );

  // Create user_stats row
  await execute('INSERT INTO user_stats (user_id) VALUES (?)', [result.insertId]);

  // Grant default cosmetics (non-blocking)
  cosmeticsService.unlockDefaultCosmetics(result.insertId).catch((err) => {
    logger.error({ err }, 'Failed to unlock default cosmetics');
  });

  // Send verification email (non-blocking)
  sendVerificationEmail(normalizedEmail, verifyToken, language).catch((err) => {
    logger.error({ err }, 'Failed to send verification email');
  });

  const user: PublicUser = {
    id: result.insertId,
    username,
    role: 'user',
    language,
    emailVerified: false,
    twoFactorEnabled: false,
  };
  const accessToken = generateAccessToken({ userId: user.id, username, role: 'user' });

  return { user, accessToken };
}

export async function verifyCredentials(username: string, password: string): Promise<PublicUser> {
  const rows = await query<UserRow[]>(
    'SELECT id, username, password_hash, role, language, is_deactivated, email_verified, totp_enabled FROM users WHERE username = ?',
    [username],
  );

  if (rows.length === 0) {
    throw new AppError('Invalid username or password', 401, 'INVALID_CREDENTIALS');
  }

  const user = rows[0];

  if (user.is_deactivated) {
    throw new AppError('Account has been deactivated', 403, 'DEACTIVATED');
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    throw new AppError('Invalid username or password', 401, 'INVALID_CREDENTIALS');
  }

  return toPublicUser(user);
}

export async function login(
  username: string,
  password: string,
): Promise<{ auth: AuthResponse; refreshToken: string } | TotpChallengeResponse> {
  const publicUser = await verifyCredentials(username, password);

  // Check if TOTP is enabled — return challenge instead of tokens
  if (publicUser.twoFactorEnabled) {
    const config = getConfig();
    const totpToken = jwt.sign(
      {
        userId: publicUser.id,
        username: publicUser.username,
        role: publicUser.role,
        purpose: 'totp-challenge',
      },
      config.JWT_SECRET,
      { expiresIn: '5m' } as jwt.SignOptions,
    );
    return { totpRequired: true, totpToken };
  }

  return completeLogin(publicUser);
}

async function completeLogin(
  publicUser: PublicUser,
): Promise<{ auth: AuthResponse; refreshToken: string }> {
  // Update last login
  await execute('UPDATE users SET last_login = NOW() WHERE id = ?', [publicUser.id]);

  const accessToken = generateAccessToken({
    userId: publicUser.id,
    username: publicUser.username,
    role: publicUser.role,
  });

  // Create refresh token
  const refreshToken = generateToken();
  const refreshHash = hashToken(refreshToken);
  const config = getConfig();
  const expiresMs = parseExpiresIn(config.JWT_REFRESH_EXPIRES_IN);
  const expiresAt = new Date(Date.now() + expiresMs);

  await execute('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [
    publicUser.id,
    refreshHash,
    expiresAt,
  ]);

  return { auth: { user: publicUser, accessToken }, refreshToken };
}

export async function completeTotpLogin(
  totpToken: string,
  code: string,
): Promise<{ auth: AuthResponse; refreshToken: string }> {
  const config = getConfig();

  let decoded: { userId: number; username: string; role: string; purpose?: string };
  try {
    decoded = jwt.verify(totpToken, config.JWT_SECRET) as typeof decoded;
  } catch {
    throw new AppError('Invalid or expired 2FA token', 401, 'INVALID_TOKEN');
  }

  if (decoded.purpose !== 'totp-challenge') {
    throw new AppError('Invalid token purpose', 401, 'INVALID_TOKEN');
  }

  const verified = await totpService.verifyCode(decoded.userId, code);
  if (!verified) {
    throw new AppError('Invalid verification code', 401, 'INVALID_TOTP_CODE');
  }

  // Re-query user to get current state
  const rows = await query<UserRow[]>(
    'SELECT id, username, role, language, email_verified, totp_enabled, is_deactivated FROM users WHERE id = ?',
    [decoded.userId],
  );
  if (rows.length === 0 || rows[0].is_deactivated) {
    throw new AppError('Account not found or deactivated', 401, 'INVALID_CREDENTIALS');
  }

  const publicUser = toPublicUser(rows[0]);
  return completeLogin(publicUser);
}

export async function refreshAccessToken(
  refreshTokenValue: string,
): Promise<{ auth: AuthResponse; refreshToken: string }> {
  const tokenHash = hashToken(refreshTokenValue);

  const rows = await query<RefreshTokenJoinRow[]>(
    `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked,
            u.username, u.role, u.language, u.is_deactivated, u.email_verified, u.totp_enabled
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = ?`,
    [tokenHash],
  );

  if (rows.length === 0) {
    throw new AppError('Invalid refresh token', 401, 'INVALID_TOKEN');
  }

  const row = rows[0];

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

  // Atomically revoke old token — prevents race condition with concurrent refresh calls
  const revokeResult = await execute(
    'UPDATE refresh_tokens SET revoked = TRUE WHERE id = ? AND revoked = FALSE',
    [row.id],
  );
  if (revokeResult.affectedRows === 0) {
    // Another concurrent request already revoked this token — treat as reuse
    await execute('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = ?', [row.user_id]);
    throw new AppError('Token reuse detected', 401, 'TOKEN_REUSE');
  }

  // Issue new refresh token (rotation)
  const newRefreshToken = generateToken();
  const newHash = hashToken(newRefreshToken);
  const config = getConfig();
  const expiresMs = parseExpiresIn(config.JWT_REFRESH_EXPIRES_IN);
  const expiresAt = new Date(Date.now() + expiresMs);

  await execute('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [
    row.user_id,
    newHash,
    expiresAt,
  ]);

  const publicUser = toPublicUser(row);
  const accessToken = generateAccessToken({
    userId: row.user_id,
    username: row.username,
    role: row.role as UserRole,
  });

  return { auth: { user: publicUser, accessToken }, refreshToken: newRefreshToken };
}

export async function logout(refreshTokenValue: string): Promise<void> {
  const tokenHash = hashToken(refreshTokenValue);
  await execute('UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = ?', [tokenHash]);
}

export async function verifyEmail(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  const result = await execute(
    'UPDATE users SET email_verified = TRUE, email_verify_token = NULL, verification_resend_count = 0 WHERE email_verify_token = ?',
    [tokenHash],
  );
  if (result.affectedRows === 0) {
    throw new AppError('Invalid verification token', 400, 'INVALID_TOKEN');
  }
}

const MAX_VERIFICATION_RESENDS = 3;

export async function resendVerificationEmail(
  userId: number,
  email: string,
): Promise<{ remainingResends: number }> {
  const config = getConfig();
  const normalizedEmail = email.toLowerCase().trim();
  const emailHash = hashEmail(normalizedEmail, config.EMAIL_PEPPER);

  const rows = await query<UserRow[]>(
    'SELECT id, email_hash, email_verified, language, verification_resend_count FROM users WHERE id = ? AND email_hash = ?',
    [userId, emailHash],
  );
  if (rows.length === 0) {
    // Email doesn't match — return silently to avoid enumeration
    return { remainingResends: 0 };
  }
  const user = rows[0];
  if (user.email_verified) {
    return { remainingResends: 0 };
  }

  const resendCount = user.verification_resend_count ?? 0;
  if (resendCount >= MAX_VERIFICATION_RESENDS) {
    throw new AppError('Resend limit reached', 429, 'RESEND_LIMIT_REACHED');
  }

  const newToken = generateToken();
  await execute(
    'UPDATE users SET email_verify_token = ?, verification_resend_count = verification_resend_count + 1 WHERE id = ?',
    [hashToken(newToken), userId],
  );

  await sendVerificationEmail(normalizedEmail, newToken, user.language || 'en');

  return { remainingResends: MAX_VERIFICATION_RESENDS - resendCount - 1 };
}

export async function forgotPassword(email: string): Promise<void> {
  const config = getConfig();
  const emailHash = hashEmail(email.toLowerCase().trim(), config.EMAIL_PEPPER);

  const rows = await query<IdWithLanguageRow[]>(
    'SELECT id, language FROM users WHERE email_hash = ?',
    [emailHash],
  );
  if (rows.length === 0) {
    // Don't reveal whether email exists
    return;
  }

  const resetToken = generateToken();
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await execute(
    'UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE email_hash = ?',
    [hashToken(resetToken), expires, emailHash],
  );

  await sendPasswordResetEmail(email, resetToken, rows[0].language || 'en');
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const tokenHash = hashToken(token);
  const passwordHash = await hashPassword(newPassword);

  // Atomic: verify token + update password in one step (prevents TOCTOU race)
  // id = LAST_INSERT_ID(id) captures the matched row's id in result.insertId
  const result = await execute(
    `UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL,
     id = LAST_INSERT_ID(id)
     WHERE password_reset_token = ? AND password_reset_expires > NOW()`,
    [passwordHash, tokenHash],
  );

  if (result.affectedRows === 0) {
    throw new AppError('Invalid or expired reset token', 400, 'INVALID_TOKEN');
  }

  const userId = result.insertId;

  // Revoke all refresh tokens for security
  await execute('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = ?', [userId]);
}

import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { query, execute } from '../db/connection';
import { AppError } from '../middleware/errorHandler';
import {
  comparePassword,
  hashPassword,
  encryptTotpSecret,
  decryptTotpSecret,
  generateBackupCodes,
} from '../utils/crypto';
import { getConfig } from '../config';
import { UserRow } from '../db/types';
import { TotpSetupResponse } from '@blast-arena/shared';

function getEncryptionKey(): string {
  const key = getConfig().TOTP_ENCRYPTION_KEY;
  if (!key) {
    throw new AppError(
      'Two-factor authentication is not configured on this server',
      400,
      'TOTP_NOT_CONFIGURED',
    );
  }
  return key;
}

export async function beginSetup(userId: number, username: string): Promise<TotpSetupResponse> {
  const key = getEncryptionKey();

  const rows = await query<UserRow[]>('SELECT totp_enabled FROM users WHERE id = ?', [userId]);
  if (rows.length === 0) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }
  if (rows[0].totp_enabled) {
    throw new AppError('Two-factor authentication is already enabled', 400, 'TOTP_ALREADY_ENABLED');
  }

  const totp = new OTPAuth.TOTP({
    issuer: 'BlastArena',
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });

  const secret = totp.secret.base32;
  const encrypted = encryptTotpSecret(secret, key);

  const backupCodes = generateBackupCodes(10);
  const hashedCodes: string[] = [];
  for (const code of backupCodes) {
    hashedCodes.push(await hashPassword(code));
  }

  await execute('UPDATE users SET totp_secret = ?, totp_backup_codes = ? WHERE id = ?', [
    encrypted,
    JSON.stringify(hashedCodes),
    userId,
  ]);

  const uri = totp.toString();
  const qrDataUri = await QRCode.toDataURL(uri);

  return { qrDataUri, secret, backupCodes };
}

export async function confirmSetup(userId: number, code: string): Promise<void> {
  const key = getEncryptionKey();

  const rows = await query<UserRow[]>('SELECT totp_secret, totp_enabled FROM users WHERE id = ?', [
    userId,
  ]);
  if (rows.length === 0) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }
  if (rows[0].totp_enabled) {
    throw new AppError('Two-factor authentication is already enabled', 400, 'TOTP_ALREADY_ENABLED');
  }
  if (!rows[0].totp_secret) {
    throw new AppError('No 2FA setup in progress', 400, 'NO_TOTP_SETUP');
  }

  const secret = decryptTotpSecret(rows[0].totp_secret, key);
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    throw new AppError('Invalid verification code', 400, 'INVALID_TOTP_CODE');
  }

  await execute('UPDATE users SET totp_enabled = TRUE WHERE id = ?', [userId]);
}

export async function disable(userId: number, password: string, code: string): Promise<void> {
  const key = getEncryptionKey();

  const rows = await query<UserRow[]>(
    'SELECT password_hash, totp_secret, totp_enabled, totp_backup_codes FROM users WHERE id = ?',
    [userId],
  );
  if (rows.length === 0) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }
  if (!rows[0].totp_enabled) {
    throw new AppError('Two-factor authentication is not enabled', 400, 'TOTP_NOT_ENABLED');
  }

  const valid = await comparePassword(password, rows[0].password_hash);
  if (!valid) {
    throw new AppError('Password is incorrect', 401, 'INVALID_PASSWORD');
  }

  const verified = await verifyCodeInternal(
    rows[0].totp_secret!,
    rows[0].totp_backup_codes,
    key,
    code,
    userId,
  );
  if (!verified) {
    throw new AppError('Invalid verification code', 400, 'INVALID_TOTP_CODE');
  }

  await execute(
    'UPDATE users SET totp_secret = NULL, totp_enabled = FALSE, totp_backup_codes = NULL WHERE id = ?',
    [userId],
  );
}

export async function verifyCode(userId: number, code: string): Promise<boolean> {
  const key = getEncryptionKey();

  const rows = await query<UserRow[]>(
    'SELECT totp_secret, totp_backup_codes FROM users WHERE id = ?',
    [userId],
  );
  if (rows.length === 0 || !rows[0].totp_secret) {
    return false;
  }

  return verifyCodeInternal(rows[0].totp_secret, rows[0].totp_backup_codes, key, code, userId);
}

async function verifyCodeInternal(
  encryptedSecret: string,
  backupCodesJson: string | null,
  key: string,
  code: string,
  userId: number,
): Promise<boolean> {
  // Try TOTP code first
  const secret = decryptTotpSecret(encryptedSecret, key);
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta !== null) {
    return true;
  }

  // Try backup codes
  if (!backupCodesJson) return false;

  const hashedCodes: string[] = JSON.parse(backupCodesJson);
  const normalizedCode = code.toLowerCase().trim();

  for (let i = 0; i < hashedCodes.length; i++) {
    const match = await comparePassword(normalizedCode, hashedCodes[i]);
    if (match) {
      // Remove used backup code
      hashedCodes.splice(i, 1);
      await execute('UPDATE users SET totp_backup_codes = ? WHERE id = ?', [
        JSON.stringify(hashedCodes),
        userId,
      ]);
      return true;
    }
  }

  return false;
}

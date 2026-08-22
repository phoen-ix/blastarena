import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { AppError } from '../middleware/errorHandler';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function hashEmail(email: string, pepper: string): string {
  return crypto.createHmac('sha256', pepper).update(email.toLowerCase().trim()).digest('hex');
}

export function encryptTotpSecret(secret: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptTotpSecret(encrypted: string, keyHex: string): string {
  // Wrap so a tampered/corrupt secret or auth-tag failure surfaces as a clean error instead of an
  // unhandled native crypto exception (which otherwise yields an opaque 500). (audit TOTP-3)
  try {
    const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');
    const key = Buffer.from(keyHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
  } catch {
    throw new AppError('Failed to decrypt 2FA secret', 500, 'TOTP_DECRYPT_FAILED');
  }
}

export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const hex = crypto.randomBytes(4).toString('hex');
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4, 8)}`);
  }
  return codes;
}

export function generateEmailHint(email: string): string {
  const normalized = email.toLowerCase().trim();
  const atIdx = normalized.indexOf('@');
  if (atIdx < 1) return '***@***';
  const local = normalized.slice(0, atIdx);
  const domain = normalized.slice(atIdx + 1);
  const maskedLocal = local[0] + '***';
  const parts = domain.split('.');
  const tld = parts.pop()!;
  const maskedDomain = parts.map((p) => p[0] + '***').join('.') + '.' + tld;
  return maskedLocal + '@' + maskedDomain;
}

/**
 * A log-safe view of an error that may have come from the mail transport.
 *
 * pino's default `err` serializer copies every enumerable own property of an Error. Nodemailer's
 * SMTP errors carry `response` (the raw server line, typically
 * `550 5.1.1 <someone@example.com> User unknown`), `rejected`, `rejectedErrors` and
 * `envelope.to` — so `logger.error({ err }, 'Failed to send email')` wrote recipient addresses
 * into the log even though no call site ever passed one.
 *
 * That matters here more than it would elsewhere: this app hashes addresses with EMAIL_PEPPER
 * precisely so it never stores them, keeping only `email_hash` + `email_hint`. And two of the
 * affected call sites fire *only* on the email-already-registered path, whose whole purpose is to
 * be indistinguishable from a fresh registration — an SMTP hiccup there is an enumeration oracle.
 *
 * Returns a plain object rather than an Error so pino's serializer has nothing to expand.
 * (audit EMAIL-LOG-1)
 */
export function scrubEmailError(err: unknown): { name?: string; code?: string; message: string } {
  const maskAddresses = (text: string): string =>
    text.replace(/[^\s<>@,;]+@[^\s<>@,;]+/g, (address) => generateEmailHint(address));

  if (err instanceof Error) {
    const e = err as Error & { code?: unknown };
    return {
      name: err.name,
      ...(typeof e.code === 'string' ? { code: e.code } : {}),
      message: maskAddresses(err.message).slice(0, 300),
    };
  }
  return { message: maskAddresses(String(err)).slice(0, 300) };
}

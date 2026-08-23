import { z } from 'zod';

/**
 * TOTP_ENCRYPTION_KEY is consumed as `Buffer.from(key, 'hex')` and handed to `aes-256-gcm`
 * (utils/crypto.ts:28), which requires exactly 32 bytes — that is, 64 hex characters.
 *
 * The previous rule was `length >= 32`, which is the wrong unit twice over:
 *
 *   - A 32-character key passes validation and decodes to 16 bytes, so `createCipheriv` throws
 *     `Invalid key length` on the *first 2FA enrolment*. Startup reports the server as correctly
 *     configured and the failure only surfaces when a user tries to turn 2FA on.
 *   - `Buffer.from(s, 'hex')` truncates silently at the first non-hex character instead of
 *     throwing. A 40-character passphrase therefore decodes to a handful of bytes (or none), and
 *     a value that happened to truncate to exactly 32 bytes would be a silently weakened key
 *     derived from only part of the secret.
 *
 * Requiring exact hex makes the config the single place this is caught, and matches what the
 * documented generator (`openssl rand -hex 32`) already produces. (audit TOTP-KEY-LENGTH-1)
 */
const TOTP_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

export function isValidTotpKey(value: string): boolean {
  return TOTP_KEY_PATTERN.test(value);
}

const TOTP_KEY_MESSAGE =
  'TOTP_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for aes-256-gcm) when set. ' +
  'Generate one with: openssl rand -hex 32';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(3306),
  DB_NAME: z.string().default('blast_arena'),
  DB_USER: z.string().default('blast_user'),
  DB_PASSWORD: z.string(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  EMAIL_PEPPER: z.string().min(32),
  TOTP_ENCRYPTION_KEY: z
    .string()
    .default('')
    .refine((v) => v === '' || isValidTotpKey(v), TOTP_KEY_MESSAGE),

  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM_EMAIL: z.string().default('noreply@example.com'),
  SMTP_FROM_NAME: z.string().default('BlastArena'),

  APP_URL: z.string().default('http://localhost:8080'),
  LOG_LEVEL: z.string().default('info'),

  GAME_TICK_RATE: z.coerce.number().default(20),
  MAX_ROOMS: z.coerce.number().default(50),
  MAX_PLAYERS_PER_ROOM: z.coerce.number().default(8),
  BOMB_TIMER_SECONDS: z.coerce.number().default(3),
  POWERUP_DROP_CHANCE: z.coerce.number().default(0.3),

  RATE_LIMIT_LOGIN: z.coerce.number().default(5),
  RATE_LIMIT_REGISTER: z.coerce.number().default(3),
  RATE_LIMIT_API: z.coerce.number().default(100),
});

export type Config = z.infer<typeof configSchema>;

let config: Config;

export function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid configuration:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  // Validate SMTP fields are either all set or all empty
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD } = result.data;
  const smtpFields = [SMTP_HOST, SMTP_USER, SMTP_PASSWORD];
  const hasAny = smtpFields.some((f) => f.length > 0);
  const hasAll = smtpFields.every((f) => f.length > 0);
  if (hasAny && !hasAll) {
    console.error(
      'Invalid configuration: SMTP_HOST, SMTP_USER, and SMTP_PASSWORD must all be set together',
    );
    process.exit(1);
  }

  if (!result.data.TOTP_ENCRYPTION_KEY) {
    if (result.data.NODE_ENV === 'production') {
      // Fail fast in production: a missing key silently disables 2FA for everyone, including
      // users who already enabled it (they would be locked out). (audit TOTP-OPTIONAL-ENCRYPTION-1)
      console.error(
        `Invalid configuration: TOTP_ENCRYPTION_KEY must be set in production. ${TOTP_KEY_MESSAGE} ` +
          'Two-factor authentication cannot function without it.',
      );
      process.exit(1);
    }
    console.warn('Warning: TOTP_ENCRYPTION_KEY not set — two-factor authentication is disabled');
  }

  config = result.data;
  return config;
}

export function getConfig(): Config {
  if (!config) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }
  return config;
}

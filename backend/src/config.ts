import { z } from 'zod';

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
    .refine(
      (v) => v === '' || v.length >= 32,
      'TOTP_ENCRYPTION_KEY must be at least 32 characters when set',
    ),

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
        'Invalid configuration: TOTP_ENCRYPTION_KEY must be set in production (>=32 chars). ' +
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

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

// ── Mock: nodemailer ────────────────────────────────────────────────────────

const mockSendMail = jest.fn<AnyFn>();
const mockCreateTransport = jest.fn<AnyFn>().mockReturnValue({ sendMail: mockSendMail });
jest.mock('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
  __esModule: true,
}));

// ── Mock: config ────────────────────────────────────────────────────────────

const mockGetConfig = jest.fn<AnyFn>();
jest.mock('../../../backend/src/config', () => ({
  getConfig: mockGetConfig,
}));

// ── Mock: logger ────────────────────────────────────────────────────────────

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};
jest.mock('../../../backend/src/utils/logger', () => ({
  logger: mockLogger,
}));

// ── Mock: settings ──────────────────────────────────────────────────────────

const mockGetEmailSettings = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/settings', () => ({
  getEmailSettings: mockGetEmailSettings,
}));

// ── Mock: i18n ─────────────────────────────────────────────────────────────

// Load English translations so email content assertions still pass
// eslint-disable-next-line @typescript-eslint/no-require-imports
const emailTranslations = require('../../../backend/src/i18n/locales/en/email.json');

function resolveKey(key: string): string {
  // key format: "email:section.field"
  const withoutNs = key.replace(/^email:/, '');
  const parts = withoutNs.split('.');
  let val: Record<string, unknown> = emailTranslations;
  for (const p of parts) {
    val = val[p] as Record<string, unknown>;
    if (val === undefined) return key;
  }
  return val as unknown as string;
}

jest.mock('../../../backend/src/i18n', () => ({
  getFixedT: () => resolveKey,
}));

// ── Import SUT (after mocks) ───────────────────────────────────────────────

import {
  invalidateTransporter,
  sendVerificationEmail,
  sendEmailChangeEmail,
  sendPasswordResetEmail,
  sendTestEmail,
} from '../../../backend/src/services/email';

// ── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: 587,
  SMTP_USER: 'user@example.com',
  SMTP_PASSWORD: 'secret',
  SMTP_FROM_EMAIL: 'noreply@example.com',
  SMTP_FROM_NAME: 'BlastArena',
  APP_URL: 'https://blast.example.com',
};

const EMPTY_SMTP_CONFIG = {
  SMTP_HOST: '',
  SMTP_PORT: 587,
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  SMTP_FROM_EMAIL: 'noreply@example.com',
  SMTP_FROM_NAME: 'BlastArena',
  APP_URL: 'https://blast.example.com',
};

function setupConfig(overrides: Partial<typeof DEFAULT_CONFIG> = {}) {
  mockGetConfig.mockReturnValue({ ...DEFAULT_CONFIG, ...overrides });
}

function setupDbSettings(overrides: Record<string, unknown> = {}) {
  mockGetEmailSettings.mockResolvedValue(overrides);
}

describe('email service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Always invalidate transporter cache between tests so each test starts fresh
    invalidateTransporter();
    // Default: env config with SMTP configured, no DB overrides
    setupConfig();
    setupDbSettings({});
    mockSendMail.mockResolvedValue({ messageId: '<test@example.com>' });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // invalidateTransporter
  // ══════════════════════════════════════════════════════════════════════════

  describe('invalidateTransporter', () => {
    it('forces a new transporter to be created on next send', async () => {
      await sendTestEmail('a@test.com');
      expect(mockCreateTransport).toHaveBeenCalledTimes(1);

      // Second send reuses cached transporter
      await sendTestEmail('b@test.com');
      expect(mockCreateTransport).toHaveBeenCalledTimes(1);

      // Invalidate, then send again — new transporter created
      invalidateTransporter();
      await sendTestEmail('c@test.com');
      expect(mockCreateTransport).toHaveBeenCalledTimes(2);
    });

    it('can be called multiple times safely', () => {
      invalidateTransporter();
      invalidateTransporter();
      invalidateTransporter();
      // No error — just nulls the transporter each time
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Transporter creation & caching
  // ══════════════════════════════════════════════════════════════════════════

  describe('transporter creation', () => {
    it('creates transporter with correct SMTP options from env config', async () => {
      await sendTestEmail('test@example.com');

      expect(mockCreateTransport).toHaveBeenCalledTimes(1);
      expect(mockCreateTransport).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: {
          user: 'user@example.com',
          pass: 'secret',
        },
      });
    });

    it('sets secure=true when port is 465', async () => {
      setupConfig({ SMTP_PORT: 465 });

      await sendTestEmail('test@example.com');

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ secure: true, port: 465 }),
      );
    });

    it('sets secure=false when port is not 465', async () => {
      setupConfig({ SMTP_PORT: 2525 });

      await sendTestEmail('test@example.com');

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ secure: false, port: 2525 }),
      );
    });

    it('omits auth when SMTP user is empty', async () => {
      setupConfig({ SMTP_USER: '', SMTP_PASSWORD: '' });

      await sendTestEmail('test@example.com');

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ auth: undefined }),
      );
    });

    it('caches transporter across multiple sends', async () => {
      await sendTestEmail('a@test.com');
      await sendTestEmail('b@test.com');
      await sendTestEmail('c@test.com');

      expect(mockCreateTransport).toHaveBeenCalledTimes(1);
      expect(mockSendMail).toHaveBeenCalledTimes(3);
    });

    it('uses DB settings when they override env config', async () => {
      setupDbSettings({
        smtpHost: 'db-smtp.example.com',
        smtpPort: 465,
        smtpUser: 'dbuser@example.com',
        smtpPassword: 'dbsecret',
        fromEmail: 'db-noreply@example.com',
        fromName: 'DB BlastArena',
      });

      await sendTestEmail('test@example.com');

      expect(mockCreateTransport).toHaveBeenCalledWith({
        host: 'db-smtp.example.com',
        port: 465,
        secure: true,
        auth: {
          user: 'dbuser@example.com',
          pass: 'dbsecret',
        },
      });
    });

    it('falls back to env config when DB settings are undefined/null', async () => {
      setupDbSettings({
        smtpHost: undefined,
        smtpPort: undefined,
        smtpUser: undefined,
        smtpPassword: undefined,
        fromEmail: undefined,
        fromName: undefined,
      });

      await sendTestEmail('test@example.com');

      expect(mockCreateTransport).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: {
          user: 'user@example.com',
          pass: 'secret',
        },
      });
    });

    it('uses partial DB overrides (some fields from DB, rest from env)', async () => {
      setupDbSettings({
        smtpHost: 'custom-host.com',
        // smtpPort, smtpUser, smtpPassword not set — falls back to env
      });

      await sendTestEmail('test@example.com');

      expect(mockCreateTransport).toHaveBeenCalledWith({
        host: 'custom-host.com',
        port: 587,
        secure: false,
        auth: {
          user: 'user@example.com',
          pass: 'secret',
        },
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SMTP not configured (no host)
  // ══════════════════════════════════════════════════════════════════════════

  describe('when SMTP is not configured', () => {
    beforeEach(() => {
      setupConfig(EMPTY_SMTP_CONFIG);
      setupDbSettings({});
    });

    it('logs a warning about SMTP not being configured', async () => {
      await sendTestEmail('test@example.com');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'SMTP not configured, emails will be logged only',
      );
    });

    it('does not create a transporter', async () => {
      await sendTestEmail('test@example.com');

      expect(mockCreateTransport).not.toHaveBeenCalled();
    });

    it('does not attempt to send via SMTP', async () => {
      await sendTestEmail('test@example.com');

      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('logs the email info instead of sending', async () => {
      await sendTestEmail('recipient@example.com');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'recipient@example.com' }),
        expect.stringContaining('SMTP not configured'),
      );
    });

    it('logs the email body at debug level', async () => {
      await sendTestEmail('recipient@example.com');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ html: expect.any(String) }),
        'Email body',
      );
    });

    it('does not throw an error', async () => {
      await expect(sendTestEmail('test@example.com')).resolves.toBeUndefined();
    });

    it('verification email is logged but not sent when SMTP unconfigured', async () => {
      await sendVerificationEmail('user@example.com', 'token123');

      expect(mockSendMail).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Verify your BlastArena account',
        }),
        expect.stringContaining('SMTP not configured'),
      );
    });

    it('password reset email is logged but not sent when SMTP unconfigured', async () => {
      await sendPasswordResetEmail('user@example.com', 'reset-token');

      expect(mockSendMail).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Reset your BlastArena password',
        }),
        expect.stringContaining('SMTP not configured'),
      );
    });

    it('email change email is logged but not sent when SMTP unconfigured', async () => {
      await sendEmailChangeEmail('new@example.com', 'change-token');

      expect(mockSendMail).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'new@example.com',
          subject: 'Confirm your new email address — BlastArena',
        }),
        expect.stringContaining('SMTP not configured'),
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // sendVerificationEmail
  // ══════════════════════════════════════════════════════════════════════════

  describe('sendVerificationEmail', () => {
    it('sends email with correct subject', async () => {
      await sendVerificationEmail('user@example.com', 'abc123');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Verify your BlastArena account',
        }),
      );
    });

    it('sends to the correct recipient', async () => {
      await sendVerificationEmail('user@example.com', 'abc123');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
        }),
      );
    });

    it('includes the verification URL with token in HTML body', async () => {
      await sendVerificationEmail('user@example.com', 'mytoken');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('https://blast.example.com/api/auth/verify-email/mytoken');
    });

    it('constructs verification URL using APP_URL from config', async () => {
      setupConfig({ APP_URL: 'http://localhost:8080' });
      invalidateTransporter();

      await sendVerificationEmail('user@example.com', 'tok');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('http://localhost:8080/api/auth/verify-email/tok');
    });

    it('sets from field with fromName and fromEmail', async () => {
      await sendVerificationEmail('user@example.com', 'tok');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '"BlastArena" <noreply@example.com>',
        }),
      );
    });

    it('uses DB from settings when available', async () => {
      setupDbSettings({
        fromEmail: 'custom@blast.com',
        fromName: 'Custom Blast',
      });
      invalidateTransporter();

      await sendVerificationEmail('user@example.com', 'tok');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '"Custom Blast" <custom@blast.com>',
        }),
      );
    });

    it('logs success after sending', async () => {
      await sendVerificationEmail('user@example.com', 'abc123');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Verify your BlastArena account',
        }),
        'Email sent',
      );
    });

    it('includes welcome text in HTML body', async () => {
      await sendVerificationEmail('user@example.com', 'tok');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('Welcome to BlastArena');
    });

    it('includes ignore instruction in HTML body', async () => {
      await sendVerificationEmail('user@example.com', 'tok');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain("If you didn't create an account");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // sendEmailChangeEmail
  // ══════════════════════════════════════════════════════════════════════════

  describe('sendEmailChangeEmail', () => {
    it('sends email with correct subject', async () => {
      await sendEmailChangeEmail('new@example.com', 'change-tok');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Confirm your new email address — BlastArena',
        }),
      );
    });

    it('sends to the new email address', async () => {
      await sendEmailChangeEmail('new@example.com', 'change-tok');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'new@example.com',
        }),
      );
    });

    it('includes the confirm-email URL with token in HTML body', async () => {
      await sendEmailChangeEmail('new@example.com', 'change-tok');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain(
        'https://blast.example.com/api/user/confirm-email/change-tok',
      );
    });

    it('constructs confirm URL using APP_URL from config', async () => {
      setupConfig({ APP_URL: 'http://custom:3000' });
      invalidateTransporter();

      await sendEmailChangeEmail('new@example.com', 'tok');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('http://custom:3000/api/user/confirm-email/tok');
    });

    it('mentions 24-hour expiration in HTML body', async () => {
      await sendEmailChangeEmail('new@example.com', 'tok');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('24 hours');
    });

    it('includes email change context text', async () => {
      await sendEmailChangeEmail('new@example.com', 'tok');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('Email Change Request');
      expect(callArgs.html).toContain('change your BlastArena email');
    });

    it('includes ignore instruction', async () => {
      await sendEmailChangeEmail('new@example.com', 'tok');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain("If you didn't request this change");
    });

    it('logs success after sending', async () => {
      await sendEmailChangeEmail('new@example.com', 'tok');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'new@example.com',
          subject: 'Confirm your new email address — BlastArena',
        }),
        'Email sent',
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // sendPasswordResetEmail
  // ══════════════════════════════════════════════════════════════════════════

  describe('sendPasswordResetEmail', () => {
    it('sends email with correct subject', async () => {
      await sendPasswordResetEmail('user@example.com', 'reset-tok');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Reset your BlastArena password',
        }),
      );
    });

    it('sends to the correct recipient', async () => {
      await sendPasswordResetEmail('user@example.com', 'reset-tok');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
        }),
      );
    });

    it('includes the password reset URL with token as query param', async () => {
      await sendPasswordResetEmail('user@example.com', 'reset-tok');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('https://blast.example.com/reset-password?token=reset-tok');
    });

    it('constructs reset URL using APP_URL from config', async () => {
      setupConfig({ APP_URL: 'http://dev.blast.local:9090' });
      invalidateTransporter();

      await sendPasswordResetEmail('user@example.com', 'tok');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('http://dev.blast.local:9090/reset-password?token=tok');
    });

    it('mentions 1-hour expiration in HTML body', async () => {
      await sendPasswordResetEmail('user@example.com', 'tok');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('1 hour');
    });

    it('includes password reset heading', async () => {
      await sendPasswordResetEmail('user@example.com', 'tok');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('Password Reset');
    });

    it('includes ignore instruction', async () => {
      await sendPasswordResetEmail('user@example.com', 'tok');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain("If you didn't request a password reset");
    });

    it('logs success after sending', async () => {
      await sendPasswordResetEmail('user@example.com', 'reset-tok');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Reset your BlastArena password',
        }),
        'Email sent',
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // sendTestEmail
  // ══════════════════════════════════════════════════════════════════════════

  describe('sendTestEmail', () => {
    it('sends email with correct subject', async () => {
      await sendTestEmail('admin@example.com');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'BlastArena — Test Email',
        }),
      );
    });

    it('sends to the specified address', async () => {
      await sendTestEmail('admin@example.com');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@example.com',
        }),
      );
    });

    it('includes test email content in HTML body', async () => {
      await sendTestEmail('admin@example.com');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('Test Email');
      expect(callArgs.html).toContain('SMTP configuration is working correctly');
    });

    it('uses correct from field', async () => {
      await sendTestEmail('admin@example.com');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '"BlastArena" <noreply@example.com>',
        }),
      );
    });

    it('logs success after sending', async () => {
      await sendTestEmail('admin@example.com');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@example.com',
          subject: 'BlastArena — Test Email',
        }),
        'Email sent',
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Error handling
  // ══════════════════════════════════════════════════════════════════════════

  describe('error handling', () => {
    it('throws the original error when sendMail fails', async () => {
      const smtpError = new Error('Connection refused');
      mockSendMail.mockRejectedValueOnce(smtpError);

      await expect(sendTestEmail('test@example.com')).rejects.toThrow('Connection refused');
    });

    it('logs the error with context when sendMail fails', async () => {
      const smtpError = new Error('Auth failed');
      mockSendMail.mockRejectedValueOnce(smtpError);

      try {
        await sendTestEmail('fail@example.com');
      } catch {
        // expected
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: smtpError,
          to: 'fail@example.com',
          subject: 'BlastArena — Test Email',
        }),
        'Failed to send email',
      );
    });

    it('propagates error from sendMail for verification emails', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('SMTP timeout'));

      await expect(sendVerificationEmail('user@example.com', 'tok')).rejects.toThrow(
        'SMTP timeout',
      );
    });

    it('propagates error from sendMail for password reset emails', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('DNS failure'));

      await expect(sendPasswordResetEmail('user@example.com', 'tok')).rejects.toThrow(
        'DNS failure',
      );
    });

    it('propagates error from sendMail for email change emails', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('TLS error'));

      await expect(sendEmailChangeEmail('new@example.com', 'tok')).rejects.toThrow('TLS error');
    });

    it('logs error with correct subject for each email type on failure', async () => {
      const err = new Error('fail');
      mockSendMail.mockRejectedValue(err);

      try {
        await sendVerificationEmail('u@x.com', 't');
      } catch {
        // expected
      }
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Verify your BlastArena account' }),
        'Failed to send email',
      );

      jest.clearAllMocks();
      mockSendMail.mockRejectedValue(err);

      try {
        await sendPasswordResetEmail('u@x.com', 't');
      } catch {
        // expected
      }
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Reset your BlastArena password' }),
        'Failed to send email',
      );

      jest.clearAllMocks();
      mockSendMail.mockRejectedValue(err);

      try {
        await sendEmailChangeEmail('u@x.com', 't');
      } catch {
        // expected
      }
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Confirm your new email address — BlastArena',
        }),
        'Failed to send email',
      );
    });

    it('does not log success when sendMail fails', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('fail'));

      try {
        await sendTestEmail('test@example.com');
      } catch {
        // expected
      }

      expect(mockLogger.info).not.toHaveBeenCalledWith(expect.anything(), 'Email sent');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Config resolution priority (DB vs env)
  // ══════════════════════════════════════════════════════════════════════════

  describe('config resolution priority', () => {
    it('DB settings take priority over env config', async () => {
      setupConfig({
        SMTP_HOST: 'env-smtp.example.com',
        SMTP_FROM_EMAIL: 'env@example.com',
        SMTP_FROM_NAME: 'EnvName',
      });
      setupDbSettings({
        smtpHost: 'db-smtp.example.com',
        fromEmail: 'db@example.com',
        fromName: 'DbName',
      });

      await sendTestEmail('test@example.com');

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'db-smtp.example.com' }),
      );
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '"DbName" <db@example.com>',
        }),
      );
    });

    it('env config used when DB settings return empty object', async () => {
      setupConfig({
        SMTP_HOST: 'env-smtp.example.com',
        SMTP_FROM_EMAIL: 'env@example.com',
        SMTP_FROM_NAME: 'EnvName',
      });
      setupDbSettings({});

      await sendTestEmail('test@example.com');

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'env-smtp.example.com' }),
      );
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '"EnvName" <env@example.com>',
        }),
      );
    });

    it('DB null values fall through to env config via nullish coalescing', async () => {
      setupConfig({
        SMTP_HOST: 'env-host.com',
        SMTP_PORT: 2525,
      });
      setupDbSettings({
        smtpHost: null,
        smtpPort: null,
      });

      await sendTestEmail('test@example.com');

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'env-host.com',
          port: 2525,
        }),
      );
    });

    it('DB host empty string makes SMTP unconfigured (no transporter)', async () => {
      setupConfig({ SMTP_HOST: '' });
      setupDbSettings({ smtpHost: undefined });

      await sendTestEmail('test@example.com');

      expect(mockCreateTransport).not.toHaveBeenCalled();
      expect(mockSendMail).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('DB host overrides empty env host to enable SMTP', async () => {
      setupConfig({ SMTP_HOST: '' });
      setupDbSettings({ smtpHost: 'db-override.example.com' });

      await sendTestEmail('test@example.com');

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'db-override.example.com' }),
      );
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Transporter auth edge cases
  // ══════════════════════════════════════════════════════════════════════════

  describe('transporter auth edge cases', () => {
    it('includes auth when user is set (even with empty password)', async () => {
      setupConfig({ SMTP_USER: 'user@example.com', SMTP_PASSWORD: '' });

      await sendTestEmail('test@example.com');

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { user: 'user@example.com', pass: '' },
        }),
      );
    });

    it('omits auth entirely when user is empty string', async () => {
      setupConfig({ SMTP_USER: '' });

      await sendTestEmail('test@example.com');

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ auth: undefined }),
      );
    });

    it('uses DB SMTP user for auth when available', async () => {
      setupConfig({ SMTP_USER: 'env-user' });
      setupDbSettings({ smtpUser: 'db-user', smtpPassword: 'db-pass' });

      await sendTestEmail('test@example.com');

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { user: 'db-user', pass: 'db-pass' },
        }),
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Multiple email sends (integration-style)
  // ══════════════════════════════════════════════════════════════════════════

  describe('multiple email sends', () => {
    it('sends different email types with same cached transporter', async () => {
      await sendVerificationEmail('a@test.com', 'tok1');
      await sendPasswordResetEmail('b@test.com', 'tok2');
      await sendEmailChangeEmail('c@test.com', 'tok3');
      await sendTestEmail('d@test.com');

      // Only one transporter created
      expect(mockCreateTransport).toHaveBeenCalledTimes(1);

      // Four emails sent
      expect(mockSendMail).toHaveBeenCalledTimes(4);

      // Correct recipients
      expect(mockSendMail.mock.calls[0][0].to).toBe('a@test.com');
      expect(mockSendMail.mock.calls[1][0].to).toBe('b@test.com');
      expect(mockSendMail.mock.calls[2][0].to).toBe('c@test.com');
      expect(mockSendMail.mock.calls[3][0].to).toBe('d@test.com');

      // Correct subjects
      expect(mockSendMail.mock.calls[0][0].subject).toBe('Verify your BlastArena account');
      expect(mockSendMail.mock.calls[1][0].subject).toBe('Reset your BlastArena password');
      expect(mockSendMail.mock.calls[2][0].subject).toBe(
        'Confirm your new email address — BlastArena',
      );
      expect(mockSendMail.mock.calls[3][0].subject).toBe('BlastArena — Test Email');
    });

    it('a failure on one send does not break subsequent sends', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('temporary failure'));
      mockSendMail.mockResolvedValueOnce({ messageId: '<ok>' });

      await expect(sendTestEmail('fail@test.com')).rejects.toThrow('temporary failure');
      await expect(sendTestEmail('ok@test.com')).resolves.toBeUndefined();

      // Transporter is still cached despite the error
      expect(mockCreateTransport).toHaveBeenCalledTimes(1);
      expect(mockSendMail).toHaveBeenCalledTimes(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // URL construction per email type
  // ══════════════════════════════════════════════════════════════════════════

  describe('URL construction', () => {
    beforeEach(() => {
      setupConfig({ APP_URL: 'https://game.blast.io' });
      invalidateTransporter();
    });

    it('verification URL uses /api/auth/verify-email/:token path', async () => {
      await sendVerificationEmail('u@x.com', 'verify-123');

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain('https://game.blast.io/api/auth/verify-email/verify-123');
    });

    it('email change URL uses /api/user/confirm-email/:token path', async () => {
      await sendEmailChangeEmail('u@x.com', 'change-456');

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain('https://game.blast.io/api/user/confirm-email/change-456');
    });

    it('password reset URL uses /reset-password?token= query param', async () => {
      await sendPasswordResetEmail('u@x.com', 'reset-789');

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain('https://game.blast.io/reset-password?token=reset-789');
    });

    it('verification URL includes token with special characters', async () => {
      const specialToken = 'abc+def/ghi=jkl';
      await sendVerificationEmail('u@x.com', specialToken);

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain(`/api/auth/verify-email/${specialToken}`);
    });

    it('URLs contain clickable anchor tags', async () => {
      await sendVerificationEmail('u@x.com', 'tok');

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain('<a href="');
      expect(html).toContain('</a>');
    });
  });
});

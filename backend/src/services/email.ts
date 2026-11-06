import nodemailer, { type Transporter } from 'nodemailer';
import { getConfig } from '../config';
import { logger } from '../utils/logger';
import { getEmailSettings } from './settings';
import { getFixedT } from '../i18n';
import { generateEmailHint, scrubEmailError } from '../utils/crypto';
import { defaultSmtpSecurity, type SmtpSecurity } from '@blast-arena/shared';

let transporter: Transporter | null = null;

interface ResolvedEmailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  security: SmtpSecurity;
  ehloName: string;
  fromEmail: string;
  fromName: string;
}

async function getResolvedEmailConfig(): Promise<ResolvedEmailConfig> {
  const config = getConfig();
  const dbSettings = await getEmailSettings();
  const port = dbSettings.smtpPort ?? config.SMTP_PORT;
  const fromEmail = dbSettings.fromEmail || config.SMTP_FROM_EMAIL;

  return {
    host: dbSettings.smtpHost ?? config.SMTP_HOST,
    port,
    user: dbSettings.smtpUser ?? config.SMTP_USER,
    password: dbSettings.smtpPassword ?? config.SMTP_PASSWORD,
    security: dbSettings.smtpSecurity ?? defaultSmtpSecurity(port),
    ehloName: dbSettings.ehloName || fromEmail.split('@')[1],
    fromEmail,
    fromName: dbSettings.fromName || config.SMTP_FROM_NAME,
  };
}

async function getTransporter(): Promise<Transporter | null> {
  const emailConfig = await getResolvedEmailConfig();

  if (!emailConfig.host) {
    logger.warn('SMTP not configured, emails will be logged only');
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.security === 'tls',
      requireTLS: emailConfig.security === 'starttls',
      ignoreTLS: emailConfig.security === 'none',
      name: emailConfig.ehloName,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      auth: emailConfig.user
        ? {
            user: emailConfig.user,
            pass: emailConfig.password,
          }
        : undefined,
    });
  }

  return transporter;
}

export function invalidateTransporter(): void {
  transporter = null;
}

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<void> {
  const emailConfig = await getResolvedEmailConfig();
  const transport = await getTransporter();

  // Log the masked hint, never the address. The DB deliberately stores only `email_hash` +
  // `email_hint` (HMAC-SHA256 with EMAIL_PEPPER), so writing the plaintext recipient to stdout on
  // every send put back exactly what the schema goes out of its way not to keep — and the Docker
  // json-file driver retains 500 MB of it. (audit EMAIL-LOG-1)
  const recipient = generateEmailHint(to);

  if (!transport) {
    logger.info({ to: recipient, subject }, 'Email (SMTP not configured, logging only)');
    // Deliberately not logging the rendered body: it contains the verification / password-reset
    // URL, and therefore a live token. Harmless at LOG_LEVEL=info, but one env var away from not.
    logger.debug({ length: html.length }, 'Email body suppressed');
    return;
  }

  try {
    if (emailConfig.fromEmail.endsWith('@example.com')) {
      throw new Error(
        `Refusing to send email from the placeholder sender ${emailConfig.fromEmail}: set SMTP_FROM_EMAIL or the From Email admin setting`,
      );
    }
    await transport.sendMail({
      from: { name: emailConfig.fromName, address: emailConfig.fromEmail },
      to,
      subject,
      headers: { 'Auto-Submitted': 'auto-generated' },
      text,
      html: `<html><body>${html}</body></html>`,
    });
    logger.info({ to: recipient, subject }, 'Email sent');
  } catch (err) {
    logger.error({ err: scrubEmailError(err), to: recipient, subject }, 'Failed to send email');
    throw err;
  }
}

export async function sendVerificationEmail(
  email: string,
  token: string,
  language = 'en',
): Promise<void> {
  const t = getFixedT(language);
  const config = getConfig();
  const url = `${config.APP_URL}/api/auth/verify-email/${token}`;
  await sendEmail(
    email,
    t('email:verification.subject'),
    `
    <h1>${t('email:verification.heading')}</h1>
    <p>${t('email:verification.body')}</p>
    <p><a href="${url}">${url}</a></p>
    <p>${t('email:verification.ignore')}</p>
  `,
    `${t('email:verification.heading')}\n\n${t('email:verification.body')}\n${url}\n\n${t('email:verification.ignore')}\n`,
  );
}

export async function sendEmailChangeEmail(
  newEmail: string,
  token: string,
  language = 'en',
): Promise<void> {
  const t = getFixedT(language);
  const config = getConfig();
  const url = `${config.APP_URL}/api/user/confirm-email/${token}`;
  await sendEmail(
    newEmail,
    t('email:emailChange.subject'),
    `
    <h1>${t('email:emailChange.heading')}</h1>
    <p>${t('email:emailChange.body')}</p>
    <p>${t('email:emailChange.action')}</p>
    <p><a href="${url}">${url}</a></p>
    <p>${t('email:emailChange.expires')}</p>
    <p>${t('email:emailChange.ignore')}</p>
  `,
    `${t('email:emailChange.heading')}\n\n${t('email:emailChange.body')}\n\n${t('email:emailChange.action')}\n${url}\n\n${t('email:emailChange.expires')}\n\n${t('email:emailChange.ignore')}\n`,
  );
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
  language = 'en',
): Promise<void> {
  const t = getFixedT(language);
  const config = getConfig();
  const url = `${config.APP_URL}/reset-password?token=${token}`;
  await sendEmail(
    email,
    t('email:passwordReset.subject'),
    `
    <h1>${t('email:passwordReset.heading')}</h1>
    <p>${t('email:passwordReset.body')}</p>
    <p><a href="${url}">${url}</a></p>
    <p>${t('email:passwordReset.expires')}</p>
    <p>${t('email:passwordReset.ignore')}</p>
  `,
    `${t('email:passwordReset.heading')}\n\n${t('email:passwordReset.body')}\n${url}\n\n${t('email:passwordReset.expires')}\n\n${t('email:passwordReset.ignore')}\n`,
  );
}

export async function sendEmailTakenRegistrationWarning(
  email: string,
  language = 'en',
): Promise<void> {
  const t = getFixedT(language);
  const config = getConfig();
  const resetUrl = `${config.APP_URL}/forgot-password`;
  await sendEmail(
    email,
    t('email:registrationWarning.subject'),
    `
    <h1>${t('email:registrationWarning.heading')}</h1>
    <p>${t('email:registrationWarning.body')}</p>
    <p>${t('email:registrationWarning.resetHint')}</p>
    <p><a href="${resetUrl}">${resetUrl}</a></p>
    <p>${t('email:registrationWarning.ignore')}</p>
  `,
    `${t('email:registrationWarning.heading')}\n\n${t('email:registrationWarning.body')}\n\n${t('email:registrationWarning.resetHint')}\n${resetUrl}\n\n${t('email:registrationWarning.ignore')}\n`,
  );
}

export async function sendEmailTakenChangeWarning(email: string, language = 'en'): Promise<void> {
  const t = getFixedT(language);
  await sendEmail(
    email,
    t('email:emailChangeWarning.subject'),
    `
    <h1>${t('email:emailChangeWarning.heading')}</h1>
    <p>${t('email:emailChangeWarning.body')}</p>
    <p>${t('email:emailChangeWarning.ignore')}</p>
  `,
    `${t('email:emailChangeWarning.heading')}\n\n${t('email:emailChangeWarning.body')}\n\n${t('email:emailChangeWarning.ignore')}\n`,
  );
}

export async function sendTestEmail(to: string, language = 'en'): Promise<void> {
  const t = getFixedT(language);
  await sendEmail(
    to,
    t('email:test.subject'),
    `
    <h1>${t('email:test.heading')}</h1>
    <p>${t('email:test.body')}</p>
  `,
    `${t('email:test.heading')}\n\n${t('email:test.body')}\n`,
  );
}

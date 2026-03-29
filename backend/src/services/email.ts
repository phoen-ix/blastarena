import nodemailer from 'nodemailer';
import { getConfig } from '../config';
import { logger } from '../utils/logger';
import { getEmailSettings } from './settings';
import { getFixedT } from '../i18n';

let transporter: nodemailer.Transporter | null = null;

interface ResolvedEmailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  fromEmail: string;
  fromName: string;
}

async function getResolvedEmailConfig(): Promise<ResolvedEmailConfig> {
  const config = getConfig();
  const dbSettings = await getEmailSettings();

  return {
    host: dbSettings.smtpHost ?? config.SMTP_HOST,
    port: dbSettings.smtpPort ?? config.SMTP_PORT,
    user: dbSettings.smtpUser ?? config.SMTP_USER,
    password: dbSettings.smtpPassword ?? config.SMTP_PASSWORD,
    fromEmail: dbSettings.fromEmail ?? config.SMTP_FROM_EMAIL,
    fromName: dbSettings.fromName ?? config.SMTP_FROM_NAME,
  };
}

async function getTransporter(): Promise<nodemailer.Transporter | null> {
  const emailConfig = await getResolvedEmailConfig();

  if (!emailConfig.host) {
    logger.warn('SMTP not configured, emails will be logged only');
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.port === 465,
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

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const emailConfig = await getResolvedEmailConfig();
  const transport = await getTransporter();

  if (!transport) {
    logger.info({ to, subject }, 'Email (SMTP not configured, logging only)');
    logger.debug({ html }, 'Email body');
    return;
  }

  try {
    await transport.sendMail({
      from: `"${emailConfig.fromName}" <${emailConfig.fromEmail}>`,
      to,
      subject,
      html,
    });
    logger.info({ to, subject }, 'Email sent');
  } catch (err) {
    logger.error({ err, to, subject }, 'Failed to send email');
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
  );
}

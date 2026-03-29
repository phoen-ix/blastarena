import nodemailer from 'nodemailer';
import { getConfig } from '../config';
import { logger } from '../utils/logger';
import { getEmailSettings } from './settings';

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

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const config = getConfig();
  const url = `${config.APP_URL}/api/auth/verify-email/${token}`;
  await sendEmail(
    email,
    'Verify your BlastArena account',
    `
    <h1>Welcome to BlastArena!</h1>
    <p>Click the link below to verify your email address:</p>
    <p><a href="${url}">${url}</a></p>
    <p>If you didn't create an account, you can ignore this email.</p>
  `,
  );
}

export async function sendEmailChangeEmail(newEmail: string, token: string): Promise<void> {
  const config = getConfig();
  const url = `${config.APP_URL}/api/user/confirm-email/${token}`;
  await sendEmail(
    newEmail,
    'Confirm your new email address — BlastArena',
    `
    <h1>Email Change Request</h1>
    <p>You requested to change your BlastArena email to this address.</p>
    <p>Click the link below to confirm:</p>
    <p><a href="${url}">${url}</a></p>
    <p>This link expires in 24 hours.</p>
    <p>If you didn't request this change, you can ignore this email.</p>
  `,
  );
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const config = getConfig();
  const url = `${config.APP_URL}/reset-password?token=${token}`;
  await sendEmail(
    email,
    'Reset your BlastArena password',
    `
    <h1>Password Reset</h1>
    <p>Click the link below to reset your password:</p>
    <p><a href="${url}">${url}</a></p>
    <p>This link expires in 1 hour.</p>
    <p>If you didn't request a password reset, you can ignore this email.</p>
  `,
  );
}

export async function sendEmailTakenRegistrationWarning(email: string): Promise<void> {
  const config = getConfig();
  const resetUrl = `${config.APP_URL}/forgot-password`;
  await sendEmail(
    email,
    'Someone tried to create a BlastArena account with your email',
    `
    <h1>Registration Attempt</h1>
    <p>Someone tried to create a new BlastArena account using your email address.</p>
    <p>If this was you and you've forgotten your password, you can reset it here:</p>
    <p><a href="${resetUrl}">${resetUrl}</a></p>
    <p>If this wasn't you, no action is needed — your account is safe.</p>
  `,
  );
}

export async function sendEmailTakenChangeWarning(email: string): Promise<void> {
  await sendEmail(
    email,
    'Someone tried to change their BlastArena email to yours',
    `
    <h1>Email Change Attempt</h1>
    <p>Someone tried to change their BlastArena account email to your address.</p>
    <p>If this wasn't you, no action is needed — your account is unaffected.</p>
  `,
  );
}

export async function sendTestEmail(to: string): Promise<void> {
  await sendEmail(
    to,
    'BlastArena — Test Email',
    `
    <h1>Test Email</h1>
    <p>This is a test email from BlastArena to verify your SMTP configuration is working correctly.</p>
  `,
  );
}

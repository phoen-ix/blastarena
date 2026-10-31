import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { expect, test as base, type Page } from '@playwright/test';

import { BASE, resetRateLimits, sql } from '../docs/seed';

/* Shared helpers for part b. Every test makes its own users (unique suffix) through the admin API;
 * SQL only promotes this suite's admin and reads what has no API. Mail goes to Mailpit. */

export { BASE, resetRateLimits, sql };
export const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:24205';
export const PASSWORD = 'E2ePass-2026';
const ADMIN_NAME = 'e2eb_admin';

/** Fails a test on an uncaught page error or a 5xx answer. */
export const test = base.extend<{ guard: void }>({
  guard: [
    async ({ page }, use, testInfo) => {
      // Journeys sign in, render a live arena and wait on mail; on a loaded host 2 min is tight.
      testInfo.setTimeout(Math.max(testInfo.timeout, 240_000));
      // Low graphics quality: the live arena behind the landing and the open world render in
      // software WebGL here, and at High they starve a loaded machine.
      await page.addInitScript(() => {
        if (!localStorage.getItem('blast-arena-settings')) {
          localStorage.setItem('blast-arena-settings', JSON.stringify({ quality: 'low' }));
        }
      });
      const problems: string[] = [];
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('response', (r) => {
        if (r.status() >= 500) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
      });
      await use();
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

let seq = 0;
/** Short unique suffix: usernames allow 20 characters. */
export function uid(): string {
  seq += 1;
  return `${Date.now().toString(36).slice(-5)}${process.pid.toString(36).slice(-2)}${seq}`;
}

export async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data: data as T };
}

export async function ok<T = Record<string, unknown>>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<T> {
  const { status, data } = await api<T>(method, path, token, body);
  if (status >= 300) throw new Error(`${method} ${path}: ${status} ${JSON.stringify(data)}`);
  return data;
}

export interface Account {
  id: number;
  username: string;
  email: string;
  password: string;
  role: 'user' | 'moderator' | 'admin';
}

export async function token(username: string, password = PASSWORD): Promise<string> {
  resetRateLimits();
  return (
    await ok<{ accessToken: string }>('POST', '/auth/login', undefined, { username, password })
  ).accessToken;
}

let admin: { account: Account; token: string } | null = null;

/** This suite's admin: registered, then verified and promoted in SQL (no API for either). */
export async function adminSession(): Promise<{ account: Account; token: string }> {
  if (admin) return admin;
  resetRateLimits();
  const account: Account = {
    id: 0,
    username: ADMIN_NAME,
    email: 'e2eb.admin@blast-e2e.example',
    password: PASSWORD,
    role: 'admin',
  };
  await api('POST', '/auth/register', undefined, account);
  sql(`UPDATE users SET email_verified = TRUE, role = 'admin' WHERE username = '${ADMIN_NAME}'`);
  const t = await token(ADMIN_NAME);
  account.id = Number(sql(`SELECT id FROM users WHERE username = '${ADMIN_NAME}'`).trim());
  admin = { account, token: t };
  return admin;
}

/** A verified account made through the admin API. */
export async function createUser(role: Account['role'] = 'user', prefix = 'u'): Promise<Account> {
  const { token: t } = await adminSession();
  const username = `${prefix}${uid()}`.slice(0, 20);
  const account: Account = {
    id: 0,
    username,
    email: `${username.toLowerCase()}@blast-e2e.example`,
    password: PASSWORD,
    role,
  };
  const created = await ok<{ id: number }>('POST', '/admin/users', t, account);
  account.id = created.id;
  return account;
}

// ── Mail ─────────────────────────────────────────────────────────────

interface MailSummary {
  ID: string;
  Subject: string;
  Created: string;
}

/** The newest message to `to` whose subject matches, waiting for it to arrive. */
export async function mailTo(
  to: string,
  subject: RegExp,
): Promise<{ subject: string; html: string }> {
  let found: MailSummary | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
        );
        const { messages } = (await res.json()) as { messages: MailSummary[] };
        found = messages.find((m) => subject.test(m.Subject));
        return found?.ID ?? '';
      },
      { timeout: 20_000, message: `mail to ${to} matching ${subject}` },
    )
    .not.toBe('');
  const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${found!.ID}`)).json()) as {
    Subject: string;
    HTML: string;
  };
  return { subject: msg.Subject, html: msg.HTML };
}

export async function mailCount(to: string): Promise<number> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return ((await res.json()) as { messages: unknown[] }).messages.length;
}

export function firstLink(html: string): string {
  const m = html.match(/href="([^"]+)"/);
  if (!m) throw new Error('no link in mail');
  return m[1].replace(/&amp;/g, '&');
}

// ── TOTP (RFC 6238: SHA-1, 30 s, 6 digits) ───────────────────────────

function base32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

/** The code for the current time step plus `offset` steps (the server accepts +-1, each once). */
export function totp(secret: string, offset = 0): string {
  const counter = Math.floor(Date.now() / 30_000) + offset;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return n.toString().padStart(6, '0');
}

// ── Locale files (what the UI should show) ──────────────────────────

export const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'nl', 'tr', 'sv', 'nb', 'da'];

export function locale(
  workspace: 'frontend' | 'backend' | 'shared',
  lng: string,
  ns: string,
): Record<string, unknown> {
  const dir = workspace === 'shared' ? 'shared/src/i18n' : `${workspace}/src/i18n`;
  return JSON.parse(
    readFileSync(new URL(`../../${dir}/locales/${lng}/${ns}.json`, import.meta.url), 'utf8'),
  );
}

export function key(obj: Record<string, unknown>, path: string): string {
  return path
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj) as string;
}

// ── Browser ─────────────────────────────────────────────────────────

export async function landing(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
}

export const authForm = (page: Page) => page.locator('.auth-form');

/** Signs in through the form. The lobby then joins the open world; `stay` keeps it there. */
export async function signIn(
  page: Page,
  who: Pick<Account, 'username' | 'password'>,
): Promise<void> {
  resetRateLimits();
  await landing(page);
  await page.getByRole('button', { name: 'Login' }).click();
  const form = authForm(page);
  await form.getByLabel('Username').fill(who.username);
  await form.getByLabel('Password').fill(who.password);
  await form.getByRole('button', { name: 'Login', exact: true }).click();
}

/** From the open world (where every page load of a signed-in player starts) to the lobby. */
export async function leaveWorld(page: Page): Promise<void> {
  // Boot, textures, socket and the join: slow on a loaded host.
  await expect(page.locator('.hud-ow-board')).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Escape');
  await page.locator('#leave-confirm').click();
  await expect(page.locator('.sidebar')).toBeVisible();
}

/** Signed in, out of the open world again, in the lobby. */
export async function lobby(
  page: Page,
  who: Pick<Account, 'username' | 'password'>,
): Promise<void> {
  // Signed in through the API (the refresh cookie lands in the page's context), so the page
  // starts in the lobby instead of on the landing arena; signIn() covers the form itself.
  resetRateLimits();
  const res = await page.request.post('/api/auth/login', {
    data: { username: who.username, password: who.password },
  });
  expect(res.ok(), `login ${who.username}: ${res.status()}`).toBeTruthy();
  await page.goto('/');
  await leaveWorld(page);
}

export function nav(page: Page, name: string | RegExp) {
  return page.locator('.sidebar').getByRole('button', { name });
}

/** Opens Admin and one of its tabs. */
export async function adminTab(page: Page, tab: string): Promise<void> {
  if (!(await page.locator('#admin-tab-bar').isVisible())) await nav(page, 'Admin').click();
  const btn = page.locator('#admin-tab-bar').getByRole('button', { name: tab, exact: true });
  await btn.click();
  await expect(btn).toHaveClass(/active/);
}

export function randomHex(n: number): string {
  return randomBytes(n).toString('hex');
}

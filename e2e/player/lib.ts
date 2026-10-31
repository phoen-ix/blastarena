import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';

import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { io, type Socket } from 'socket.io-client';

/* Shared helpers for the player-side specs. Every test owns its data: users get a unique name
 * (uniq()), created verified through the admin API; SQL (docker exec) only where no API exists
 * (the first admin, roles, backdating). Every page a test opens is guarded: a page error or a
 * 5xx response fails the test (see the `guard` fixture and watch()). */

export const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:24200';
export const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:24205';
const PROJECT = process.env.COMPOSE_PROJECT_NAME ?? 'blastarena_e2e';
export const PASSWORD = 'E2ePass-2026';

export function uniq(prefix: string): string {
  return `${prefix}${randomBytes(4).toString('hex')}`.slice(0, 20);
}

/** Runs SQL in the stack's MariaDB container; returns tab-separated rows without headers. */
export function sql(statement: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      `${PROJECT}-db`,
      'mariadb',
      '-ublast_user',
      `-p${process.env.DB_PASSWORD ?? 'e2e-db-not-a-secret'}`,
      '-N',
      'blast_arena',
      '-e',
      statement,
    ],
    { encoding: 'utf8' },
  );
}

/** Login, register and other auth routes allow a few requests per 15 min per IP; the suite
 * signs in far more often from one address. */
export function resetRateLimits(): void {
  execFileSync('docker', [
    'exec',
    `${PROJECT}-redis`,
    'redis-cli',
    'EVAL',
    "for _, k in ipairs(redis.call('KEYS', 'ratelimit:*')) do redis.call('DEL', k) end",
    '0',
  ]);
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
  return { status: res.status, data: (text ? JSON.parse(text) : {}) as T };
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

export interface User {
  id: number;
  username: string;
  email: string;
  token: string;
}

export async function login(username: string, password = PASSWORD): Promise<User> {
  resetRateLimits();
  const data = await ok<{ user: { id: number; email?: string }; accessToken: string }>(
    'POST',
    '/auth/login',
    undefined,
    { username, password },
  );
  return { id: data.user.id, username, email: '', token: data.accessToken };
}

let adminCache: { user: User; at: number } | null = null;

/** The suite's own admin: registered like anyone, then verified and promoted (no API for it).
 * Access tokens live 15 min; a worker re-logs in after 10. */
export async function admin(): Promise<User> {
  if (adminCache && Date.now() - adminCache.at < 600_000) return adminCache.user;
  if (adminCache) {
    adminCache = { user: await login(adminCache.user.username), at: Date.now() };
    return adminCache.user;
  }
  for (let i = 0; ; i++) {
    const res = await fetch(`${BASE}/api/health`).catch(() => null);
    if (res?.ok) break;
    if (i > 60) throw new Error('backend not healthy');
    await new Promise((r) => setTimeout(r, 2000));
  }
  const username = 'e2eAdminA';
  resetRateLimits();
  await api('POST', '/auth/register', undefined, {
    username,
    email: 'e2e-admin-a@blast-e2e.example',
    password: PASSWORD,
  });
  sql(`UPDATE users SET email_verified = TRUE, role = 'admin' WHERE username = '${username}'`);
  adminCache = { user: await login(username), at: Date.now() };
  return adminCache.user;
}

/** A verified account through Admin > Users (role user unless given). */
export async function createUser(
  prefix = 'p',
  role: 'user' | 'moderator' | 'admin' = 'user',
): Promise<User> {
  const a = await admin();
  const username = uniq(prefix);
  const email = `${username.toLowerCase()}@blast-e2e.example`;
  await ok('POST', '/admin/users', a.token, { username, email, password: PASSWORD, role });
  const u = await login(username);
  return { ...u, email };
}

// ---- Mailpit -------------------------------------------------------------------------------

interface MailSummary {
  ID: string;
  Subject: string;
}

/** The newest mail to `to` (optionally whose subject matches), waiting for it to arrive. */
export async function mailTo(
  to: string,
  subject?: RegExp,
): Promise<{ subject: string; text: string }> {
  let found: MailSummary | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
        );
        const { messages } = (await res.json()) as { messages: MailSummary[] };
        found = messages.find((m) => !subject || subject.test(m.Subject));
        return !!found;
      },
      { timeout: 20_000, message: `mail to ${to}` },
    )
    .toBe(true);
  const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${found!.ID}`)).json()) as {
    Subject: string;
    Text: string;
    HTML: string;
  };
  return { subject: msg.Subject, text: `${msg.Text}\n${msg.HTML}` };
}

/** The first link in a mail that points at the app. */
export function linkIn(text: string): string {
  const m = text.match(/https?:\/\/[^\s"'<>]+/g)?.find((u) => u.startsWith(BASE));
  if (!m) throw new Error(`no app link in mail:\n${text}`);
  return m.replace(/&amp;/g, '&');
}

// ---- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ------------------------------------------------

export function totp(secretBase32: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secretBase32.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

// ---- Pages ---------------------------------------------------------------------------------

/** Fails the test on any page error or 5xx response of this page. */
export function watch(page: Page, problems: string[]): void {
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
}

export const test = base.extend<{ guard: string[] }>({
  guard: [
    async ({ context }, use) => {
      const problems: string[] = [];
      for (const p of context.pages()) watch(p, problems);
      context.on('page', (p) => watch(p, problems));
      await use(problems);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

/** A second (third, ...) player: own browser context, guarded like the test's own page. */
export async function newPage(
  browser: Browser,
  guard: string[],
  opts: Parameters<Browser['newContext']>[0] = {},
): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'en-GB',
    timezoneId: 'Europe/Vienna',
    reducedMotion: 'reduce',
    ...opts,
  });
  const page = await ctx.newPage();
  watch(page, guard);
  return page;
}

/** Signs the context in through the API (sets the refresh cookie), so the page's auto-login
 * takes over on the next load. */
export async function signInContext(ctx: BrowserContext, u: User, password = PASSWORD) {
  resetRateLimits();
  const res = await ctx.request.post('/api/auth/login', {
    data: { username: u.username, password },
  });
  expect(res.ok()).toBe(true);
}

/** Landing on the site signed in: the lobby auto-joins the open world first; leave it. */
export async function openLobby(page: Page, u: User): Promise<void> {
  await signInContext(page.context(), u);
  await page.goto('/');
  // Boot, auto-login and the world join take a while on a busy machine.
  await expect(page.locator('.hud-ow-board')).toBeVisible({ timeout: 60_000 });
  await leaveWorld(page);
}

export async function leaveWorld(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.locator('#leave-confirm').click();
  await expect(page.locator('#nav-rooms')).toBeVisible();
}

export async function openView(page: Page, id: string): Promise<void> {
  await page.locator(`#nav-${id}`).click();
  await expect(page.locator(`#nav-${id}`)).toHaveClass(/active/);
}

// ---- Game -------------------------------------------------------------------------------

/** Keys of the running Phaser scenes (e2e build probe, see frontend/src/main.ts). */
export async function scenes(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __e2eScenes(): string[] }).__e2eScenes());
}

export async function expectScene(page: Page, key: string, timeout = 30_000): Promise<void> {
  await expect.poll(() => scenes(page), { timeout, message: `scene ${key}` }).toContain(key);
}

/** Clicks a canvas-drawn button: `dx` from the centre, `up` CSS px above the bottom edge. */
export async function clickCanvas(page: Page, dx: number, up: number): Promise<void> {
  const box = (await page.locator('#game-container > canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height - up);
}

/** Game over screen buttons (GameOverScene: width/2 -/+ 100, height - 40). */
export const gameOver = {
  action: (page: Page) => clickCanvas(page, -100, 40), // Play Again / Vote Rematch / Retry
  back: (page: Page) => clickCanvas(page, 100, 40), // Back to Lobby / Campaign
};

export interface RoomOpts {
  name: string;
  mode?: string;
  maxPlayers?: string;
  roundTime?: string;
  bots?: string;
  difficulty?: string;
}

/** Rooms > Create Room > fill > create; ends in the waiting room. */
export async function createRoom(page: Page, o: RoomOpts): Promise<void> {
  await openView(page, 'rooms');
  await page.locator('#create-room-btn').click();
  await page.getByLabel('Room Name').fill(o.name);
  if (o.mode) await page.getByLabel('Game Mode').selectOption(o.mode);
  if (o.maxPlayers) await page.getByLabel('Max Players').selectOption(o.maxPlayers);
  await page.getByLabel('Match Time').selectOption(o.roundTime ?? '60');
  if (o.bots) await page.getByLabel('Bot Count').selectOption(o.bots);
  if (o.difficulty) await page.getByLabel('Bot Difficulty').selectOption(o.difficulty);
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await expect(page.getByRole('heading', { name: o.name })).toBeVisible();
}

/** Drops a bomb where the player stands and stays put until the player is out (the death
 * banner shows) or the match is over (the HUD is gone). Repeats while the start countdown or
 * spawn protection keep the first bomb from counting. */
export async function selfDestruct(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Space');
    await expect
      .poll(
        async () =>
          (await page.locator('.hud-death-banner').count()) > 0 ||
          !(await scenes(page)).includes('HUDScene'),
        { timeout: 6_000 },
      )
      .toBe(true);
  }).toPass({ timeout: 60_000 });
}

// ---- Sockets (setup only) ----------------------------------------------------------------

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

function emit<T>(s: Socket, event: string, data: unknown): Promise<T> {
  return new Promise((resolve) => s.emit(event, data, resolve));
}

/** Makes two users friends through the same socket events the Friends view uses. */
export async function befriend(a: User, b: User): Promise<void> {
  const [sa, sb] = [await connect(a.token), await connect(b.token)];
  try {
    expect(await emit(sa, 'friend:request', { username: b.username })).toMatchObject({
      success: true,
    });
    expect(await emit(sb, 'friend:accept', { fromUserId: a.id })).toMatchObject({ success: true });
  } finally {
    sa.disconnect();
    sb.disconnect();
  }
}

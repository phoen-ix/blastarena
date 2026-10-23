import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { ADMIN, CHALLENGE, HERO, MAPS, PASSWORD, resetRateLimits, seedDemo } from './seed';

/* The docs tour: one screenshot per screen the README and docs/screenshots/README.md show, taken
 * against the demo data in ./seed.ts. It is also a render check: every test asserts something
 * screen-specific before it shoots, and a page error fails the test. */

const OUT = path.resolve(
  process.env.DOCS_SCREENSHOT_DIR ??
    fileURLToPath(new URL('../../docs/screenshots', import.meta.url)),
);
mkdirSync(OUT, { recursive: true });
const TALL_MAX = 1600;

let pageErrors: Error[] = [];

test.beforeAll(async () => {
  await seedDemo();
});

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e));
  await page.clock.setFixedTime(new Date('2026-06-15T10:00:00+02:00'));
  // Seeded Math.random: particles, shakes and other client-side randomness repeat run to run.
  await page.addInitScript(() => {
    let s = 0x2f6b1d3;
    Math.random = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
});

test.afterEach(() => {
  expect(pageErrors.map((e) => e.message)).toEqual([]);
});

/** `tall`: grow the viewport to the scrolling lobby panel's full height (capped) first - the
 * lobby is a fixed-height layout, so a plain full-page shot would only show the first screen.
 * `freezeTimers`: the lobby's open-world round clock shows a fixed time. */
async function shoot(
  page: Page,
  name: string,
  opts: { tall?: boolean; freezeTimers?: boolean } = {},
): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('#toast-container .toast')).toHaveCount(0, { timeout: 15_000 });
  await page.mouse.move(0, 0);
  const vp = page.viewportSize()!;
  if (opts.tall) {
    const extra = await page.evaluate(() => {
      const body = document.querySelector('.main-body');
      return body ? body.scrollHeight - body.clientHeight : 0;
    });
    if (extra > 0) {
      await page.setViewportSize({
        width: vp.width,
        height: Math.min(TALL_MAX, vp.height + extra),
      });
    }
  }
  if (opts.freezeTimers) {
    // Show a fixed time and detach the element from its 1 s updater (it looks it up by id).
    await page.locator('#ow-timer').evaluate((el) => {
      el.textContent = (el.textContent ?? '').replace(/\d+:\d\d/, '4:00');
      el.removeAttribute('id');
    });
  }
  // A beat for layout and the canvas to settle.
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(OUT, `${name}.png`),
    animations: 'disabled',
    caret: 'hide',
  });
  if (opts.tall) await page.setViewportSize(vp);
}

async function landing(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#menu-login-btn')).toBeVisible();
}

/** Signs in through the login form; the lobby then auto-joins the open world. */
async function signIn(page: Page, username: string): Promise<void> {
  resetRateLimits();
  await landing(page);
  await page.click('#menu-login-btn');
  await page.fill('#login-username', username);
  await page.fill('#login-password', PASSWORD);
  await page.click('#login-btn');
  await expect(page.locator('.hud-ow-board')).toBeVisible();
}

async function leaveWorld(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.click('#leave-confirm');
  await expect(page.locator('#nav-rooms')).toBeVisible();
}

async function lobby(page: Page, username: string): Promise<void> {
  await signIn(page, username);
  await leaveWorld(page);
}

async function openView(page: Page, id: string): Promise<void> {
  await page.click(`#nav-${id}`);
  await expect(page.locator(`#nav-${id}`)).toHaveClass(/active/);
}

/** Clicks a button the fixed lobby-chat panel may cover. */
async function press(page: Page, selector: string): Promise<void> {
  await page.locator(selector).evaluate((el: HTMLElement) => el.click());
}

test('landing', async ({ page }) => {
  await landing(page);
  await expect(page.locator('#menu-guest-btn')).toBeVisible();
  await page.waitForTimeout(1500);
  await shoot(page, 'menu-landing');
});

test('landing (German)', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'de-AT' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e));
  await page.goto('/');
  await expect(page.locator('#menu-login-btn')).toHaveText(/Anmelden/);
  await page.waitForTimeout(1500);
  await shoot(page, 'menu-landing.de');
  await ctx.close();
});

test('login and register forms', async ({ page }) => {
  await landing(page);
  await page.click('#menu-login-btn');
  await expect(page.locator('#login-username')).toBeVisible();
  await shoot(page, 'auth-login');
  await page.fill('#login-username', HERO.username);
  await page.fill('#login-password', 'not-the-password');
  await page.click('#login-btn');
  await expect(page.locator('#login-error')).not.toBeEmpty();
  await shoot(page, 'auth-login-error');
  await page.click('#switch-register');
  await expect(page.locator('#reg-btn')).toBeVisible();
  await shoot(page, 'auth-register');
});

test('open world as a guest', async ({ page }) => {
  await landing(page);
  await page.click('#menu-guest-btn');
  await expect(page.locator('.hud-auth-bar')).toBeVisible();
  await expect(page.locator('.hud-ow-board')).toBeVisible();
  // The first game key docks the landing title; the guest takes a step.
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2000);
  await shoot(page, 'openworld-guest');
});

test('lobby: open world and rooms', async ({ page }) => {
  await lobby(page, HERO.username);
  await expect(page.locator('#ow-join-btn')).toBeVisible();
  await shoot(page, 'lobby-openworld', { freezeTimers: true });
  await openView(page, 'rooms');
  await expect(page.locator('#room-list')).toBeVisible();
  await shoot(page, 'lobby-rooms');
});

test('campaign, maps and challenge', async ({ page }) => {
  await lobby(page, HERO.username);
  await openView(page, 'campaign');
  await page.locator('.campaign-world-header', { hasText: 'Training Grounds' }).click();
  await expect(page.locator('.campaign-level-card').first()).toBeVisible();
  await page.locator('.campaign-level-card').first().click();
  await shoot(page, 'campaign-worlds');

  await openView(page, 'maps');
  await expect(page.getByText(MAPS.vault)).toBeVisible();
  await shoot(page, 'maps-mine');

  await openView(page, 'challenge');
  await expect(page.getByText(CHALLENGE)).toBeVisible();
  await shoot(page, 'lobby-challenge', { tall: true });
});

test('social views', async ({ page }) => {
  await lobby(page, HERO.username);
  await openView(page, 'friends');
  await expect(page.getByText('JonasKeller')).toBeVisible();
  await shoot(page, 'social-friends');
  await page.click('.tab-item[data-tab="requests"]');
  await expect(page.getByText('NoraPixel')).toBeVisible();
  await shoot(page, 'social-friend-requests');

  await openView(page, 'messages');
  await page.locator('.messages-conv-item', { hasText: 'JonasKeller' }).click();
  await expect(page.locator('.messages-msg-bubble')).toHaveCount(4);
  await shoot(page, 'social-messages');

  await openView(page, 'party');
  await expect(page.locator('#party-create-btn')).toBeVisible();
  await page.click('#party-create-btn');
  await expect(page.locator('.party-member-card')).toHaveCount(1);
  await shoot(page, 'social-party');
  await page.click('#party-page-disband');
  await expect(page.locator('#party-create-btn')).toBeVisible();
});

test('progress views', async ({ page }) => {
  await lobby(page, HERO.username);
  await openView(page, 'leaderboard');
  await expect(page.getByText('NoraPixel')).toBeVisible();
  await shoot(page, 'stats-leaderboard');

  await openView(page, 'matchHistory');
  await expect(page.getByText(/King of the Hill/i).first()).toBeVisible();
  await shoot(page, 'stats-match-history');

  await page.click('#sidebar-user-profile');
  await expect(page.getByText('Platinum').first()).toBeVisible();
  await shoot(page, 'stats-profile', { tall: true });
});

test('settings and help', async ({ page }) => {
  await lobby(page, HERO.username);
  await openView(page, 'settings');
  for (const tab of ['account', 'preferences', 'privacy', 'cosmetics']) {
    await page.click(`#settings-tab-bar [data-tab="${tab}"]`);
    await expect(page.locator(`#settings-tab-bar [data-tab="${tab}"]`)).toHaveClass(/active/);
    await page.waitForTimeout(800);
    await shoot(page, `settings-${tab}`, { tall: true });
  }
  await openView(page, 'help');
  for (const tab of ['getting-started', 'power-ups', 'map-features']) {
    await page.click(`.admin-tab[data-tab="${tab}"]`);
    await expect(page.locator(`.admin-tab[data-tab="${tab}"]`)).toHaveClass(/active/);
    await page.waitForTimeout(800);
    await shoot(page, `help-${tab}`, { tall: true });
  }
});

test('admin tabs', async ({ page }) => {
  test.setTimeout(300_000);
  await lobby(page, ADMIN.username);
  await openView(page, 'admin');
  const tabs = page.locator('#admin-tab-bar [data-tab]');
  await expect(tabs).toHaveCount(12);
  for (const id of await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('data-tab')!))) {
    await page.click(`#admin-tab-bar [data-tab="${id}"]`);
    await expect(page.locator(`#admin-tab-bar [data-tab="${id}"]`)).toHaveClass(/active/);
    await page.waitForTimeout(1500);
    await shoot(page, `admin-${id}`);
    if (id === 'users') {
      await page.click('#admin-create-user');
      await expect(page.locator('[role="dialog"]')).toBeVisible();
      await shoot(page, 'admin-users-create');
      await page.keyboard.press('Escape');
    }
    if (id === 'campaign') {
      await page.click('#camp-view-enemies');
      await page.waitForTimeout(1500);
      await shoot(page, 'admin-campaign-enemies');
    }
  }
});

test('level editor', async ({ page }) => {
  await lobby(page, HERO.username);
  await openView(page, 'maps');
  await page.locator('tr', { hasText: MAPS.courtyard }).locator('.map-edit').click();
  await expect(page.locator('#level-editor-ui')).toBeVisible();
  await page.waitForTimeout(1500);
  await shoot(page, 'editor-map');
});

test('lobby in a light theme', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('blast-arena-theme', 'daylight'));
  await lobby(page, HERO.username);
  await openView(page, 'leaderboard');
  await expect(page.getByText('NoraPixel')).toBeVisible();
  await shoot(page, 'stats-leaderboard.light');
});

// A render check only.
test('campaign level', async ({ page }) => {
  await lobby(page, HERO.username);
  await openView(page, 'campaign');
  await page.locator('.campaign-world-header', { hasText: 'Training Grounds' }).click();
  await page.locator('.campaign-level-card').first().click();
  await page.locator('.campaign-level-card .btn-primary', { hasText: 'Start' }).click();
  await expect(page.locator('.hud-campaign')).toBeVisible();
  // Pause as soon as the game allows it (when the countdown ends).
  // One Escape per attempt - a second one while paused would resume.
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(page.locator('.pause-overlay')).toBeVisible({ timeout: 250 });
  }).toPass({ timeout: 30_000, intervals: [50] });
  await expect(page.locator('.pause-overlay')).toContainText('Restart Level');
  // Not shot: the paused level is blurred, and the player's spawn-protection blink differs per run.
});

// Last: it adds a real match to the history the admin and progress shots show.
test('create room and play a match', async ({ page }) => {
  test.setTimeout(300_000);
  await lobby(page, HERO.username);
  await openView(page, 'rooms');
  await page.click('#create-room-btn');
  await expect(page.locator('#cr-submit')).toBeVisible();
  await page.fill('#cr-name', 'Friday Night Blast');
  await page.selectOption('#cr-round-time', '60');
  await page.selectOption('#cr-bots', '3');
  const courtyard = page.locator('#cr-custom-map option', { hasText: MAPS.courtyard });
  await page.selectOption('#cr-custom-map', (await courtyard.getAttribute('value'))!);
  await expect(page.locator('#cr-map-preview')).toBeVisible();
  await shoot(page, 'lobby-create-room', { tall: true });
  await press(page, '#cr-submit');
  await expect(page.locator('#room-player-list')).toBeVisible();
  // The room code is random; show a fixed one.
  await page
    .locator('span', { hasText: 'Room Code' })
    .locator('strong')
    .evaluate((el) => {
      el.textContent = 'K7Q2WD';
    });
  await shoot(page, 'room-waiting');
  await press(page, '[data-action="start"]');
  await expect(page.locator('.hud-players')).toBeVisible();
  await page.waitForTimeout(12_000);
  await shoot(page, 'game-match');
  // Round time 60 s: the match ends on the clock if the bots do not finish it first.
  await expect(page.locator('.hud-container')).toHaveCount(0, { timeout: 120_000 });
  await page.waitForTimeout(2500);
  await shoot(page, 'game-over');
});

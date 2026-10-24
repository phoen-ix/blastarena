import type { Locator, Page } from '@playwright/test';

import { test, expect, createUser, openLobby, openView, leaveWorld } from './lib';

/* Breadth: every lobby view as every role it is offered to. Each visit asserts the view's own
 * content (not just the nav highlight); the guard fixture fails on any page error or 5xx. */

const VIEWS: Record<string, (p: Page) => Locator> = {
  openWorld: (p) => p.getByRole('button', { name: 'Join World' }),
  rooms: (p) => p.locator('#room-list'),
  campaign: (p) => p.locator('.campaign-world-header').first(),
  maps: (p) => p.getByRole('heading', { name: 'No Maps Yet' }),
  challenge: (p) => p.getByText(/No active challenge right now|Play Challenge/),
  friends: (p) => p.getByRole('textbox', { name: /username/i }),
  messages: (p) => p.getByText('Conversations', { exact: true }),
  party: (p) => p.getByRole('heading', { name: 'No Active Party' }),
  leaderboard: (p) =>
    p.locator('#lb-table-container table, #lb-table-container :text("No entries")'),
  matchHistory: (p) => p.getByText('No matches played yet. Get out there!'),
  settings: (p) => p.locator('#settings-tab-bar'),
  help: (p) => p.locator('#help-tab-bar'),
};
const GUEST_VIEWS = ['openWorld', 'rooms', 'settings', 'help'];
const STAFF_ONLY = ['admin'];

async function visitAll(page: Page, views: string[]): Promise<void> {
  for (const id of views) {
    await openView(page, id);
    await expect(VIEWS[id](page), `view ${id}`).toBeVisible();
  }
}

for (const role of ['user', 'moderator', 'admin'] as const) {
  test(`every lobby view renders for ${role === 'admin' ? 'an' : 'a'} ${role}`, async ({
    page,
  }) => {
    const u = await createUser(role.slice(0, 3), role);
    await openLobby(page, u);
    await visitAll(page, Object.keys(VIEWS));

    // Views reached from inside other views.
    await page.locator('#sidebar-user-profile').click();
    await expect(page.locator('.profile-page')).toContainText(u.username);
    await expect(page.locator('.profile-page')).toContainText('Statistics');
    await openView(page, 'rooms');
    await page.locator('#create-room-btn').click();
    await expect(page.locator('#cr-submit')).toBeVisible();

    const admin = page.locator('#nav-admin');
    if (role === 'user') {
      await expect(admin).toHaveCount(0);
    } else {
      // Its tabs are the admin suite's business; here only that staff get the entry.
      await openView(page, STAFF_ONLY[0]);
      await expect(page.locator('#admin-tab-bar')).toBeVisible();
    }
  });
}

test('every lobby view renders for a guest', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play as Guest' }).click();
  await expect(page.locator('.hud-auth-bar')).toBeVisible();
  await leaveWorld(page);
  await visitAll(page, GUEST_VIEWS);
  for (const id of Object.keys(VIEWS).filter((v) => !GUEST_VIEWS.includes(v))) {
    await expect(page.locator(`#nav-${id}`), `guest has no ${id}`).toHaveCount(0);
  }
  await expect(page.locator('#sidebar-user-profile')).toHaveCount(0);
});

test('an unknown path falls back to the landing page', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  const res = await page.request.get('/api/no-such-endpoint');
  expect(res.status()).toBe(404);
});

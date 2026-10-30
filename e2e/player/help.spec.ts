import type { Page } from '@playwright/test';

import { test, expect, admin, createUser, ok, openLobby, openView } from './lib';

/* In-game Help: every tab renders, the guides load their Markdown from /api/docs, staff get the
 * level-editor and staff-docs tabs (players do not, and the staff docs API refuses them), and the
 * imprint tab appears once an admin turns it on. */

const PLAYER_TABS = ['getting-started', 'power-ups', 'game-modes', 'map-features', 'guides'];
const STAFF_TABS = ['level-editor', 'admin-docs'];

async function helpTab(page: Page, id: string): Promise<void> {
  await page.locator(`#help-tab-bar [data-tab="${id}"]`).click();
  await expect(page.locator(`#help-tab-bar [data-tab="${id}"]`)).toHaveClass(/active/);
  await expect(page.locator('#help-tab-content')).not.toBeEmpty();
  await expect(page.locator('#help-tab-content .help-status-error')).toHaveCount(0);
}

test('a player gets every player tab and the guides load', async ({ page }) => {
  const u = await createUser('hlp');
  await openLobby(page, u);
  await openView(page, 'help');
  for (const id of PLAYER_TABS) await helpTab(page, id);
  for (const id of STAFF_TABS) {
    await expect(page.locator(`#help-tab-bar [data-tab="${id}"]`)).toHaveCount(0);
  }
  // Guides: each section expands into rendered Markdown.
  const guides = page.locator('.help-guide-section');
  await expect(guides).toHaveCount(4);
  await guides.first().locator('summary').click();
  await expect(
    guides.first().locator('.help-markdown h1, .help-markdown h2').first(),
  ).toBeVisible();
  await expect(page.locator('.help-status')).toHaveCount(0);

  const staffDoc = await page.request.get('/api/docs/admin/testing.md', {
    headers: { Authorization: `Bearer ${u.token}` },
  });
  expect(staffDoc.status()).toBe(403);
});

test('staff get the level-editor and staff-docs tabs', async ({ page }) => {
  const mod = await createUser('hlm', 'moderator');
  await openLobby(page, mod);
  await openView(page, 'help');
  for (const id of [...PLAYER_TABS, ...STAFF_TABS]) await helpTab(page, id);
  await expect(page.locator('#help-tab-content')).toContainText(/API|Admin|Infrastructure/);
});

test('the imprint tab shows the text an admin set', { tag: '@global' }, async ({ page }) => {
  const a = await admin();
  await ok('PUT', '/admin/settings/imprint', a.token, {
    enabled: true,
    text: 'BlastArena e2e imprint\nExample Street 1',
  });
  const u = await createUser('imp');
  await openLobby(page, u);
  await openView(page, 'help');
  await page.locator('#help-tab-bar [data-tab="imprint"]').click();
  await expect(page.locator('#help-tab-content')).toContainText('BlastArena e2e imprint');
});

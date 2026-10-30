import type { Page } from '@playwright/test';

import {
  test,
  expect,
  admin,
  befriend,
  clickCanvas,
  createUser,
  expectScene,
  newPage,
  ok,
  openLobby,
  openView,
  uniq,
} from './lib';

/* Campaign: worlds and levels in the lobby, a solo level (HUD, pause menu, restart, exit), a
 * level played to completion (a seeded two-level world: survive 3 s), progress unlocking the next
 * level, local co-op and buddy setup, and online co-op for a party of two. */

/** Odd-sized open arena: border walls and the pillar grid. */
function arena(n: number): string[][] {
  return Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) =>
      x === 0 || y === 0 || x === n - 1 || y === n - 1 || (x % 2 === 0 && y % 2 === 0)
        ? 'wall'
        : 'empty',
    ),
  );
}

/** A published world of two short "survive" levels, owned by this test. */
async function seedWorld(): Promise<{ world: string; first: string; second: string }> {
  const a = await admin();
  const name = uniq('E2E World ');
  const [first, second] = [uniq('Warm-up '), uniq('Cool-down ')];
  const w = await ok<{ id: number }>('POST', '/admin/campaign/worlds', a.token, {
    name,
    description: 'Two quick levels for the e2e suite.',
  });
  await ok('PUT', `/admin/campaign/worlds/${w.id}`, a.token, { isPublished: true });
  for (const level of [first, second]) {
    await ok('POST', '/admin/campaign/levels', a.token, {
      worldId: w.id,
      name: level,
      description: 'Survive three seconds.',
      mapWidth: 9,
      mapHeight: 9,
      tiles: arena(9),
      fillMode: 'handcrafted',
      playerSpawns: [{ x: 1, y: 1 }],
      enemyPlacements: [],
      powerupPlacements: [],
      winCondition: 'survive_time',
      winConditionConfig: { surviveTimeTicks: 60 },
      lives: 3,
      timeLimit: 0,
      isPublished: true,
    });
  }
  return { world: name, first, second };
}

async function openWorld(page: Page, world: string): Promise<void> {
  await openView(page, 'campaign');
  await page.locator('.campaign-world-header', { hasText: world }).click();
  await expect(page.locator('.campaign-level-card:visible').first()).toBeVisible();
}

const level = (page: Page, name: string) => page.locator('.campaign-level-card', { hasText: name });

/** Escape during the start countdown does nothing; retry until the pause menu shows. A second
 * Escape while the server's pause ack is on its way would resume, so press only while it is not
 * shown. */
async function pause(page: Page): Promise<void> {
  const overlay = page.locator('.pause-overlay');
  await expect(async () => {
    if (!(await overlay.isVisible())) await page.keyboard.press('Escape');
    await expect(overlay).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test('solo level: HUD, pause, continue, restart, exit', async ({ page }) => {
  const u = await createUser('cmp');
  await openLobby(page, u);
  await openWorld(page, 'Training Grounds');
  await page.locator('.campaign-level-card:visible').first().click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.hud-campaign')).toBeVisible();
  await expect(page.locator('#campaign-lives')).toBeVisible();
  await expect(page.locator('#campaign-enemies')).toBeVisible();
  await page.keyboard.press('ArrowRight');

  await pause(page);
  await expect(page.getByRole('heading', { name: 'PAUSED' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.pause-overlay')).toHaveCount(0);

  await pause(page);
  await page.getByRole('button', { name: 'Restart Level' }).click();
  await expect(page.locator('.pause-overlay')).toHaveCount(0);
  await expect(page.locator('.hud-campaign')).toBeVisible();

  await pause(page);
  await page.getByRole('button', { name: 'Exit Level' }).click();
  await expect(page.locator('.campaign-world-header').first()).toBeVisible();
});

test('a completed level unlocks the next one', async ({ page }) => {
  test.setTimeout(180_000);
  const { world, first, second } = await seedWorld();
  const u = await createUser('cmw');
  await openLobby(page, u);
  await openWorld(page, world);
  await expect(level(page, first)).toBeVisible();
  // The second level is locked until the first is done: no Start button on it.
  await level(page, second).click();
  await expect(level(page, second).getByRole('button', { name: 'Start' })).toHaveCount(0);

  await level(page, first).click();
  await level(page, first).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.hud-campaign')).toBeVisible();
  // Survive 3 s: the results screen (canvas) follows.
  await expectScene(page, 'GameOverScene', 60_000);
  // Campaign (right-hand button; with a next level the buttons sit at -160 / 0 / +160).
  await expect(async () => {
    await clickCanvas(page, 160, 40);
    await expect(page.locator('.campaign-world-header').first()).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });

  await openWorld(page, world);
  await expect(page.locator('.campaign-world-header', { hasText: world })).toContainText('1/2');
  await level(page, second).click();
  await expect(
    level(page, second).getByRole('button', { name: 'Start', exact: true }),
  ).toBeVisible();
});

test('local co-op and buddy setup start a level', async ({ page }) => {
  const u = await createUser('lco');
  await openLobby(page, u);
  await openWorld(page, 'Training Grounds');
  await page.locator('.campaign-level-card:visible').first().click();

  await page.getByRole('button', { name: 'Local Co-op', exact: true }).click();
  const coop = page.getByRole('dialog', { name: 'Local Co-Op Setup' });
  await expect(coop).toBeVisible();
  await coop.getByRole('button', { name: 'Cancel' }).click();
  await expect(coop).toHaveCount(0);
  await page.getByRole('button', { name: 'Local Co-op', exact: true }).click();
  await coop.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.hud-campaign')).toBeVisible();
  await expectScene(page, 'GameScene');
  await pause(page);
  await page.getByRole('button', { name: 'Exit Level' }).click();
  await expect(page.locator('.campaign-world-header').first()).toBeVisible();

  await openWorld(page, 'Training Grounds');
  await page.locator('.campaign-level-card:visible').first().click();
  await page.getByRole('button', { name: 'Buddy', exact: true }).click();
  const buddy = page.getByRole('dialog');
  await expect(buddy).toBeVisible();
  await buddy.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.hud-campaign')).toBeVisible();
  await pause(page);
  await page.getByRole('button', { name: 'Exit Level' }).click();
  await expect(page.locator('.campaign-world-header').first()).toBeVisible();
});

test('online co-op: a party of two plays a level together', async ({ page, browser, guard }) => {
  const [lead, mate] = [await createUser('col'), await createUser('com')];
  await befriend(lead, mate);
  const pageB = await newPage(browser, guard);
  await openLobby(page, lead);
  await openLobby(pageB, mate);
  await openView(page, 'party');
  await page.getByRole('button', { name: 'Create Party' }).click();
  await page.getByRole('button', { name: '+ Invite Friend' }).click();
  await page
    .locator('.party-invite-item', { hasText: mate.username })
    .getByRole('button', { name: 'Invite Friend' })
    .click();
  await page.keyboard.press('Escape');
  await pageB.locator('.invite-toast').getByRole('button', { name: 'Accept' }).click();
  await expect(page.locator('.party-member-card')).toHaveCount(2);

  await openWorld(page, 'Training Grounds');
  await page.locator('.campaign-level-card:visible').first().click();
  await page.getByRole('button', { name: 'Co-op', exact: true }).click();
  for (const p of [page, pageB]) {
    await expect(p.locator('.hud-campaign')).toBeVisible();
    await expect(p.locator('#campaign-coop-status')).toBeVisible();
  }
  // The partner's pause menu has no Restart (only the leader restarts).
  await pause(pageB);
  await expect(pageB.getByRole('button', { name: 'Restart Level' })).toHaveCount(0);
  await pageB.getByRole('button', { name: 'Continue' }).click();
  await pageB.context().close();
});

import { readFileSync } from 'node:fs';

import { io } from 'socket.io-client';

import {
  adminSession,
  adminTab,
  BASE,
  createUser,
  expect,
  expectReplay,
  lobby,
  ok,
  test,
  token,
  uid,
} from './support';
import type { Page } from '@playwright/test';

/* Admin > Campaign: worlds (create, edit, publish, delete), levels built in the level editor
 * (campaign tools and theme hazards, settings, save, export, back to the tab, publish, the row's
 * export and bundle, import, reorder, delete), enemy types
 * and the replays view (a run a player lost: watch it, delete it). */

const TILE = 48;
const HAZARDS = {
  vine: 'Vine',
  quicksand: 'Quicksand',
  ice: 'Ice',
  lava: 'Lava',
  mud: 'Mud',
  spikes: 'Spikes',
  dark_rift: 'Dark Rift',
};
const TOOLBAR = 200;

const toast = (page: Page, text: string | RegExp) =>
  expect(page.locator('.toast').filter({ hasText: text }).first()).toBeVisible();
const editor = (page: Page) => page.locator('#level-editor-ui');

async function paint(page: Page, size: [number, number], x: number, y: number): Promise<void> {
  const box = (await page.locator('#game-container canvas').boundingBox())!;
  const cx = box.x + TOOLBAR + (box.width - TOOLBAR) / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx + (x + 0.5 - size[0] / 2) * TILE, cy + (y + 0.5 - size[1] / 2) * TILE);
}

async function campaign(page: Page): Promise<void> {
  await lobby(page, await createUser('admin', 'a'));
  await adminTab(page, 'Campaign');
  await expect(page.getByRole('heading', { name: 'Campaign Manager' })).toBeVisible();
}

async function deleteNamed(page: Page, entity: string, name: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: `Delete ${entity}` });
  await expect(dialog.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Type name to confirm deletion' }).fill(name);
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await toast(page, `${entity} deleted`);
}

test('worlds: create, edit, reorder, publish, delete', async ({ page }) => {
  // Another world first, so the new one has a place to move to.
  const { token } = await adminSession();
  await ok('POST', '/admin/campaign/worlds', token, { name: `Anchor ${uid()}`, theme: 'classic' });
  await campaign(page);
  await page.getByRole('button', { name: 'Create World' }).click();
  const modal = page.getByRole('dialog', { name: 'Create World' });
  await modal.getByRole('button', { name: 'Create' }).click();
  await toast(page, 'Name is required');
  const name = `Ember Caves ${uid()}`;
  await modal.getByLabel('Name *').fill(name);
  await modal.getByLabel('Description').fill('Lava and crates');
  await modal.getByLabel('Theme').selectOption('volcano');
  await modal.getByRole('button', { name: 'Create' }).click();
  await toast(page, 'World created');

  const row = page.locator('.camp-world-row').filter({ hasText: name });
  await expect(row).toContainText('Draft');
  // The newest world is last: move it up one place.
  const order = async () =>
    (
      await page
        .locator('.camp-world-row')
        .evaluateAll((els) => els.map((e) => e.textContent ?? ''))
    ).findIndex((text) => text.includes(name));
  const before = await order();
  await row.getByRole('button', { name: 'Move up' }).click();
  await expect.poll(order).toBe(before - 1);
  await row.getByRole('button', { name: 'Move down' }).click();
  await expect.poll(order).toBe(before);
  await row.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit World' });
  await edit.getByLabel('Name *').fill(`${name} II`);
  await edit.getByRole('button', { name: 'Save' }).click();
  await toast(page, 'World updated');
  const renamed = page.locator('.camp-world-row').filter({ hasText: `${name} II` });
  await renamed.getByRole('button', { name: 'Publish' }).click();
  await toast(page, 'World published');
  await expect(renamed).toContainText('Published');
  await renamed.getByRole('button', { name: 'Delete' }).click();
  await deleteNamed(page, 'World', `${name} II`);
  await expect(renamed).toHaveCount(0);
});

test('levels: build one in the editor, export, import, publish, delete', async ({ page }) => {
  const { token } = await adminSession();
  const worldName = `Training ${uid()}`;
  await ok('POST', '/admin/campaign/worlds', token, {
    name: worldName,
    description: '',
    theme: 'classic',
  });
  await campaign(page);
  const world = page.locator('.camp-world-row').filter({ hasText: worldName });
  await world.click();
  const levels = page.locator(
    `.camp-levels-container[data-world-id="${await world.getAttribute('data-world-id')}"]`,
  );
  await levels.getByRole('button', { name: 'Add Level' }).click();
  await toast(page, 'Level created');

  // The level editor, with the campaign-only tools.
  await expect(editor(page).getByRole('heading', { name: 'Level Editor' })).toBeVisible();
  const size: [number, number] = [15, 13];
  await editor(page).getByRole('button', { name: 'Exit', exact: true }).click();
  await paint(page, size, 13, 11);
  await editor(page).getByRole('button', { name: 'bomb up', exact: true }).click();
  await paint(page, size, 3, 1);
  const enemies = editor(page)
    .locator('div', { hasText: /^Enemies$/ })
    .locator('xpath=following-sibling::button');
  await enemies.first().click();
  await paint(page, size, 7, 7);
  await editor(page).getByRole('button', { name: 'Goal', exact: true }).click();
  await paint(page, size, 11, 1);
  // Puzzle: a blue pressure switch, a blue gate, a crumbling floor.
  await editor(page).getByRole('button', { name: 'blue', exact: true }).click();
  await editor(page).getByRole('button', { name: 'Pressure', exact: true }).click();
  await editor(page).getByRole('button', { name: 'Switch', exact: true }).click();
  await paint(page, size, 5, 5);
  await editor(page).getByRole('button', { name: 'Gate', exact: true }).click();
  await paint(page, size, 9, 5);
  await editor(page).getByRole('button', { name: 'Crumbling Floor', exact: true }).click();
  await paint(page, size, 3, 3);
  // Theme Hazards: a classic world has none of its own; "Show all themes" offers all seven.
  await expect(editor(page)).toContainText('No hazard tiles for this theme');
  await editor(page).getByLabel('Show all themes').check();
  for (const [i, name] of Object.values(HAZARDS).entries()) {
    await editor(page).getByRole('button', { name, exact: true }).click();
    await paint(page, size, 1 + 2 * i, 9);
  }
  const levelName = `Gate ${uid()}`;
  await editor(page).getByLabel('Name').fill(levelName);
  await editor(page).getByLabel('Lives').fill('5');
  await editor(page).getByLabel('Win Condition').selectOption('find_exit');
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Level saved!')).toBeVisible();

  const download = page.waitForEvent('download');
  await editor(page).getByRole('button', { name: 'Export', exact: true }).click();
  const exported = await (await download).path();
  const data = JSON.parse(readFileSync(exported, 'utf8'));
  expect(data._format).toBe('blast-arena-level');
  expect(data.name).toBe(levelName);
  expect(data.lives).toBe(5);
  expect(data.winCondition).toBe('find_exit');
  expect(data.tiles[11][13]).toBe('exit');
  expect(data.tiles[1][11]).toBe('goal');
  expect(data.tiles[5][5]).toBe('switch_blue');
  expect(data.tiles[5][9]).toBe('gate_blue');
  expect(data.tiles[3][3]).toBe('crumbling');
  expect(Object.keys(HAZARDS).map((_, i) => data.tiles[9][1 + 2 * i])).toEqual(
    Object.keys(HAZARDS),
  );
  expect(data.puzzleConfig).toEqual({ switchVariants: { '5,5': 'pressure' } });
  expect(data.enemyPlacements).toHaveLength(1);
  expect(data.powerupPlacements).toEqual([
    expect.objectContaining({ type: 'bomb_up', x: 3, y: 1 }),
  ]);

  // Back returns to the Campaign tab.
  await editor(page).getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.locator('#admin-tab-bar').getByRole('button', { name: 'Campaign' }),
  ).toHaveClass(/active/);
  await world.click();
  const level = levels.getByRole('row').filter({ hasText: levelName });
  await expect(level).toContainText('Find Exit');
  await level.getByRole('button', { name: 'Publish' }).click();
  await toast(page, 'Level published');
  // The row's Export and Bundle (level + its enemy types) download from the server.
  for (const [button, format] of [
    ['Export', 'blast-arena-level'],
    ['Bundle', 'blast-arena-level-bundle'],
  ]) {
    const file = page.waitForEvent('download');
    await level.getByRole('button', { name: button, exact: true }).click();
    expect(JSON.parse(readFileSync(await (await file).path(), 'utf8'))._format).toBe(format);
  }

  // Import the exported file as a second level.
  await levels.getByRole('button', { name: 'Import Level' }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import Level' });
  await importDialog.locator('input[type=file]').setInputFiles(exported);
  await expect(importDialog).toContainText(`Level detected: "${levelName}"`);
  await importDialog.getByRole('button', { name: 'Import' }).click();
  await toast(page, 'Level imported successfully');
  await expect(levels.getByRole('row').filter({ hasText: levelName })).toHaveCount(2);

  // Reorder: the second level moves up.
  const rows = levels.locator('tr[data-level-id]');
  const [first, second] = await rows.evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-level-id')),
  );
  await rows.nth(1).getByRole('button', { name: 'Move up' }).click();
  await expect(rows.first()).toHaveAttribute('data-level-id', second!);
  await expect(rows.nth(1)).toHaveAttribute('data-level-id', first!);

  // Delete asks through the browser's own confirm (worlds use a typed-name dialog).
  page.once('dialog', (d) => {
    expect(d.message()).toBe(`Delete level "${levelName}"?`);
    void d.accept();
  });
  await level.first().getByRole('button', { name: 'Delete' }).click();
  await toast(page, 'Level deleted');
  await expect(levels.getByRole('row').filter({ hasText: levelName })).toHaveCount(1);
});

test('enemy types: create, edit, export, delete, import, and the replays view', async ({
  page,
}) => {
  await campaign(page);
  await page.getByRole('button', { name: 'Enemy Types' }).click();
  await page.getByRole('button', { name: 'Create Enemy Type' }).click();
  const modal = page.getByRole('dialog', { name: 'Create Enemy Type' });
  const name = `Slime ${uid()}`;
  await modal.getByLabel('Name *').fill(name);
  await modal.getByLabel('HP').fill('3');
  await modal.getByLabel('Boss').check();
  await modal.getByRole('button', { name: 'Create' }).click();
  await toast(page, 'Enemy type created');
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText('Boss');
  await row.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Enemy Type' });
  await edit.getByLabel('HP').fill('4');
  await edit.getByRole('button', { name: 'Save' }).click();
  await toast(page, 'Enemy type updated');
  await expect(row).toContainText('4');
  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Export' }).click();
  const file = await (await download).path();
  await row.getByRole('button', { name: 'Delete' }).click();
  await deleteNamed(page, 'Enemy Type', name);
  await expect(row).toHaveCount(0);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import Enemy Type' }).click();
  await (await chooser).setFiles(file);
  await toast(page, 'Enemy type imported');
  await expect(row).toContainText('Boss');

  await page.getByRole('button', { name: 'Replays' }).click();
  await expect(page.locator('#camp-content')).toContainText(/campaign replays?/i);
});

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

test('campaign replays: a lost run is listed, watched and deleted', async ({ page }) => {
  // A published level nobody can win (find the exit, there is none) that times out after 1 s.
  const { token: adminToken } = await adminSession();
  const world = await ok<{ id: number }>('POST', '/admin/campaign/worlds', adminToken, {
    name: `Replay World ${uid()}`,
    theme: 'classic',
  });
  // campaign:start refuses a level whose world is unpublished.
  await ok('PUT', `/admin/campaign/worlds/${world.id}`, adminToken, { isPublished: true });
  const levelName = `Timeout ${uid()}`;
  const level = await ok<{ id: number }>('POST', '/admin/campaign/levels', adminToken, {
    worldId: world.id,
    name: levelName,
    mapWidth: 9,
    mapHeight: 9,
    tiles: arena(9),
    playerSpawns: [{ x: 1, y: 1 }],
    winCondition: 'find_exit',
    lives: 1,
    timeLimit: 1,
    isPublished: true,
  });

  // A player plays it over Socket.io and runs out of time: the run is recorded.
  const player = await createUser();
  const socket = io(BASE, {
    auth: { token: await token(player.username) },
    transports: ['websocket'],
  });
  try {
    const over = new Promise<{ reason: string }>((r) => socket.once('campaign:gameOver', r));
    const started = await new Promise<{ success: boolean; error?: string }>((r) =>
      socket.emit('campaign:start', { levelId: level.id }, r),
    );
    expect(started.error).toBeUndefined();
    expect((await over).reason).toBe("Time's up!");
  } finally {
    socket.disconnect();
  }

  await campaign(page);
  await page.getByRole('button', { name: 'Replays' }).click();
  const row = page.getByRole('row').filter({ hasText: levelName });
  await expect(row).toContainText(player.username);
  await expect(row).toContainText('Failed');

  // Watch it, then Back returns to the replays list.
  await row.getByRole('button', { name: 'Watch' }).click();
  await expectReplay(page);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.locator('#admin-tab-bar').getByRole('button', { name: 'Campaign' }),
  ).toHaveClass(/active/);
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete Replay' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await toast(page, 'Campaign replay deleted');
  await expect(row).toHaveCount(0);
});

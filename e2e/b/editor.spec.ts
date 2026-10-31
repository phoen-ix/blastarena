import { createUser, expect, lobby, nav, ok, test, token, uid, type Account } from './support';
import type { Page } from '@playwright/test';

/* The map editor (My Maps > Create / Edit): tools painted on the canvas, the spawn rule, undo and
 * redo, resizing, name/description/published, saving, and the unsaved-changes dialog. What the
 * editor saved is read back through the API. */

const TILE = 48;
const TOOLBAR = 200;

interface MapRow {
  id: number;
  name: string;
  description: string;
  mapWidth: number;
  mapHeight: number;
  isPublished: boolean;
  tiles: string[][];
}

const editor = (page: Page) => page.locator('#level-editor-ui');

/** Clicks the centre of tile (x, y) of a w x h map: the camera centres the map right of the
 * 200 px toolbar, one world pixel per CSS pixel. */
async function paint(page: Page, size: [number, number], x: number, y: number): Promise<void> {
  const box = (await page.locator('#game-container canvas').boundingBox())!;
  const cx = box.x + TOOLBAR + (box.width - TOOLBAR) / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx + (x + 0.5 - size[0] / 2) * TILE, cy + (y + 0.5 - size[1] / 2) * TILE);
}

/** Ctrl+<key> as a quick tap sends it: Ctrl down, key down, key up, Ctrl up in one task, so all
 * four land in one frame (Phaser replays that frame's key queue on every later key event: the
 * editor used to undo or redo two or three steps per press), then a game step passes. */
async function shortcut(page: Page, key: 'z' | 'y'): Promise<void> {
  await page.evaluate((k) => {
    const code = k.toUpperCase().charCodeAt(0);
    const fire = (type: string, key: string, keyCode: number, ctrlKey: boolean) =>
      window.dispatchEvent(new KeyboardEvent(type, { key, keyCode, ctrlKey, bubbles: true }));
    fire('keydown', 'Control', 17, true);
    fire('keydown', k, code, true);
    fire('keyup', k, code, true);
    fire('keyup', 'Control', 17, false);
  }, key);
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

const tool = (page: Page, name: string) =>
  editor(page).getByRole('button', { name, exact: true }).click();

async function myMaps(user: Account): Promise<MapRow[]> {
  return (await ok<{ maps: MapRow[] }>('GET', '/maps/mine', await token(user.username))).maps;
}

async function map(user: Account, id: number): Promise<MapRow> {
  return (await ok<{ map: MapRow }>('GET', `/maps/${id}`, await token(user.username))).map;
}

async function openNew(page: Page): Promise<void> {
  await nav(page, 'My Maps').click();
  await page
    .getByRole('button', { name: /Create/ })
    .first()
    .click();
  await expect(editor(page).getByRole('heading', { name: 'Map Editor' })).toBeVisible();
}

test('create a map: tools, the spawn rule, settings, save', async ({ page }) => {
  const user = await createUser();
  await lobby(page, user);
  await openNew(page);
  const size: [number, number] = [15, 13];
  // A new map is called a map, not a level.
  await expect(editor(page).getByLabel('Name')).toHaveValue('Untitled Map');
  // Campaign-only tools are not offered.
  await expect(editor(page).getByRole('button', { name: 'Exit', exact: true })).toHaveCount(0);

  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Need at least 2 spawn points')).toBeVisible();

  await tool(page, 'Spawn');
  await paint(page, size, 13, 11);
  await tool(page, 'Destructible');
  await paint(page, size, 3, 1);
  await paint(page, size, 5, 1);
  await tool(page, 'Teleporter A');
  await paint(page, size, 1, 11);
  await tool(page, 'Teleporter B');
  await paint(page, size, 13, 1);
  for (const [arrow, x] of [
    ['↑', 1],
    ['↓', 3],
    ['←', 5],
    ['→', 7],
  ] as const) {
    await tool(page, `Conveyor ${arrow}`);
    await paint(page, size, x, 5);
  }
  // Empty clears a tile again.
  await tool(page, 'Empty');
  await paint(page, size, 5, 1);

  const name = `Ring ${uid()}`;
  await editor(page).getByLabel('Name').fill(name);
  await editor(page).getByLabel('Description').fill('Two spawns, one shortcut.');
  await editor(page).getByLabel('Published').check();
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Map saved!')).toBeVisible();

  const saved = (await myMaps(user)).find((m) => m.name === name)!;
  const full = await map(user, saved.id);
  expect(full.description).toBe('Two spawns, one shortcut.');
  expect(full.isPublished).toBe(true);
  expect([full.mapWidth, full.mapHeight]).toEqual(size);
  expect(full.tiles[1][1]).toBe('spawn');
  expect(full.tiles[11][13]).toBe('spawn');
  expect(full.tiles[1][3]).toBe('destructible');
  expect(full.tiles[11][1]).toBe('teleporter_a');
  expect(full.tiles[1][13]).toBe('teleporter_b');
  expect(full.tiles[5].slice(1, 8)).toEqual([
    'conveyor_up',
    'empty',
    'conveyor_down',
    'empty',
    'conveyor_left',
    'empty',
    'conveyor_right',
  ]);
  expect(full.tiles[1][5]).toBe('empty');

  // Back to My Maps, which lists it.
  await editor(page).getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
});

test('undo, redo, eraser and resize', async ({ page }) => {
  const user = await createUser();
  const t = await token(user.username);
  await lobby(page, user);
  await openNew(page);
  const name = `Undo ${uid()}`;
  await editor(page).getByLabel('Name').fill(name);
  /** Saves, then reads back which of (3,1), (5,1), (7,1) are destructible. */
  const saved = async (): Promise<string> => {
    const m = (await ok<{ maps: MapRow[] }>('GET', '/maps/mine', t)).maps.find(
      (x) => x.name === name,
    );
    if (!m) return '';
    const row = (await ok<{ map: MapRow }>('GET', `/maps/${m.id}`, t)).map.tiles[1];
    return [3, 5, 7].filter((x) => row[x] === 'destructible').join(',');
  };
  const save = async (expected: string) => {
    await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(saved).toBe(expected);
  };

  const size: [number, number] = [15, 13];
  await tool(page, 'Spawn');
  await paint(page, size, 13, 11);
  await tool(page, 'Destructible');
  await paint(page, size, 3, 1);
  await paint(page, size, 5, 1);
  await paint(page, size, 7, 1);
  // One press = one step (a quick tap used to undo or redo up to three).
  await shortcut(page, 'z');
  await save('3,5');
  await shortcut(page, 'y');
  await save('3,5,7');
  await shortcut(page, 'z');
  await shortcut(page, 'z');
  await shortcut(page, 'y');
  await save('3,5');
  await tool(page, 'Eraser');
  await paint(page, size, 3, 1);

  // Width 16 is rounded up to the next odd size.
  await editor(page).getByLabel('Width').fill('16');
  await editor(page).getByLabel('Width').press('Enter');
  await editor(page).getByLabel('Width').blur();
  await expect(editor(page).getByLabel('Width')).toHaveValue('17');

  await save('5');
  const id = (await myMaps(user)).find((m) => m.name === name)!.id;
  const full = await map(user, id);
  expect(full.mapWidth).toBe(17);
  // The old right border became floor, the new one is wall.
  expect(full.tiles[1][14]).toBe('empty');
  expect(full.tiles[1][16]).toBe('wall');
});

test('leaving with unsaved changes: cancel, discard, save and exit', async ({ page }) => {
  const user = await createUser();
  const t = await token(user.username);
  const tiles = Array.from({ length: 11 }, (_, y) =>
    Array.from({ length: 11 }, (_, x) =>
      x === 0 || y === 0 || x === 10 || y === 10 || (x % 2 === 0 && y % 2 === 0) ? 'wall' : 'empty',
    ),
  );
  tiles[1][1] = 'spawn';
  tiles[9][9] = 'spawn';
  const name = `Draft ${uid()}`;
  const { id } = await ok<{ id: number }>('POST', '/maps', t, {
    name,
    description: '',
    mapWidth: 11,
    mapHeight: 11,
    tiles,
    spawnPoints: [
      { x: 1, y: 1 },
      { x: 9, y: 9 },
    ],
    isPublished: false,
  });
  const size: [number, number] = [11, 11];

  await lobby(page, user);
  await nav(page, 'My Maps').click();
  const row = page.getByRole('row').filter({ hasText: name });
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(editor(page).getByLabel('Name')).toHaveValue(name);
  await tool(page, 'Wall');
  await paint(page, size, 3, 1);

  const back = editor(page).getByRole('button', { name: 'Back', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Unsaved Changes' });
  await back.click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(editor(page)).toBeVisible();

  await back.click();
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await expect(row).toBeVisible();
  expect((await map(user, id)).tiles[1][3]).toBe('empty');

  await row.getByRole('button', { name: 'Edit' }).click();
  await tool(page, 'Wall');
  await paint(page, size, 3, 1);
  await back.click();
  await dialog.getByRole('button', { name: 'Save & Exit' }).click();
  await expect(row).toBeVisible();
  expect((await map(user, id)).tiles[1][3]).toBe('wall');
});

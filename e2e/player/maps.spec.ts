import {
  test,
  expect,
  admin,
  createUser,
  ok,
  openLobby,
  openView,
  press,
  uniq,
  type User,
} from './lib';

/* My Maps (list, publish, delete, open the editor), a custom map in Create Room, and the weekly
 * challenge on a player's map. The editor itself is covered by the admin/editor suite. */

function arena(n: number) {
  const spawns = [
    { x: 1, y: 1 },
    { x: n - 2, y: n - 2 },
  ];
  const tiles = Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => {
      if (x === 0 || y === 0 || x === n - 1 || y === n - 1 || (x % 2 === 0 && y % 2 === 0)) {
        return 'wall';
      }
      return spawns.some((s) => s.x === x && s.y === y) ? 'spawn' : 'empty';
    }),
  );
  return { mapWidth: n, mapHeight: n, tiles, spawnPoints: spawns };
}

async function makeMap(u: User, name: string, isPublished: boolean): Promise<number> {
  const m = await ok<{ id: number }>('POST', '/maps', u.token, {
    name,
    description: 'e2e map',
    ...arena(11),
    isPublished,
  });
  return m.id;
}

test('my maps: list, publish, delete; New Map opens the editor', async ({ page }) => {
  const u = await createUser('map');
  const [keep, drop] = [uniq('Keep '), uniq('Drop ')];
  await makeMap(u, keep, false);
  await makeMap(u, drop, false);
  await openLobby(page, u);
  await openView(page, 'maps');
  const row = (n: string) => page.locator('.view-root tr', { hasText: n });
  await expect(row(keep)).toContainText('11x11');
  await expect(row(keep)).toContainText('No');

  await row(keep).getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Map published!')).toBeVisible();
  await expect(row(keep)).toContainText('Yes');

  await row(drop).getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete' });
  await expect(dialog).toContainText(`Delete map "${drop}"?`);
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Map deleted')).toBeVisible();
  await expect(row(drop)).toHaveCount(0);

  await page.locator('#create-map-btn').click();
  await expect(page.locator('#level-editor-ui')).toBeVisible();
});

test('create room on a custom map: preview and the room names the map', async ({ page }) => {
  const u = await createUser('cmap');
  const name = uniq('Arena ');
  await makeMap(u, name, true);
  await openLobby(page, u);
  await openView(page, 'rooms');
  await page.locator('#create-room-btn').click();
  const option = page.getByLabel('Map', { exact: true }).locator('option', { hasText: name });
  await page.getByLabel('Map', { exact: true }).selectOption((await option.getAttribute('value'))!);
  await expect(page.locator('#cr-map-preview')).toBeVisible();
  // The generator's size and density do not apply to a custom map.
  await expect(page.getByLabel('Map Size')).toBeDisabled();
  await page.getByLabel('Room Name').fill(uniq('On map '));
  await press(page, '#cr-submit');
  await expect(page.locator('#room-player-list')).toBeVisible();
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText('Wall Density')).toHaveCount(0);
});

test('weekly challenge: details, empty board, play creates the room', async ({ page }) => {
  const a = await admin();
  const creator = await createUser('chc');
  const mapName = uniq('Chal map ');
  const mapId = await makeMap(creator, mapName, true);
  const title = uniq('Challenge ');
  const c = await ok<{ id: number }>('POST', '/admin/challenges', a.token, {
    title,
    description: 'Most wins takes the crown.',
    customMapId: mapId,
    gameMode: 'ffa',
    startDate: '2026-01-01',
    endDate: '2036-01-01',
  });
  await ok('POST', `/admin/challenges/${c.id}/activate`, a.token);

  const u = await createUser('chp');
  await openLobby(page, u);
  await openView(page, 'challenge');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText(mapName)).toBeVisible();
  await expect(page.getByText(creator.username)).toBeVisible();
  await expect(page.getByText('No scores yet — be the first to play!')).toBeVisible();
  await page.getByRole('button', { name: 'Play Challenge' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.locator('#room-player-list')).toContainText(u.username);
});

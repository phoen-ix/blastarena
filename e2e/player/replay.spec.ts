import {
  test,
  expect,
  createRoom,
  createUser,
  expectScene,
  gameOver,
  openLobby,
  openView,
  selfDestruct,
  sql,
  uniq,
} from './lib';

/* The replay viewer: a recorded match (recordings are on by default) is opened from Admin >
 * Matches, played, paused, sped up, seeked; the log panel toggles; Back returns to the tab. */

test('replay a recorded match: play, pause, speed, seek, log, back', async ({ page }) => {
  test.setTimeout(240_000);
  const staff = await createUser('rpl', 'admin');
  await openLobby(page, staff);
  const name = uniq('Replay ');
  await createRoom(page, { name, bots: '1', difficulty: 'easy' });
  const code = (await page.locator('.lobby-header strong').textContent())!.trim();
  await page.getByRole('button', { name: 'Start Game' }).click();
  await expect(page.locator('.hud-players')).toBeVisible();
  await selfDestruct(page);
  await expectScene(page, 'GameOverScene');
  await expect(async () => {
    await gameOver.back(page);
    await expect(page.locator('#nav-rooms')).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });

  // The replay file is written when the match ends.
  let matchId = '';
  await expect
    .poll(() => (matchId = sql(`SELECT id FROM matches WHERE room_code = '${code}'`).trim()))
    .not.toBe('');

  await openView(page, 'admin');
  await page.locator('#admin-tab-bar [data-tab="matches"]').click();
  await page.locator(`tr[data-match-id="${matchId}"]`).click();
  await page.getByRole('button', { name: 'Watch Replay' }).click();

  const controls = page.locator('#replay-controls');
  await expect(controls).toContainText(`Match #${matchId}`);
  await expectScene(page, 'GameScene');
  const time = controls.locator('span').first();
  const play = controls.getByTitle('Play/Pause');
  const at = async () => (await time.textContent()) ?? '';

  // Playing moves the clock; pausing stops it.
  if ((await play.textContent()) === '▶') await play.click();
  await expect(play).toHaveText('⏸');
  const t0 = await at();
  await expect.poll(at).not.toBe(t0);
  await play.click();
  await expect(play).toHaveText('▶');
  const paused = await at();
  await expect(time).toHaveText(paused);

  await controls.getByTitle('Cycle speed').click();
  await expect(controls.getByTitle('Cycle speed')).toHaveText('2x');
  await controls.getByTitle('Skip to end').click();
  const end = await at();
  await controls.getByTitle('Skip to start').click();
  await expect(time).not.toHaveText(end);
  const start = await at();
  await controls.getByTitle('Forward 5s').click();
  await expect(time).not.toHaveText(start);

  // The log panel slides in from the right edge.
  await expect(page.getByText('Game Log')).not.toBeInViewport();
  await page.getByTitle('Toggle log panel').click();
  await expect(page.getByText('Game Log')).toBeInViewport();

  await controls.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('#admin-tab-bar [data-tab="matches"]')).toHaveClass(/active/);
});

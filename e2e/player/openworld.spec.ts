import { test, expect, createUser, newPage, openLobby, signInContext, PASSWORD } from './lib';

/* The open world: the live arena behind the landing page (guests), the HUD scoreboard with every
 * player in it (several browser contexts on real sockets), leaving and re-joining from the lobby,
 * and signing in from the guest bar over the running game. */

test('a guest plays behind the landing and signs in from the HUD bar', async ({ page }) => {
  const u = await createUser('owg');
  await page.goto('/');
  // Phaser tweens run on the page clock; nothing here fixes it.
  await page.getByRole('button', { name: 'Play as Guest' }).click();
  const bar = page.locator('.hud-auth-bar');
  await expect(bar).toBeVisible();
  await expect(page.locator('.hud-ow-board .hud-ow-rows')).toContainText(/Guest/i);
  await expect(page.locator('#hud-round')).toBeVisible();
  // The first game key docks the landing title; the guest moves.
  await page.keyboard.press('ArrowRight');

  // The register form opens over the game and closes again without leaving it.
  await bar.getByRole('button', { name: 'Register' }).click();
  await expect(page.locator('#reg-btn')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#reg-btn')).toHaveCount(0);
  await expect(bar).toBeVisible();

  // Login over the game: the guest becomes the account and re-joins as it.
  await bar.getByRole('button', { name: 'Login' }).click();
  await page.getByLabel('Username').fill(u.username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.locator('#login-btn').click();
  await expect(page.locator('.hud-ow-board')).toContainText(u.username);
  await expect(page.locator('.hud-auth-bar')).toHaveCount(0);
});

test('players in the world see each other; leave, cancel and re-join', async ({
  page,
  browser,
  guard,
}) => {
  const [a, b] = [await createUser('owa'), await createUser('owb')];
  const pageB = await newPage(browser, guard);
  for (const [p, u] of [
    [page, a],
    [pageB, b],
  ] as const) {
    await signInContext(p.context(), u);
    await p.goto('/');
    await expect(p.locator('.hud-ow-board')).toBeVisible();
  }
  // Each board lists both (authoritative standings arrive at least every 5 s).
  for (const p of [page, pageB]) {
    await expect(p.locator('.hud-ow-rows')).toContainText(a.username, { timeout: 20_000 });
    await expect(p.locator('.hud-ow-rows')).toContainText(b.username, { timeout: 20_000 });
  }

  // Escape asks first; Cancel keeps playing.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'LEAVE GAME' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.pause-overlay')).toHaveCount(0);
  await expect(page.locator('.hud-ow-board')).toBeVisible();

  // Leave: back to the lobby's Open World view, and gone from the other player's board.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Leave Game' }).click();
  await expect(page.getByRole('button', { name: 'Join World' })).toBeVisible();
  await expect(page.locator('#ow-players')).toContainText(/\d+\s*\/\s*\d+/);
  await expect(pageB.locator('.hud-ow-rows')).not.toContainText(a.username, { timeout: 20_000 });

  // Join again from the lobby.
  await page.getByRole('button', { name: 'Join World' }).click();
  await expect(page.locator('.hud-ow-board')).toBeVisible();
  await expect(pageB.locator('.hud-ow-rows')).toContainText(a.username, { timeout: 20_000 });
  await pageB.context().close();
});

test('the lobby Open World view shows round, players and standings', async ({ page }) => {
  const u = await createUser('owv');
  await openLobby(page, u);
  await expect(page.locator('#ow-round')).toContainText(/Round \d+/);
  await expect(page.locator('#ow-timer')).toContainText(/\d+:\d\d/);
  await expect(page.locator('#ow-board')).toBeVisible();
});

test('an idle player is kicked out of the world after the AFK timeout', async ({ page }) => {
  // The default timeout is 60 s, checked every 5 s.
  test.setTimeout(150_000);
  const u = await createUser('afk');
  await signInContext(page.context(), u);
  await page.goto('/');
  await expect(page.locator('.hud-ow-board')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join World' })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.hud-ow-board')).toHaveCount(0);
});

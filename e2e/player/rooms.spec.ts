import {
  test,
  expect,
  clickCanvas,
  createRoom,
  createUser,
  expectScene,
  gameOver,
  newPage,
  openLobby,
  openView,
  press,
  selfDestruct,
  uniq,
} from './lib';

/* Rooms and matches: create a room, the waiting room, a match against bots (HUD, movement,
 * bombs, game over, Play Again), and two humans in two browser contexts (live room list, join,
 * ready, teams, start, rematch vote). */

test('create room form: cancel, then create a room with bots and leave it', async ({ page }) => {
  const u = await createUser('rm');
  await openLobby(page, u);
  await openView(page, 'rooms');
  await page.locator('#create-room-btn').click();
  await press(page, '#cr-cancel');
  await expect(page.locator('#room-list')).toBeVisible();

  const name = uniq('Room ');
  await createRoom(page, { name, bots: '2', difficulty: 'easy', mode: 'deathmatch' });
  const room = page.locator('.lobby-header');
  await expect(room).toContainText('Deathmatch');
  await expect(page.locator('#room-player-list')).toContainText(u.username);
  await expect(page.locator('#room-player-list')).toContainText('BOT');
  await expect(page.getByText('Room Code:')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Game' })).toBeEnabled();

  // Back leaves the room; it is gone from the list (the only player left).
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.locator('#room-list')).toBeVisible();
  await expect(page.locator('#room-list')).not.toContainText(name);
});

test('a solo match against a bot: HUD, bomb, game over, play again', async ({ page }) => {
  test.setTimeout(240_000);
  const u = await createUser('solo');
  await openLobby(page, u);
  const name = uniq('Solo ');
  await createRoom(page, { name, bots: '1', difficulty: 'easy' });
  await page.getByRole('button', { name: 'Start Game' }).click();

  await expect(page.locator('.hud-players')).toContainText(u.username);
  await expect(page.locator('#hud-timer')).toHaveText(/\d:\d\d/);
  await expect(page.locator('#stat-bombs')).toBeVisible();
  await expectScene(page, 'GameScene');
  await page.keyboard.press('ArrowDown');

  await selfDestruct(page);
  await expectScene(page, 'GameOverScene');
  await expect(page.locator('.hud-container')).toHaveCount(0);

  // Solo: Play Again restarts without a vote and lands in the waiting room again.
  await expect(async () => {
    await gameOver.action(page);
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await expect(page.locator('.hud-players')).toBeVisible();

  // Leaving mid-match asks first, then goes to the lobby.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Leave Game' }).click();
  await expect(page.locator('#nav-rooms')).toBeVisible();

  // The finished match is in the player's history.
  await openView(page, 'matchHistory');
  await expect(page.locator('.view-root table')).toContainText(/Free for All/i);
});

test('two players: live list, join, ready, start, rematch vote', async ({
  page,
  browser,
  guard,
}) => {
  test.setTimeout(240_000);
  const [host, guest] = [await createUser('hst'), await createUser('gst')];
  const pageB = await newPage(browser, guard);
  // Emotes are drawn on the canvas: read them off the guest's socket instead.
  const frames: string[] = [];
  pageB.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
  await openLobby(page, host);
  await openLobby(pageB, guest);
  await openView(pageB, 'rooms');

  const name = uniq('Duel ');
  await createRoom(page, { name, maxPlayers: '2' });
  await expect(page.getByRole('button', { name: 'Need Players or Bots' })).toBeDisabled();

  // The room appears on the other player's list without a reload; joining shows them both.
  const card = pageB.locator('.room-card', { hasText: name });
  await expect(card).toContainText('1/2');
  await card.click();
  await expect(pageB.getByRole('heading', { name })).toBeVisible();
  await expect(page.locator('#room-player-list')).toContainText(guest.username);
  await expect(page.getByRole('button', { name: 'Waiting for Players...' })).toBeDisabled();

  // Ready toggles; the host can start once everyone is ready.
  await pageB.getByRole('button', { name: 'Ready', exact: true }).click();
  await expect(page.locator('#room-player-list')).toContainText('READY');
  await pageB.getByRole('button', { name: 'Not Ready' }).click();
  await expect(page.getByRole('button', { name: 'Waiting for Players...' })).toBeDisabled();
  await pageB.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Start Game' }).click();

  for (const p of [page, pageB]) {
    await expect(p.locator('.hud-players')).toContainText(host.username);
    await expect(p.locator('.hud-players')).toContainText(guest.username);
  }

  // Emote wheel (backtick): pick one; it reaches the other player.
  await expect(async () => {
    await page.keyboard.press('Backquote');
    await expect(page.locator('.emote-wheel-overlay')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.locator('.emote-wheel-item').first().click();
  await expect(page.locator('.emote-wheel-overlay')).toHaveCount(0);
  await expect.poll(() => frames.some((f) => f.includes('"game:emote"'))).toBe(true);

  // The host blows themself up; the guest wins. Both see the results.
  await selfDestruct(page);
  await expectScene(page, 'GameOverScene');
  await expectScene(pageB, 'GameOverScene');

  // Rematch needs a majority: both vote, both are back in the waiting room.
  await gameOver.action(page);
  await gameOver.action(pageB);
  for (const p of [page, pageB]) {
    await expect(p.getByRole('heading', { name })).toBeVisible();
  }
  await pageB.context().close();
});

test('teams: the host assigns teams the other player sees', async ({ page, browser, guard }) => {
  const [host, guest] = [await createUser('tmh'), await createUser('tmg')];
  const pageB = await newPage(browser, guard);
  await openLobby(page, host);
  await openLobby(pageB, guest);
  const name = uniq('Teams ');
  await createRoom(page, { name, mode: 'teams', bots: '1' });
  await expect(page.locator('.lobby-header')).toContainText('Teams');
  await openView(pageB, 'rooms');
  await pageB.locator('.room-card', { hasText: name }).click();
  await expect(pageB.getByRole('heading', { name })).toBeVisible();

  const select = page.getByLabel(`Team assignment for ${guest.username}`);
  const other = (await select.inputValue()) === '0' ? '1' : '0';
  await select.selectOption(other);
  const label = other === '0' ? 'Red' : 'Blue';
  await expect(pageB.locator('#room-player-list > div', { hasText: guest.username })).toContainText(
    new RegExp(label, 'i'),
  );
  // Bots get a team too.
  const bot = page.getByLabel('Team assignment for Bot 1');
  const botOther = (await bot.inputValue()) === '0' ? '1' : '0';
  await bot.selectOption(botOther);
  await expect(page.getByLabel('Team assignment for Bot 1')).toHaveValue(botOther);
  // Only the host gets the selects.
  await expect(pageB.locator('.team-select')).toHaveCount(0);
  await pageB.context().close();
});

test('spectating after death: banner, spectator chat and actions', async ({
  page,
  browser,
  guard,
}) => {
  test.setTimeout(180_000);
  // Two other humans idle at their spawns, so the match goes on after this player is out (it ends
  // at one survivor, and bots blow each other up within seconds).
  const u = await createUser('spc');
  const idle = [await createUser('spi'), await createUser('spj')];
  const others = [await newPage(browser, guard), await newPage(browser, guard)];
  await openLobby(page, u);
  for (const [i, p] of others.entries()) await openLobby(p, idle[i]);
  const name = uniq('Spectate ');
  await openView(page, 'rooms');
  await page.locator('#create-room-btn').click();
  await page.getByLabel('Room Name').fill(name);
  await page.getByLabel('Max Players').selectOption('4');
  await page.getByLabel('Match Time').selectOption('120');
  await page.getByRole('checkbox', { name: /Spectator/i }).check();
  await press(page, '#cr-submit');
  for (const p of others) {
    await openView(p, 'rooms');
    await p.locator('.room-card', { hasText: name }).click();
    await p.getByRole('button', { name: 'Ready', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start Game' }).click();
  await expect(page.locator('.hud-players')).toBeVisible();

  // Out of the game while the others are still in: the HUD turns into the spectator view.
  await selfDestruct(page);
  await expect(page.locator('#hud-spectator')).toBeVisible();

  await page.getByRole('button', { name: 'Spectator Chat' }).click();
  await page.getByPlaceholder('Type a message...').fill('gg bots');
  await page.locator('#spec-chat-send').click();
  await expect(page.locator('#spec-chat-messages')).toContainText('gg bots');
  await page.locator('#spec-chat-input').blur();

  const bar = page.locator('#spectator-action-bar');
  await expect(bar).toBeVisible();
  await bar.locator('button[data-action="place_wall"]').click();
  await expect(page.locator('#spectator-target-hint')).toBeVisible();
  // Energy refills at 20/s; a meteor (50) dropped on the arena spends it.
  await expect(bar).toContainText('100 / 100', { timeout: 15_000 });
  await bar.locator('button[data-action="trigger_meteor"]').click();
  await clickCanvas(page, 0, 400);
  await expect(bar).not.toContainText('100 / 100');

  // Escape asks to leave (it drops a pending placement first, if there is one).
  const leave = page.getByRole('button', { name: 'Leave Game' });
  await expect(async () => {
    if (!(await leave.isVisible())) await page.keyboard.press('Escape');
    await expect(leave).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await leave.click();
  await expect(page.locator('#nav-rooms')).toBeVisible();
  for (const p of others) await p.context().close();
});

test('the lobby reconnects after the connection drops and stays live', async ({
  page,
  browser,
  guard,
}) => {
  // socket.io notices a dead connection by its ping (25 s interval, 60 s timeout) at the latest.
  test.setTimeout(240_000);
  const [a, b] = [await createUser('rcn'), await createUser('rco')];
  const pageB = await newPage(browser, guard);
  await openLobby(page, a);
  await openLobby(pageB, b);
  await openView(page, 'rooms');

  await page.context().setOffline(true);
  const overlay = page.getByText('Reconnecting to server...');
  await expect(overlay).toBeVisible({ timeout: 120_000 });
  await page.context().setOffline(false);
  await expect(overlay).toHaveCount(0, { timeout: 60_000 });

  // The room list is live again: a room created elsewhere shows up without a reload.
  const name = uniq('Back ');
  await createRoom(pageB, { name });
  await expect(page.locator('.room-card', { hasText: name })).toBeVisible();
  await pageB.context().close();
});

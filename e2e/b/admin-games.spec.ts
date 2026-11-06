import { io, type Socket } from 'socket.io-client';

import {
  adminTab,
  BASE,
  createUser,
  expect,
  expectReplay,
  lobby,
  sql,
  test,
  token,
  uid,
  type Account,
} from './support';
import type { Page } from '@playwright/test';

/* Admin > Rooms (live list with each room's players, message, per-player kick, also as a
 * moderator, close, spectate) against rooms players opened over Socket.io, and Admin > Matches
 * (list, details, replay, delete): a match played against a bot and finished matches written as
 * history. */

async function player(): Promise<{ account: Account; socket: Socket }> {
  const account = await createUser();
  const socket = io(BASE, {
    auth: { token: await token(account.username) },
    transports: ['websocket'],
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return { account, socket };
}

async function openRoom(socket: Socket, name: string, bots = 0): Promise<string> {
  const res = await new Promise<{ success: boolean; room?: { code: string }; error?: string }>(
    (r) =>
      socket.emit(
        'room:create',
        {
          name,
          config: {
            gameMode: 'ffa',
            maxPlayers: 4,
            mapWidth: 15,
            mapHeight: 13,
            roundTime: 180,
            botCount: bots,
          },
        },
        r,
      ),
  );
  expect(res.error).toBeUndefined();
  return res.room!.code;
}

const next = <T>(socket: Socket, event: string) =>
  new Promise<T>((resolve) => socket.once(event, resolve));

async function roomsTab(page: Page): Promise<void> {
  await lobby(page, await createUser('admin', 'a'));
  await adminTab(page, 'Rooms');
}

test('message, kick and close a waiting room', async ({ page }) => {
  const { account, socket } = await player();
  try {
    const name = `Lobby ${uid()}`;
    const code = await openRoom(socket, name);
    await roomsTab(page);
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText(code);
    await expect(row).toContainText('1/4');

    // Message: delivered to the room.
    const message = next<{ message: string; from: string }>(socket, 'admin:roomMessage');
    await row.getByRole('button', { name: 'Message' }).click();
    const msgDialog = page.getByRole('dialog', { name: 'Send Message to Room' });
    await msgDialog.getByRole('textbox', { name: 'Room message' }).fill('Please keep it friendly');
    await msgDialog.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.toast').filter({ hasText: 'Message sent' })).toBeVisible();
    expect((await message).message).toBe('Please keep it friendly');

    // Kick: each player is listed by name and id, with a Kick of their own.
    await expect(row).toContainText(`${account.username} #${account.id}`);
    await row.getByRole('button', { name: `Kick ${account.username}` }).click();
    const kick = page.getByRole('dialog', {
      name: `Kick ${account.username} from Room ${code}`,
    });
    await kick.getByLabel('Reason (optional)').fill('AFK');
    const kicked = next<{ reason: string }>(socket, 'admin:kicked');
    await kick.getByRole('button', { name: 'Kick' }).click();
    expect((await kicked).reason).toBe('AFK');
    await expect(page.locator('.toast').filter({ hasText: 'Player kicked' })).toBeVisible();

    // Close (admin only): a second room disappears from the list.
    const second = `Closing ${uid()}`;
    await openRoom(socket, second);
    const row2 = page.getByRole('row').filter({ hasText: second });
    await expect(row2).toBeVisible();
    const closed = next<{ reason: string }>(socket, 'admin:kicked');
    await row2.getByRole('button', { name: 'Close' }).click();
    await page
      .getByRole('dialog', { name: 'Close Room' })
      .getByRole('button', { name: 'Close Room' })
      .click();
    expect((await closed).reason).toBe('Room closed by admin');
    await expect(row2).toHaveCount(0);
  } finally {
    socket.disconnect();
  }
});

test('a moderator kicks one player; the room stays for the other', async ({ page }) => {
  const host = await player();
  const guest = await player();
  try {
    const name = `Mod ${uid()}`;
    const code = await openRoom(host.socket, name);
    const joined = await new Promise<{ success: boolean }>((r) =>
      guest.socket.emit('room:join', { code }, r),
    );
    expect(joined.success).toBe(true);
    await lobby(page, await createUser('moderator', 'm'));
    await adminTab(page, 'Rooms');
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('2/4');
    await expect(row.getByRole('button', { name: 'Close' })).toHaveCount(0);

    const kicked = next<{ reason: string }>(guest.socket, 'admin:kicked');
    await row.getByRole('button', { name: `Kick ${guest.account.username}` }).click();
    await page
      .getByRole('dialog', { name: `Kick ${guest.account.username} from Room ${code}` })
      .getByRole('button', { name: 'Kick' })
      .click();
    expect((await kicked).reason).toBe('Kicked by admin');
    // The list follows live: the guest is gone, the host is still there.
    await expect(row).toContainText('1/4');
    await expect(row).not.toContainText(guest.account.username);
    await expect(row).toContainText(host.account.username);
  } finally {
    host.socket.disconnect();
    guest.socket.disconnect();
  }
});

test('spectate a running match and come back', async ({ page }) => {
  const { socket } = await player();
  try {
    const name = `Live ${uid()}`;
    await openRoom(socket, name, 1);
    const started = next(socket, 'game:start');
    socket.emit('room:start');
    await started;
    await roomsTab(page);
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('Playing');
    await row.getByRole('button', { name: 'Spectate' }).click();
    await expect(page.locator('.hud-players')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#admin-tab-bar').getByRole('button', { name: 'Rooms' })).toHaveClass(
      /active/,
    );
  } finally {
    socket.disconnect();
  }
});

test('a played match: details, watch its replay, back to Matches', async ({ page }) => {
  // A real match against a bot: the player walks out, the bot wins, the replay is written.
  const { socket } = await player();
  const code = await openRoom(socket, `Replay ${uid()}`, 1);
  try {
    const started = next(socket, 'game:start');
    socket.emit('room:start');
    await started;
    socket.emit('room:leave');
  } finally {
    socket.disconnect();
  }
  await expect
    .poll(() => sql(`SELECT status FROM matches WHERE room_code = '${code}'`).trim(), {
      timeout: 30_000,
    })
    .toMatch(/^(finished|aborted)$/);

  await lobby(page, await createUser('admin', 'a'));
  await adminTab(page, 'Matches');
  const row = page.getByRole('row').filter({ hasText: code });
  await row.getByRole('cell', { name: code }).click();
  const id = sql(`SELECT id FROM matches WHERE room_code = '${code}'`).trim();
  const detail = page.getByRole('dialog', { name: `Match ${id} Details` });
  // The players come from the replay, so the bot is listed too.
  await expect(detail).toContainText('(bot)');
  await detail.getByRole('button', { name: 'Watch Replay' }).click();
  await expectReplay(page);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('#admin-tab-bar').getByRole('button', { name: 'Matches' })).toHaveClass(
    /active/,
  );
  await expect(row).toBeVisible();
});

test('match history: details and delete', async ({ page }) => {
  const a = await createUser();
  const b = await createUser();
  const code = `E2E${uid()}`.slice(0, 10).toUpperCase();
  sql(
    `INSERT INTO matches (room_code, game_mode, map_seed, map_width, map_height, max_players, status,
       started_at, finished_at, duration, winner_id, created_at)
     VALUES ('${code}', 'teams', 4242, 15, 13, 4, 'finished', NOW() - INTERVAL 5 MINUTE,
       NOW() - INTERVAL 2 MINUTE, 180, ${a.id}, NOW() - INTERVAL 5 MINUTE)`,
  );
  const id = Number(sql(`SELECT id FROM matches WHERE room_code = '${code}'`).trim());
  sql(
    `INSERT INTO match_players (match_id, user_id, team, placement, kills, deaths, bombs_placed,
       powerups_collected, survived_seconds)
     VALUES (${id}, ${a.id}, 0, 1, 3, 0, 12, 2, 180), (${id}, ${b.id}, 1, 2, 1, 1, 9, 1, 150)`,
  );

  await lobby(page, await createUser('admin', 'a'));
  await adminTab(page, 'Matches');
  const row = page.getByRole('row').filter({ hasText: code });
  await expect(row).toContainText('Teams');
  await expect(row).toContainText(a.username);
  await row.getByRole('cell', { name: code }).click();
  const detail = page.getByRole('dialog', { name: `Match ${id} Details` });
  await expect(detail).toContainText('15x13 (seed: 4242)');
  await expect(detail.getByRole('row').filter({ hasText: b.username })).toContainText('Team 2');
  await detail.getByRole('button', { name: 'Close' }).click();
  await expect(detail).toHaveCount(0);

  // Delete All asks first; dismissing it deletes nothing.
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Delete All Matches' }).click();
  await expect(row).toBeVisible();

  page.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.toast').filter({ hasText: `Match #${id} deleted` })).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(sql(`SELECT COUNT(*) FROM matches WHERE id = ${id}`).trim()).toBe('0');
});

test('delete all matches', { tag: '@global' }, async ({ page }) => {
  const a = await createUser();
  const code = `ALL${uid()}`.slice(0, 10).toUpperCase();
  sql(
    `INSERT INTO matches (room_code, game_mode, map_seed, map_width, map_height, max_players, status,
       started_at, finished_at, duration, winner_id, created_at)
     VALUES ('${code}', 'ffa', 7, 15, 13, 4, 'finished', NOW() - INTERVAL 3 MINUTE,
       NOW() - INTERVAL 1 MINUTE, 120, ${a.id}, NOW() - INTERVAL 3 MINUTE)`,
  );
  await lobby(page, await createUser('admin', 'a'));
  await adminTab(page, 'Matches');
  await expect(page.getByRole('row').filter({ hasText: code })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete All Matches' }).click();
  await expect(page.locator('.toast').filter({ hasText: /Deleted \d+ matches/ })).toBeVisible();
  await expect(page.getByText('No matches found')).toBeVisible();
  expect(sql('SELECT COUNT(*) FROM matches').trim()).toBe('0');
});

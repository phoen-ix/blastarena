import { readFileSync } from 'node:fs';

import { adminTab, createUser, expect, lobby, test, uid } from './support';
import type { Page } from '@playwright/test';

/* Admin > AI (bot AI and enemy AI: upload with compile errors and success, activate, edit,
 * download, delete) and Admin > Simulations (configure and run a batch, view, delete). */

const BOT = `import { PlayerInput } from '@blast-arena/shared';

export class IdleBot {
  private seq = 0;
  constructor(_difficulty: 'easy' | 'normal' | 'hard' = 'normal') {}
  generateInput(player: { alive: boolean }, state: { tick: number }): PlayerInput | null {
    if (!player.alive) return null;
    return { seq: ++this.seq, direction: null, action: null, tick: state.tick };
  }
}
`;
const ENEMY = `export class StillEnemy {
  constructor(_difficulty: 'easy' | 'normal' | 'hard', _typeConfig: unknown) {}
  decide(): { direction: null; placeBomb: boolean } {
    return { direction: null, placeBomb: false };
  }
}
`;
const file = (name: string, src: string) => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from(src),
});

const toast = (page: Page, text: string | RegExp) =>
  expect(page.locator('.toast').filter({ hasText: text }).first()).toBeVisible();

async function asAdmin(page: Page, tab: string): Promise<void> {
  await lobby(page, await createUser('admin', 'a'));
  await adminTab(page, tab);
}

test('bot AI: refused source, upload, toggle, edit, download, delete', async ({ page }) => {
  await asAdmin(page, 'AI');
  await page.getByRole('button', { name: 'Upload New AI' }).click();
  const upload = page.getByRole('dialog', { name: 'Upload New Bot AI' });
  await upload.getByRole('button', { name: 'Upload & Compile' }).click();
  await toast(page, 'Name is required');
  const name = `Idle ${uid()}`;
  await upload.getByLabel('Name *').fill(name);
  await upload.getByRole('button', { name: 'Upload & Compile' }).click();
  await toast(page, 'Please select a TypeScript file');
  // A script that reaches for the host is refused with the scanner's findings.
  await upload
    .getByLabel('TypeScript File (.ts) *')
    .setInputFiles(
      file(
        'Evil.ts',
        `import fs from 'fs';\nexport class Evil { generateInput() { fs.readFileSync('/etc/passwd'); return null; } }\n`,
      ),
    );
  await upload.getByRole('button', { name: 'Upload & Compile' }).click();
  await expect(upload.locator('#ai-upload-errors')).toBeVisible();
  await upload.getByLabel('TypeScript File (.ts) *').setInputFiles(file('IdleBot.ts', BOT));
  await upload.getByLabel('Description').fill('Stands still');
  await upload.getByRole('button', { name: 'Upload & Compile' }).click();
  await toast(page, 'AI uploaded and compiled successfully');

  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText('Stands still');
  await row.getByRole('button', { name: /^(Activate|Deactivate)$/ }).click();
  await toast(page, /AI (activated|deactivated)/);

  await row.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit AI' });
  await edit.getByLabel('Description').fill('Waits patiently');
  await edit.getByRole('button', { name: 'Save' }).click();
  await toast(page, 'AI updated');
  await expect(row).toContainText('Waits patiently');

  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download' }).click();
  expect(readFileSync(await (await download).path(), 'utf8')).toContain('class IdleBot');

  await row.getByRole('button', { name: 'Delete' }).click();
  const del = page.getByRole('dialog', { name: 'Delete AI' });
  await expect(del.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await del.getByRole('textbox').fill(name);
  await del.getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);
});

test('enemy AI: upload, toggle, download, delete', async ({ page }) => {
  await asAdmin(page, 'AI');
  await page.getByRole('button', { name: 'Upload New Enemy AI' }).click();
  const upload = page.getByRole('dialog', { name: 'Upload New Enemy AI' });
  const name = `Still ${uid()}`;
  await upload.getByLabel('Name *').fill(name);
  await upload.getByLabel('TypeScript File (.ts) *').setInputFiles(file('StillEnemy.ts', ENEMY));
  await upload.getByRole('button', { name: 'Upload & Compile' }).click();
  await toast(page, 'Enemy AI uploaded and compiled successfully');
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /^(Activate|Deactivate)$/ }).click();
  await toast(page, /Enemy AI (activated|deactivated)/);
  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download' }).click();
  expect(readFileSync(await (await download).path(), 'utf8')).toContain('class StillEnemy');
  await row.getByRole('button', { name: 'Delete' }).click();
  const del = page.getByRole('dialog', { name: 'Delete Enemy AI' });
  await del.getByRole('textbox').fill(name);
  await del.getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);
});

async function newBatch(page: Page, mode: string, speed: 'fast' | 'realtime', games: string) {
  await page.getByRole('button', { name: 'New Simulation' }).click();
  const modal = page.getByRole('dialog', { name: 'New Simulation Batch' });
  await modal.getByLabel('Game Mode').selectOption(mode);
  await modal.getByLabel('Bot Count').selectOption('2');
  await modal.getByLabel('Total Games').fill(games);
  await modal.getByLabel('Speed', { exact: true }).selectOption(speed);
  await modal.getByLabel('Match Time').selectOption('60');
  await modal.getByRole('button', { name: 'Start Batch' }).click();
  await toast(page, /Simulation (batch started|queued)/);
}

test('simulations: run a fast batch, read the results, watch a replay, delete it', async ({
  page,
}) => {
  await asAdmin(page, 'Simulations');
  await newBatch(page, 'ffa', 'fast', '2');
  // Starting opens the batch's live view; its status is shown in the UI's words.
  await expect(page.getByRole('heading', { name: 'Free for All Simulation' })).toBeVisible();
  await expect(page.locator('.sim-detail-header .sim-status')).toHaveText('Completed', {
    timeout: 180_000,
  });
  // (No Win Distribution assertion: it shows only when a game had a winner, and bots can draw.)
  await expect(page.getByText('2/2 games (100%)')).toBeVisible();
  // Both games are listed (a game that ended while the view loaded used to go missing).
  const games = page
    .locator('#admin-tab-content')
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'Replay' }) });
  await expect(games).toHaveCount(2);

  // Replays are recorded by default: watch one, come back to the batch.
  await games.first().getByRole('button', { name: 'Replay' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Free for All Simulation' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to List' }).click();

  const row = page.getByRole('row').filter({ hasText: 'Free for All' }).first();
  await expect(row.locator('.sim-status')).toHaveText('Completed');
  page.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: 'Delete' }).click();
  await toast(page, 'Simulation deleted');
});

test('simulations: a real-time batch opens its spectator view, leave, watch again, cancel', async ({
  page,
}) => {
  await asAdmin(page, 'Simulations');
  await newBatch(page, 'deathmatch', 'realtime', '3');
  // A real-time batch starts in the spectator view; leaving it opens the batch.
  await expect(page.locator('.hud-players')).toBeVisible();
  await page.keyboard.press('Escape');
  const batch = page.getByRole('heading', { name: 'Deathmatch Simulation' });
  await expect(batch).toBeVisible();
  await page.getByRole('button', { name: 'Spectate Current Game' }).click();
  await expect(page.locator('.hud-players')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(batch).toBeVisible();
  await page.getByRole('button', { name: 'Cancel Batch' }).click();
  await toast(page, 'Batch cancellation requested');
});

import { readFileSync } from 'node:fs';

import {
  adminSession,
  adminTab,
  api,
  createUser,
  expect,
  lobby,
  ok,
  test,
  token,
  uid,
} from './support';
import type { Page } from '@playwright/test';

/* Admin > Seasons (create, activate, end, delete, rank tiers), Admin > Challenges (toggle, create
 * on a published map, activate/deactivate, delete) and Admin > Achievements (achievement and
 * cosmetic create/edit/delete, export, import). */

const toast = (page: Page, text: string | RegExp) =>
  expect(page.locator('.toast').filter({ hasText: text }).first()).toBeVisible();

async function asAdmin(page: Page, tab: string): Promise<void> {
  await lobby(page, await createUser('admin', 'a'));
  await adminTab(page, tab);
}

test(
  'seasons: create, activate, end with a soft reset, delete',
  { tag: '@global' },
  async ({ page }) => {
    await asAdmin(page, 'Seasons');
    await page.getByRole('button', { name: 'Create Season' }).click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await toast(page, 'Season name is required');
    const name = `Autumn ${uid()}`;
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Start Date').fill('2026-11-01');
    await page.getByLabel('End Date').fill('2026-10-01');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await toast(page, 'End date must be after start date');
    await page.getByLabel('End Date').fill('2026-12-31');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await toast(page, 'Season created');

    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('Inactive');
    await row.getByRole('button', { name: 'Activate' }).click();
    await page
      .getByRole('dialog', { name: 'Activate Season' })
      .getByRole('button', { name: 'Activate' })
      .click();
    await toast(page, 'Season activated');
    await expect(row).toContainText('Active');
    // An active season cannot be deleted.
    await row.getByRole('button', { name: 'Delete' }).click();
    await toast(page, 'Cannot delete an active season. End it first.');

    await row.getByRole('button', { name: 'End Season' }).click();
    await page.getByRole('button', { name: /Soft Reset/ }).click();
    await toast(page, 'Season ended (soft reset)');
    await expect(row).toContainText('Inactive');
    await row.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('dialog', { name: 'Delete Season' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await toast(page, 'Season deleted');
    await expect(row).toHaveCount(0);
  },
);

test('rank tiers: add a tier, validate, save', { tag: '@global' }, async ({ page }) => {
  const { token: t } = await adminSession();
  const before = (await api('GET', '/admin/settings/rank_tiers', t)).data;
  await asAdmin(page, 'Seasons');
  try {
    const tiers = page.locator('#rank-tiers-list');
    const count = await tiers.getByRole('textbox', { name: 'Tier name' }).count();
    await page.getByRole('button', { name: '+ Add Tier' }).click();
    await expect(tiers.getByRole('textbox', { name: 'Tier name' })).toHaveCount(count + 1);
    await page.getByRole('button', { name: 'Save Rank Configuration' }).click();
    await toast(page, 'All tiers must have a name');
    await tiers.getByRole('textbox', { name: 'Tier name' }).last().fill('Mythic');
    await page.getByRole('button', { name: 'Save Rank Configuration' }).click();
    await toast(page, 'Rank configuration saved');
    const saved = (await api<{ tiers: { name: string }[] }>('GET', '/admin/settings/rank_tiers', t))
      .data;
    expect(saved.tiers.map((x) => x.name)).toContain('Mythic');
  } finally {
    await ok('PUT', '/admin/settings/rank_tiers', t, before);
  }
});

test(
  'challenges: toggle, create, activate, deactivate, delete',
  { tag: '@global' },
  async ({ page }) => {
    const owner = await createUser();
    const tiles = Array.from({ length: 9 }, (_, y) =>
      Array.from({ length: 9 }, (_, x) =>
        x === 0 || y === 0 || x === 8 || y === 8 || (x % 2 === 0 && y % 2 === 0) ? 'wall' : 'empty',
      ),
    );
    tiles[1][1] = 'spawn';
    tiles[7][7] = 'spawn';
    const mapName = `Arena ${uid()}`;
    await ok('POST', '/maps', await token(owner.username), {
      name: mapName,
      description: '',
      mapWidth: 9,
      mapHeight: 9,
      tiles,
      spawnPoints: [
        { x: 1, y: 1 },
        { x: 7, y: 7 },
      ],
      isPublished: true,
    });

    const { token: adminToken } = await adminSession();
    await asAdmin(page, 'Challenges');
    const toggle = page.getByRole('switch', { name: 'Challenges Enabled' });
    await expect(toggle).toBeChecked();
    // The checkbox is drawn by its label (a slider): click that.
    await toggle.locator('xpath=..').click();
    await toast(page, 'Challenge setting saved');
    expect(
      (await api<{ enabled: boolean }>('GET', '/admin/settings/challenges_enabled', adminToken))
        .data.enabled,
    ).toBe(false);
    await toggle.locator('xpath=..').click();
    await toast(page, 'Challenge setting saved');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: 'Create Challenge' }).first().click();
    const title = `Weekend Cup ${uid()}`;
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Description').fill('Most wins takes it.');
    const mapOption = page
      .getByLabel('Map', { exact: true })
      .locator('option', { hasText: mapName });
    await page
      .getByLabel('Map', { exact: true })
      .selectOption((await mapOption.getAttribute('value'))!);
    await page.getByLabel('Game Mode').selectOption('ffa');
    await page
      .locator('#challenge-create-form')
      .getByRole('button', { name: 'Create Challenge' })
      .click();
    await toast(page, 'Challenge created');

    const row = page.getByRole('row').filter({ hasText: title });
    await expect(row).toContainText('Inactive');
    await row.getByRole('button', { name: 'Activate' }).click();
    await toast(page, 'Challenge activated');
    await expect(row).toContainText('Active');
    expect(
      (
        await api<{ challenge?: { title: string } }>(
          'GET',
          '/challenges/active',
          await token(owner.username),
        )
      ).data.challenge?.title,
    ).toBe(title);
    await row.getByRole('button', { name: 'Deactivate' }).click();
    await toast(page, 'Challenge deactivated');
    await row.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('dialog', { name: 'Delete Challenge' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await toast(page, 'Challenge deleted');
    await expect(row).toHaveCount(0);
  },
);

test('achievements: create, edit, export, delete', async ({ page }) => {
  await asAdmin(page, 'Achievements');
  await page.getByRole('button', { name: 'Create Achievement' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog.locator('#am-error')).toHaveText('Name and description are required');
  const name = `Crate Crusher ${uid()}`;
  await dialog.getByLabel('Name *').fill(name);
  await dialog.getByLabel('Description *').fill('Destroy 500 crates');
  await dialog.getByLabel('Icon').fill('📦');
  await dialog.getByLabel('Condition Type *').selectOption('cumulative');
  await dialog.getByLabel('Threshold').fill('500');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await toast(page, 'Achievement created');

  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText('Destroy 500 crates');
  await row.getByRole('button', { name: 'Edit' }).click();
  await dialog.getByLabel('Description *').fill('Destroy 600 crates');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await toast(page, 'Achievement updated');
  await expect(row).toContainText('Destroy 600 crates');

  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Export' }).click();
  const file = await (await download).path();
  const json = JSON.parse(readFileSync(file, 'utf8'));
  expect(json.achievement?.name ?? json.name).toBe(name);

  await row.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog').filter({ hasText: name });
  await confirm.getByRole('textbox').fill(name);
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await toast(page, 'Achievement deleted');
  await expect(row).toHaveCount(0);

  // The exported file brings it back.
  await page.getByRole('button', { name: 'Import' }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import Achievements' });
  await importDialog.locator('input[type=file]').setInputFiles(file);
  await expect(importDialog).toContainText(`Single achievement: ${name}`);
  await importDialog.getByRole('button', { name: 'Import' }).click();
  await toast(page, 'Achievements imported');
  await expect(row).toContainText('Destroy 600 crates');

  // Export All downloads the bundle.
  const bundleDl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export All' }).click();
  const bundle = JSON.parse(readFileSync(await (await bundleDl).path(), 'utf8'));
  expect(bundle._format).toBe('blast-arena-achievement-bundle');
  expect(JSON.stringify(bundle)).toContain(name);
});

test('cosmetics: create, edit, export, delete, import', async ({ page }) => {
  await asAdmin(page, 'Achievements');
  await page.getByRole('button', { name: 'Cosmetics' }).click();
  await page.getByRole('button', { name: 'Create Cosmetic' }).click();
  const dialog = page.getByRole('dialog');
  const name = `Ember Red ${uid()}`;
  await dialog.getByLabel('Name *').fill(name);
  await dialog.getByLabel('Type *').selectOption('color');
  await dialog.getByLabel('Rarity').selectOption('rare');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await toast(page, 'Cosmetic created');
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText('rare');
  await row.getByRole('button', { name: 'Edit' }).click();
  await dialog.getByLabel('Rarity').selectOption('epic');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await toast(page, 'Cosmetic updated');
  await expect(row).toContainText('epic');
  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Export' }).click();
  const file = await (await download).path();
  expect(JSON.parse(readFileSync(file, 'utf8'))._format).toBe('blast-arena-cosmetic');
  await row.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog').filter({ hasText: name });
  await confirm.getByRole('textbox').fill(name);
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await toast(page, 'Cosmetic deleted');
  await expect(row).toHaveCount(0);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import' }).click();
  await (await chooser).setFiles(file);
  await toast(page, 'Cosmetic imported');
  await expect(row).toContainText('epic');
});

import {
  adminSession,
  adminTab,
  createUser,
  expect,
  landing,
  lobby,
  nav,
  ok,
  test,
} from './support';
import type { Page } from '@playwright/test';

/* The 11 colour themes: picked in Settings > Preferences (stored per browser), and the admin's
 * default for browsers that never picked one. */

const THEMES = [
  ['inferno', 'Inferno'],
  ['arctic', 'Arctic'],
  ['toxic', 'Toxic'],
  ['crimson', 'Crimson'],
  ['midnight', 'Midnight'],
  ['daylight', 'Daylight'],
  ['sakura', 'Sakura'],
  ['sand', 'Sand'],
  ['frost', 'Frost'],
  ['blossom', 'Blossom'],
  ['dune', 'Dune'],
] as const;

const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

/** The colour a swatch dot shows, as the browser normalises it. */
const rgb = (page: Page, color: string) =>
  page.evaluate((c) => {
    const el = document.createElement('div');
    el.style.color = c;
    document.body.appendChild(el);
    const v = getComputedStyle(el).color;
    el.remove();
    return v;
  }, color);

test('every theme can be picked in the settings and survives a reload', async ({ page }) => {
  const user = await createUser();
  await lobby(page, user);
  await nav(page, 'Settings').click();
  await page.locator('#settings-tab-bar').getByRole('button', { name: 'Preferences' }).click();
  const picker = page.locator('#theme-picker');
  await expect(picker.getByRole('button')).toHaveCount(THEMES.length);

  for (const [id, name] of THEMES) {
    const swatch = picker.getByRole('button', { name, exact: true });
    await swatch.click();
    await expect(swatch).toHaveClass(/active/);
    // The default palette (Inferno) is the stylesheet's own: no data-theme attribute.
    if (id === 'inferno') await expect(page.locator('html')).not.toHaveAttribute('data-theme');
    else await expect(page.locator('html')).toHaveAttribute('data-theme', id);
    const dot = await swatch
      .locator('.theme-swatch-dot')
      .first()
      .evaluate((el) => el.style.background);
    expect(await rgb(page, await cssVar(page, '--primary'))).toBe(await rgb(page, dot));
    expect(await page.evaluate(() => localStorage.getItem('blast-arena-theme'))).toBe(id);
  }
  await expect(picker.locator('.theme-swatch.active')).toHaveCount(1);

  // The inline boot script applies the stored theme before the app loads.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dune');
  await page.evaluate(() => localStorage.setItem('blast-arena-theme', 'inferno'));
});

test(
  'the admin default theme applies to browsers without a choice',
  { tag: '@global' },
  async ({ page, browser }) => {
    const { token } = await adminSession();
    const boss = await createUser('admin', 'a');
    await lobby(page, boss);
    await adminTab(page, 'Dashboard');
    const select = page.getByRole('combobox', { name: 'Default Theme' });
    await expect(select).toHaveValue('inferno');
    try {
      await select.selectOption('midnight');
      await expect(page.locator('.toast').filter({ hasText: /Midnight/ })).toBeVisible();

      const fresh = await browser.newContext();
      const guest = await fresh.newPage();
      await landing(guest);
      await expect(guest.locator('html')).toHaveAttribute('data-theme', 'midnight');
      // A browser's own pick wins over the default.
      await guest.evaluate(() => localStorage.setItem('blast-arena-theme', 'sand'));
      await guest.reload();
      await expect(guest.locator('html')).toHaveAttribute('data-theme', 'sand');
      await fresh.close();
    } finally {
      await ok('PUT', '/admin/settings/default_theme', token, { theme: 'inferno' });
    }
  },
);

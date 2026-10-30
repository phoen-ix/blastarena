import { test, expect, admin, createUser, ok, openLobby, openView, uniq } from './lib';

/* The admin's persistent banner (Admin > Announcements) sits above every lobby view. It used to
 * render only above the room list, and the lobby opens on Open World. Server-wide state: @global
 * runs it alone (scripts/e2e.sh, second phase). */

test(
  'the admin banner shows above every lobby view, live and after a reload',
  { tag: '@global' },
  async ({ page }) => {
    const a = await admin();
    const u = await createUser('ban');
    await openLobby(page, u);
    await expect(page.locator('#nav-openWorld')).toHaveClass(/active/);
    const banner = page.locator('#lobby-banner-area .admin-banner');
    const message = uniq('Maintenance at noon ');
    try {
      await ok('POST', '/admin/announcements/banner', a.token, { message });
      await expect(banner).toContainText(message);
      for (const id of ['rooms', 'friends', 'settings', 'openWorld']) {
        await openView(page, id);
        await expect(banner, `view ${id}`).toContainText(message);
      }

      await page.reload();
      await expect(page.locator('.hud-ow-board')).toBeVisible({ timeout: 60_000 });
      await page.keyboard.press('Escape');
      await page.locator('#leave-confirm').click();
      await expect(page.getByRole('button', { name: 'Join World' })).toBeVisible();
      await expect(banner).toContainText(message);

      // Dismissed, it stays away while the player moves between views.
      await banner.getByRole('button').click();
      await expect(banner).toHaveCount(0);
      await openView(page, 'rooms');
      await expect(banner).toHaveCount(0);

      // Cleared by the admin, it is gone live; a new one shows at once.
      await ok('DELETE', '/admin/announcements/banner', a.token);
      const next = uniq('Server restart ');
      await ok('POST', '/admin/announcements/banner', a.token, { message: next });
      await expect(banner).toContainText(next);
      await ok('DELETE', '/admin/announcements/banner', a.token);
      await expect(banner).toHaveCount(0);
    } finally {
      await ok('DELETE', '/admin/announcements/banner', a.token);
    }
  },
);

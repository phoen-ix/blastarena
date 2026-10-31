import {
  adminTab,
  api,
  createUser,
  expect,
  leaveWorld,
  lobby,
  nav,
  PASSWORD,
  resetRateLimits,
  sql,
  test,
  uid,
} from './support';
import type { Page } from '@playwright/test';

/* Admin > Users (search, create, role, deactivate, reset password, revoke sessions, reset 2FA,
 * delete, account cleanup), Admin > Logs (the audit trail of those) and Admin > Announcements. */

async function asAdmin(page: Page): Promise<void> {
  await lobby(page, await createUser('admin', 'a'));
  await adminTab(page, 'Users');
}

async function find(page: Page, username: string) {
  await page.getByRole('textbox', { name: 'Search by username or email' }).fill(username);
  const row = page.getByRole('row').filter({ hasText: username });
  await expect(row).toHaveCount(1);
  return row;
}

const loginStatus = async (username: string, password = PASSWORD) => {
  resetRateLimits();
  return (await api('POST', '/auth/login', undefined, { username, password })).status;
};

test('search and create a user', async ({ page }) => {
  await asAdmin(page);
  await page.getByRole('button', { name: 'Create User' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create User' });
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.locator('#cu-error')).toHaveText(
    'Username, email, and password are required',
  );
  const name = `c${uid()}`;
  await dialog.getByLabel('Username').fill(name);
  await dialog.getByLabel('Email').fill(`${name}@blast-e2e.example`);
  await dialog.getByLabel('Password').fill('12345');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.locator('#cu-error')).toHaveText('Password must be at least 6 characters');
  await dialog.getByLabel('Password').fill(PASSWORD);
  await dialog.getByLabel('Role').selectOption('moderator');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.toast').filter({ hasText: `User "${name}" created` })).toBeVisible();
  const row = await find(page, name);
  await expect(row).toContainText('moderator');
  await expect(row).toContainText('Active');
  // Created verified: can sign in at once.
  expect(await loginStatus(name)).toBe(200);
  // A duplicate is refused in the dialog.
  await page.getByRole('button', { name: 'Create User' }).click();
  await dialog.getByLabel('Username').fill(name);
  await dialog.getByLabel('Email').fill(`x${name}@blast-e2e.example`);
  await dialog.getByLabel('Password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.locator('#cu-error')).not.toBeEmpty();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('change a role, with confirmation', async ({ page }) => {
  const user = await createUser();
  await asAdmin(page);
  const row = await find(page, user.username);
  await row.getByRole('combobox').selectOption('moderator');
  const confirm = page.getByRole('dialog', { name: 'Change Role' });
  await expect(confirm).toContainText(`Change the role of ${user.username} to moderator?`);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(row.getByRole('combobox')).toHaveValue('user');
  await row.getByRole('combobox').selectOption('moderator');
  await confirm.getByRole('button', { name: 'Confirm' }).click();
  await expect(
    page.locator('.toast').filter({ hasText: 'Role changed to moderator' }),
  ).toBeVisible();
  expect(sql(`SELECT role FROM users WHERE id = ${user.id}`).trim()).toBe('moderator');
});

test('deactivate and reactivate', async ({ page }) => {
  const user = await createUser();
  await asAdmin(page);
  let row = await find(page, user.username);
  await row.getByRole('button', { name: 'Deactivate' }).click();
  await page
    .getByRole('dialog', { name: 'Deactivate User' })
    .getByRole('button', { name: 'Deactivate' })
    .click();
  await expect(page.locator('.toast').filter({ hasText: 'User deactivated' })).toBeVisible();
  row = await find(page, user.username);
  await expect(row).toContainText('Deactivated');
  expect(await loginStatus(user.username)).toBe(403);
  await row.getByRole('button', { name: 'Reactivate' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'User reactivated' })).toBeVisible();
  expect(await loginStatus(user.username)).toBe(200);
});

test('reset a password and revoke sessions', async ({ page, browser }) => {
  const user = await createUser();
  // The player is signed in elsewhere.
  const ctx = await browser.newContext();
  const player = await ctx.newPage();
  await lobby(player, user);

  await asAdmin(page);
  const row = await find(page, user.username);
  await row.getByRole('button', { name: 'Revoke Sessions' }).click();
  await page
    .getByRole('dialog', { name: 'Revoke Sessions' })
    .getByRole('button', { name: 'Revoke Sessions' })
    .click();
  await expect(page.locator('.toast').filter({ hasText: 'User sessions revoked' })).toBeVisible();
  // The refresh cookie is dead: a reload lands on the landing page.
  await player.reload();
  await expect(player.getByRole('button', { name: 'Login' })).toBeVisible();
  await ctx.close();

  await row.getByRole('button', { name: 'Reset PW' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset Password' });
  await dialog.getByLabel('New Password').fill('Admin-Set-2026');
  await dialog.getByLabel('Confirm Password').fill('Admin-Set-2027');
  await dialog.getByRole('button', { name: 'Reset Password' }).click();
  await expect(dialog.locator('#rp-error')).toHaveText('Passwords do not match');
  await dialog.getByLabel('Confirm Password').fill('Admin-Set-2026');
  await dialog.getByRole('button', { name: 'Reset Password' }).click();
  await expect(
    page.locator('.toast').filter({ hasText: `Password reset for "${user.username}"` }),
  ).toBeVisible();
  expect(await loginStatus(user.username)).toBe(401);
  expect(await loginStatus(user.username, 'Admin-Set-2026')).toBe(200);
});

test('reset 2FA from the users table', async ({ page }) => {
  const user = await createUser();
  // 2FA on, as the settings flow leaves it (secret + flag).
  sql(`UPDATE users SET totp_enabled = TRUE, totp_secret = 'e2e' WHERE id = ${user.id}`);
  await asAdmin(page);
  const row = await find(page, user.username);
  await expect(row).toContainText('Enabled');
  await row.getByRole('button', { name: 'Reset 2FA' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset Two-Factor Authentication' });
  await dialog.getByRole('button', { name: 'Reset 2FA' }).click();
  await expect(
    page.locator('.toast').filter({ hasText: 'Two-factor authentication reset' }),
  ).toBeVisible();
  expect(sql(`SELECT totp_enabled FROM users WHERE id = ${user.id}`).trim()).toBe('0');
});

test('delete a user', async ({ page }) => {
  const user = await createUser();
  await asAdmin(page);
  const row = await find(page, user.username);
  await row.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete User' });
  await expect(dialog).toContainText(user.username);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await row.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(
    page.locator('.toast').filter({ hasText: 'User deleted permanently' }),
  ).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: user.username })).toHaveCount(0);
  expect(sql(`SELECT COUNT(*) FROM users WHERE id = ${user.id}`).trim()).toBe('0');
});

test('account cleanup previews and deletes old unverified accounts', async ({ page }) => {
  // An unverified account from 400 days ago (backdated).
  const stale = await createUser();
  sql(
    `UPDATE users SET email_verified = FALSE, created_at = NOW() - INTERVAL 400 DAY WHERE id = ${stale.id}`,
  );
  await asAdmin(page);
  await page.getByRole('button', { name: 'Account Cleanup' }).click();
  const dialog = page.getByRole('dialog', { name: 'Account Cleanup' });
  await dialog.getByRole('button', { name: 'Preview' }).click();
  await expect(dialog.locator('#cleanup-error')).toHaveText(
    'Days threshold is required for this cleanup type',
  );
  await dialog.getByLabel('Older than (days)').fill('365');
  await dialog.getByRole('button', { name: 'Preview' }).click();
  await expect(dialog.locator('#cleanup-preview-result')).toContainText(/\d+ account\(s\) match/);
  const execute = dialog.getByRole('button', { name: /Delete \d+ accounts/ });
  await expect(execute).toBeDisabled();
  await dialog.getByLabel('Type DELETE to confirm bulk deletion').fill('DELETE');
  await execute.click();
  await expect(
    page.locator('.toast').filter({ hasText: /Deleted \d+ account\(s\)/ }),
  ).toBeVisible();
  expect(sql(`SELECT COUNT(*) FROM users WHERE id = ${stale.id}`).trim()).toBe('0');
});

test('logs list the admin actions and filter by type', async ({ page }) => {
  const user = await createUser();
  await asAdmin(page);
  let row = await find(page, user.username);
  await row.getByRole('button', { name: 'Deactivate' }).click();
  await page
    .getByRole('dialog', { name: 'Deactivate User' })
    .getByRole('button', { name: 'Deactivate' })
    .click();
  await expect(page.locator('.toast').filter({ hasText: 'User deactivated' })).toBeVisible();
  row = await find(page, user.username);
  await row.getByRole('button', { name: 'Reactivate' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'User reactivated' })).toBeVisible();

  await adminTab(page, 'Logs');
  const filter = page.getByRole('combobox', { name: 'Filter by action:' });
  await filter.selectOption('deactivate');
  const rows = page.locator('.log-row');
  const mine = rows.filter({ has: page.getByRole('cell', { name: String(user.id), exact: true }) });
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText('deactivate');
  await expect(rows.filter({ hasText: 'reactivate' })).toHaveCount(0);
  await filter.selectOption('reactivate');
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText('reactivate');
  // A row opens its details.
  await mine.click();
  await expect(page.locator('.log-detail-row').first()).toBeVisible();
});

test(
  'announcements: a toast reaches players, a banner stays until cleared',
  { tag: '@global' },
  async ({ page, browser }) => {
    const ctx = await browser.newContext();
    const player = await ctx.newPage();
    await lobby(player, await createUser());

    await lobby(page, await createUser('admin', 'a'));
    await adminTab(page, 'Announcements');
    await page.getByRole('button', { name: 'Send Toast' }).click();
    await expect(page.locator('.toast').filter({ hasText: /empty/i })).toBeVisible();
    const toast = `Maintenance at noon ${uid()}`;
    await page.getByRole('textbox', { name: 'Toast message' }).fill(toast);
    await expect(page.locator('#toast-preview-area')).toContainText(toast);
    await page.getByRole('button', { name: 'Send Toast' }).click();
    await expect(player.locator('.toast').filter({ hasText: toast })).toBeVisible();

    const banner = `Season finale this weekend ${uid()}`;
    await page.getByRole('textbox', { name: 'Banner message' }).fill(banner);
    await page.getByRole('button', { name: 'Set Banner' }).click();
    await expect(page.locator('.admin-banner')).toContainText(banner);
    // Players see it above the room list (live, and after a reload).
    await nav(player, 'Rooms').click();
    await expect(player.getByText(banner)).toBeVisible();
    await player.reload();
    await leaveWorld(player);
    await nav(player, 'Rooms').click();
    await expect(player.getByText(banner)).toBeVisible();
    await page.getByRole('button', { name: 'Clear Banner' }).click();
    await expect(page.getByText('No active banner')).toBeVisible();
    await expect(player.getByText(banner)).toHaveCount(0);
    await ctx.close();
  },
);

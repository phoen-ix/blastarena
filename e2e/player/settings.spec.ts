import type { Page } from '@playwright/test';

import {
  test,
  expect,
  api,
  createUser,
  linkIn,
  login,
  mailTo,
  newPage,
  openLobby,
  openView,
  PASSWORD,
  resetRateLimits,
  sql,
  totp,
  uniq,
} from './lib';

/* Settings: account (username, email change by mail, password, 2FA, delete), preferences
 * (theme, art style, language, graphics, audio, lobby chat), privacy, cosmetics. */

async function settingsTab(page: Page, tab: string): Promise<void> {
  await page.locator(`#settings-tab-bar [data-tab="${tab}"]`).click();
  await expect(page.locator(`#settings-tab-bar [data-tab="${tab}"]`)).toHaveClass(/active/);
}

test('account: rename, change password', async ({ page }) => {
  const u = await createUser('acc');
  await openLobby(page, u);
  await openView(page, 'settings');
  await expect(page.getByRole('heading', { name: 'Two-Factor Authentication' })).toBeVisible();

  const renamed = uniq('ren');
  await page.getByLabel('Username').fill(renamed);
  await page.getByRole('button', { name: 'Save Username' }).click();
  await expect(page.getByText('Profile updated!')).toBeVisible();
  await expect(page.locator('.sidebar-user-name')).toHaveText(renamed);

  const pw = page.locator('#acct-password-status');
  await page.getByRole('button', { name: 'Change Password' }).click();
  await expect(pw).toHaveText('Please fill in both password fields.');
  await page.getByLabel('Current password').fill('wrong-password');
  await page.getByLabel('New password (min 8 characters)').fill('Changed-2026a');
  await page.getByLabel('Confirm new password').fill('Changed-2026b');
  await page.getByRole('button', { name: 'Change Password' }).click();
  await expect(pw).toHaveText('New passwords do not match.');
  await page.getByLabel('Confirm new password').fill('Changed-2026a');
  await page.getByRole('button', { name: 'Change Password' }).click();
  await expect(pw.locator('.text-danger')).toBeVisible();
  await page.getByLabel('Current password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Change Password' }).click();
  await expect(pw.locator('.text-success')).toBeVisible();
  await login(renamed, 'Changed-2026a');
});

test('account: email change confirmed through the mailed link', async ({ page }) => {
  const u = await createUser('eml');
  await openLobby(page, u);
  await openView(page, 'settings');
  const to = `${uniq('new').toLowerCase()}@blast-e2e.example`;
  await page.getByRole('textbox', { name: 'New email address' }).fill(to);
  await page.getByRole('button', { name: 'Send Confirmation' }).click();
  await expect(page.locator('#acct-email-status .text-success')).toBeVisible();

  await page.goto(linkIn((await mailTo(to)).text));
  await expect(page.getByText('Email address updated!')).toBeVisible();
  // The new address now receives the account's mail.
  resetRateLimits();
  await api('POST', '/auth/forgot-password', undefined, { email: to });
  await mailTo(to, /reset/i);
});

test('account: two-factor login, then disable it', async ({ page }) => {
  const u = await createUser('tfa');
  await openLobby(page, u);
  await openView(page, 'settings');
  await page.getByRole('button', { name: 'Enable 2FA' }).click();
  const setup = page.getByRole('dialog', { name: 'Set Up Two-Factor Authentication' });
  const secret = (await setup.locator('code').textContent())!.trim();
  const backup = (await setup.locator('pre').textContent())!.trim().split('\n')[0];
  await setup.getByPlaceholder('000000').fill('000000');
  await setup.getByRole('button', { name: 'Confirm & Enable' }).click();
  await expect(setup.locator('#totp-setup-status')).toContainText('Invalid verification code');
  const usedStep = Math.floor(Date.now() / 30_000);
  await setup.getByPlaceholder('000000').fill(totp(secret));
  await setup.getByRole('button', { name: 'Confirm & Enable' }).click();
  await expect(page.getByText('Two-factor authentication is enabled.')).toBeVisible();

  // Sign out; signing in now asks for a code.
  await page.locator('#nav-logout').click();
  resetRateLimits();
  await page.getByRole('button', { name: 'Login' }).click();
  await page.getByLabel('Username').fill(u.username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.locator('#login-btn').click();
  await expect(page.getByText('Enter the 6-digit code from your authenticator app.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Verification Code' }).fill('123456');
  await page.locator('#totp-btn').click();
  await expect(page.locator('#totp-error')).toHaveText(
    'Invalid verification code. Please try again.',
  );
  // A code is good once: wait for the next 30 s window after the one setup used.
  await expect
    .poll(() => Math.floor(Date.now() / 30_000), { timeout: 35_000, intervals: [1_000] })
    .toBeGreaterThan(usedStep);
  await page.getByRole('textbox', { name: 'Verification Code' }).fill(totp(secret));
  await page.locator('#totp-btn').click();
  await expect(page.locator('.hud-ow-board')).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Escape');
  await page.locator('#leave-confirm').click();

  // Disable with a backup code.
  await openView(page, 'settings');
  await page.getByRole('button', { name: 'Disable 2FA' }).click();
  const off = page.getByRole('dialog', { name: 'Disable Two-Factor Authentication' });
  await off.getByPlaceholder('Password').fill(PASSWORD);
  await off.getByPlaceholder('Authenticator code or backup code').fill(backup);
  await off.getByRole('button', { name: 'Disable 2FA' }).click();
  await expect(page.getByRole('button', { name: 'Enable 2FA' })).toBeVisible();
});

test('account: delete asks for the password, then the account is gone', async ({ page }) => {
  const u = await createUser('del');
  await openLobby(page, u);
  await openView(page, 'settings');
  await page.getByRole('button', { name: 'Delete Account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Account' });
  await dialog.getByRole('button', { name: 'Delete My Account' }).click();
  await expect(dialog.getByText('Please enter your password.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Delete Account' }).click();
  await dialog.getByLabel('Enter your password to confirm').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Delete My Account' }).click();
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  resetRateLimits();
  const res = await api('POST', '/auth/login', undefined, {
    username: u.username,
    password: PASSWORD,
  });
  expect(res.status).toBe(401);
});

test('preferences: theme, art style, graphics, audio, lobby chat stick across reloads', async ({
  page,
}) => {
  const u = await createUser('prf');
  await openLobby(page, u);
  await openView(page, 'settings');
  await settingsTab(page, 'preferences');

  await page.locator('.theme-swatch[data-theme="daylight"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'daylight');
  const art = page.locator('.art-style-card').nth(1);
  await art.click();
  await expect(art).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('group', { name: 'Graphics quality' }).getByRole('button').first().click();
  await expect(
    page.getByRole('group', { name: 'Graphics quality' }).getByRole('button').first(),
  ).toHaveAttribute('aria-pressed', 'true');
  const shake = page.getByRole('switch', { name: 'Screen Shake' });
  const wasOn = await shake.isChecked();
  await shake.locator('..').click();
  await expect(shake).toBeChecked({ checked: !wasOn });
  await page.getByRole('switch', { name: 'Mute' }).locator('..').click();
  await expect(page.getByRole('switch', { name: 'Mute' })).toBeChecked();
  await page.getByRole('slider', { name: 'Master Volume' }).fill('40');

  // Lobby chat off hides the dock.
  await expect(page.locator('.lobby-chat-toggle')).toBeVisible();
  await page.getByRole('switch', { name: 'Lobby Chat' }).locator('..').click();
  await expect(page.locator('.lobby-chat-toggle')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.hud-ow-board')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'daylight');
  await page.keyboard.press('Escape');
  await page.locator('#leave-confirm').click();
  await openView(page, 'settings');
  await settingsTab(page, 'preferences');
  await expect(page.getByRole('switch', { name: 'Screen Shake' })).toBeChecked({ checked: !wasOn });
  await expect(page.getByRole('switch', { name: 'Mute' })).toBeChecked();
  await expect(page.getByRole('slider', { name: 'Master Volume' })).toHaveValue('40');
  await expect(page.locator('.art-style-card').nth(1)).toHaveAttribute('aria-pressed', 'true');
});

test('preferences: language switches the UI and is kept for the account', async ({
  page,
  browser,
  guard,
}) => {
  const u = await createUser('lng');
  await openLobby(page, u);
  await openView(page, 'settings');
  await settingsTab(page, 'preferences');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('de');
  await expect(page.locator('#nav-settings')).toContainText('Einstellungen');
  await expect(page.locator('#nav-rooms')).toContainText('Räume');

  // Saved on the server: a fresh browser (English) signs in and gets German.
  await expect.poll(() => sql(`SELECT language FROM users WHERE id = ${u.id}`).trim()).toBe('de');
  const fresh = await newPage(browser, guard);
  await openLobby(fresh, u);
  await expect(fresh.locator('#nav-settings')).toContainText('Einstellungen');
  await fresh.context().close();
});

test('privacy: switches save and take effect for other players', async ({ page }) => {
  const [u, other] = [await createUser('prv'), await createUser('prvo')];
  await openLobby(page, u);
  await openView(page, 'settings');
  await settingsTab(page, 'privacy');
  const accept = page.getByRole('checkbox', { name: /Accept Friend Requests/ });
  await expect(accept).toBeChecked();
  await accept.click();
  await expect(page.locator('#privacy-status')).toContainText('Saved!');
  await page.getByRole('checkbox', { name: /Public Profile/ }).click();
  await expect(page.locator('#privacy-status')).toContainText('Saved!');

  const profile = await api('GET', `/user/${u.id}/public`, other.token);
  expect(profile.status).toBeGreaterThanOrEqual(400);
});

test('cosmetics: equip an owned item, locked ones cannot be picked', async ({ page }) => {
  const u = await createUser('cos');
  const id = sql(
    `SELECT id FROM cosmetics WHERE type = 'color' AND is_active ORDER BY id LIMIT 1`,
  ).trim();
  sql(`INSERT IGNORE INTO user_cosmetics (user_id, cosmetic_id) VALUES (${u.id}, ${id})`);
  await openLobby(page, u);
  await openView(page, 'settings');
  await settingsTab(page, 'cosmetics');
  const item = page.locator(`.cosmetic-item[data-cosmetic-id="${id}"]`);
  await item.click();
  await expect(page.getByText('Cosmetic updated')).toBeVisible();
  await expect(item).toHaveClass(/equipped/);
  expect(sql(`SELECT color_id FROM user_equipped_cosmetics WHERE user_id = ${u.id}`).trim()).toBe(
    id,
  );
  await expect(page.locator('.cosmetic-item:has(.locked-label)').first()).toBeDisabled();
});

import {
  adminSession,
  api,
  authForm,
  createUser,
  expect,
  firstLink,
  landing,
  leaveWorld,
  lobby,
  mailCount,
  mailTo,
  nav,
  ok,
  PASSWORD,
  resetRateLimits,
  signIn,
  sql,
  test,
  token,
  totp,
  uid,
  type Account,
} from './support';
import type { Page } from '@playwright/test';

/* Account flows: register, verify by mail, resend, password reset, two-factor sign-in, and the
 * Settings > Account forms. Mail goes to Mailpit. Serial: one test toggles registration off. */
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await adminSession();
});

async function openRegister(page: Page): Promise<void> {
  resetRateLimits();
  await landing(page);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(authForm(page).getByRole('heading', { name: /CREATE/ })).toBeVisible();
}

async function register(page: Page, username: string, email: string, password = PASSWORD) {
  const form = authForm(page);
  await form.getByLabel('Username').fill(username);
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Password').fill(password);
  await form.getByRole('button', { name: 'Register', exact: true }).click();
}

async function openAccount(page: Page): Promise<void> {
  await nav(page, 'Settings').click();
  await page.locator('#settings-tab-bar').getByRole('button', { name: 'Account' }).click();
  await expect(page.getByRole('heading', { name: 'Two-Factor Authentication' })).toBeVisible();
}

test.describe('register and verify', () => {
  test('the form checks its fields before and on the server', async ({ page }) => {
    await openRegister(page);
    const form = authForm(page);
    await form.getByRole('button', { name: 'Register', exact: true }).click();
    await expect(form.locator('.form-error')).toHaveText('Please fill in all required fields');
    await register(page, `r${uid()}`, `r${uid()}@blast-e2e.example`, 'short');
    await expect(form.locator('.form-error')).not.toBeEmpty();
    await register(page, 'a!', `r${uid()}@blast-e2e.example`);
    await expect(form.locator('.form-error')).not.toBeEmpty();
    // A taken username is refused (usernames are public).
    const taken = await createUser();
    await register(page, taken.username, `r${uid()}@blast-e2e.example`);
    await expect(form.locator('.form-error')).toContainText(/taken|exists/i);
  });

  test('register, get stuck at verification, verify by mail, play', async ({ page }) => {
    const name = `r${uid()}`;
    const email = `${name}@blast-e2e.example`;
    await openRegister(page);
    await register(page, name, email);
    await expect(page.locator('.toast').filter({ hasText: /check your email/i })).toBeVisible();
    await expect(authForm(page).getByRole('heading', { name: /BLAST/ })).toBeVisible();

    // Signing in before verifying lands on the verification screen.
    await signIn(page, { username: name, password: PASSWORD });
    await expect(page.getByRole('heading', { name: /VERIFY/ })).toBeVisible();
    await expect(page.getByText(`Logged in as ${name}`)).toBeVisible();
    await page.getByRole('button', { name: /I've Verified/ }).click();
    await expect(page.locator('#verify-status')).toHaveText(/not yet verified/i);

    const mail = await mailTo(email, /Verify your BlastArena account/);
    await page.goto(firstLink(mail.html));
    await expect(
      page.locator('.toast').filter({ hasText: 'Email verified successfully!' }),
    ).toBeVisible();
    // Still signed in (refresh cookie): straight into the game.
    await expect(page.locator('.hud-ow-board')).toBeVisible();
    // The link is single-use.
    const again = await page.request.get(firstLink(mail.html), { maxRedirects: 0 });
    expect(again.status()).toBe(400);
  });

  test('resend the verification mail, then go back to login', async ({ page }) => {
    const name = `r${uid()}`;
    const email = `${name}@blast-e2e.example`;
    await openRegister(page);
    await register(page, name, email);
    await expect(page.locator('.toast').filter({ hasText: /check your email/i })).toBeVisible();
    await mailTo(email, /Verify/);
    await signIn(page, { username: name, password: PASSWORD });
    await page.getByRole('button', { name: 'Resend' }).click();
    await expect(page.locator('#verify-status')).toHaveText('Please enter your email address');
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    resetRateLimits();
    await page.getByRole('button', { name: 'Resend' }).click();
    await expect(page.locator('#verify-status')).toHaveText('Verification email sent!');
    await expect(page.getByRole('button', { name: /Sent \(\d+s\)/ })).toBeDisabled();
    await expect.poll(() => mailCount(email)).toBe(2);
    await page.getByRole('button', { name: 'Back to Login' }).click();
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  });

  test('three registrations racing for one name: one wins, the others hear it is taken', async () => {
    resetRateLimits(); // 3 registrations per 15 min per address
    const name = `race${uid()}`.slice(0, 20);
    const results = await Promise.all(
      [0, 1, 2].map((i) =>
        api('POST', '/auth/register', undefined, {
          username: name,
          email: `${name}.${i}@blast-e2e.example`,
          password: PASSWORD,
        }),
      ),
    );
    // Not a 500 from the unique index: the losers get the same 409 as a late registration.
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });

  test('registering a taken email looks the same and warns the owner', async ({ page }) => {
    const owner = await createUser();
    await openRegister(page);
    await register(page, `r${uid()}`, owner.email);
    await expect(page.locator('.toast').filter({ hasText: /check your email/i })).toBeVisible();
    await mailTo(owner.email, /tried to create a BlastArena account/);
  });

  test(
    'with registration off there is no way to register',
    { tag: '@global' },
    async ({ page }) => {
      const { token: t } = await adminSession();
      await ok('PUT', '/admin/settings/registration_enabled', t, { enabled: false });
      try {
        await landing(page);
        await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Register' })).toHaveCount(0);
        // Nor on the guest's in-game bar.
        await page.getByRole('button', { name: 'Play as Guest' }).click();
        await expect(
          page.locator('.hud-auth-bar').getByRole('button', { name: 'Login' }),
        ).toBeVisible();
        await expect(
          page.locator('.hud-auth-bar').getByRole('button', { name: 'Register' }),
        ).toHaveCount(0);
        await landing(page);
        await page.getByRole('button', { name: 'Login' }).click();
        await expect(authForm(page).getByRole('button', { name: 'Register' })).toHaveCount(0);
        resetRateLimits();
        const res = await api('POST', '/auth/register', undefined, {
          username: `r${uid()}`,
          email: `r${uid()}@blast-e2e.example`,
          password: PASSWORD,
        });
        expect(res.status).toBe(403);
      } finally {
        await ok('PUT', '/admin/settings/registration_enabled', t, { enabled: true });
      }
    },
  );
});

test.describe('password reset', () => {
  async function requestReset(page: Page, email: string): Promise<void> {
    resetRateLimits();
    await landing(page);
    await page.getByRole('button', { name: 'Login' }).click();
    await authForm(page).getByRole('button', { name: 'Forgot password?' }).click();
    await authForm(page).getByLabel('Email').fill(email);
    await authForm(page).getByRole('button', { name: 'Send Reset Link' }).click();
    await expect(page.locator('.toast').filter({ hasText: /reset link/i })).toBeVisible();
  }

  test('forgot password, new password from the mail link, sign in with it', async ({ page }) => {
    const user = await createUser();
    await requestReset(page, user.email);
    const mail = await mailTo(user.email, /Reset your BlastArena password/);
    await page.goto(firstLink(mail.html));
    const form = authForm(page);
    await expect(form.getByRole('heading', { name: /NEW/ })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    await form.getByLabel('New Password').fill('short');
    await form.getByLabel('Confirm Password').fill('short');
    await form.getByRole('button', { name: 'Set New Password' }).click();
    await expect(form.locator('#reset-error')).not.toBeEmpty();
    await form.getByLabel('New Password').fill('Fresh-Pass-2026');
    await form.getByLabel('Confirm Password').fill('Fresh-Pass-2027');
    await form.getByRole('button', { name: 'Set New Password' }).click();
    await expect(form.locator('#reset-error')).toHaveText(/do not match/i);
    await form.getByLabel('Confirm Password').fill('Fresh-Pass-2026');
    resetRateLimits();
    await form.getByRole('button', { name: 'Set New Password' }).click();
    await expect(page.locator('.toast').filter({ hasText: /password/i })).toBeVisible();

    resetRateLimits();
    expect((await api('POST', '/auth/login', undefined, user)).status).toBe(401);
    await lobby(page, { username: user.username, password: 'Fresh-Pass-2026' });
  });

  test('a used reset link offers a new one', async ({ page }) => {
    const user = await createUser();
    await requestReset(page, user.email);
    const link = firstLink((await mailTo(user.email, /Reset your BlastArena password/)).html);
    // Used once (through the API) ...
    resetRateLimits();
    const token = new URL(link).searchParams.get('token');
    await ok('POST', '/auth/reset-password', undefined, { token, password: 'Fresh-Pass-2026' });
    // ... and refused the second time, with a way to ask for a new one.
    await page.goto(link);
    const form = authForm(page);
    await form.getByLabel('New Password').fill('Other-Pass-2026');
    await form.getByLabel('Confirm Password').fill('Other-Pass-2026');
    resetRateLimits();
    await form.getByRole('button', { name: 'Set New Password' }).click();
    await expect(form.locator('#reset-error')).not.toBeEmpty();
    await form.getByRole('button', { name: 'Request a new reset link' }).click();
    await expect(form.getByRole('button', { name: 'Send Reset Link' })).toBeVisible();
  });

  test('an unknown address gets the same answer and no mail', async ({ page }) => {
    const email = `nobody${uid()}@blast-e2e.example`;
    await requestReset(page, email);
    expect(await mailCount(email)).toBe(0);
  });
});

test.describe('two-factor authentication', () => {
  async function enable2fa(page: Page): Promise<{ secret: string; backup: string[] }> {
    await openAccount(page);
    await page.getByRole('button', { name: 'Enable 2FA' }).click();
    const dialog = page.getByRole('dialog', { name: 'Set Up Two-Factor Authentication' });
    await expect(dialog.getByRole('img', { name: 'TOTP QR Code' })).toBeVisible();
    const secret = (await dialog.locator('code').textContent())!.trim();
    await dialog.getByText('Backup Codes').click();
    const backup = (await dialog.locator('pre').textContent())!.trim().split('\n');
    expect(backup).toHaveLength(10);
    await dialog.getByLabel('Verification Code').fill('000000');
    await dialog.getByRole('button', { name: 'Confirm & Enable' }).click();
    await expect(dialog.locator('#totp-setup-status')).not.toBeEmpty();
    resetRateLimits();
    await dialog.getByLabel('Verification Code').fill(totp(secret));
    await dialog.getByRole('button', { name: 'Confirm & Enable' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Two-factor authentication is enabled.')).toBeVisible();
    return { secret, backup };
  }

  async function codeStep(page: Page, user: Account): Promise<void> {
    await signIn(page, user);
    await expect(
      authForm(page).getByRole('heading', { name: 'Two-Factor Authentication' }),
    ).toBeVisible();
  }

  test('enable, sign in with a code and with a backup code, then disable', async ({ page }) => {
    const user = await createUser();
    await lobby(page, user);
    const { secret, backup } = await enable2fa(page);

    // A password alone is no longer enough (signed out first: the session cookie would sign in).
    await page.context().clearCookies();
    await codeStep(page, user);
    const form = authForm(page);
    await form.getByLabel('Verification Code').fill('123456');
    await form.getByRole('button', { name: 'Verify' }).click();
    await expect(form.locator('#totp-error')).not.toBeEmpty();
    await form.getByLabel('Verification Code').fill(totp(secret, 1));
    await form.getByRole('button', { name: 'Verify' }).click();
    await expect(page.locator('.hud-ow-board')).toBeVisible();

    // Backup codes work once.
    await page.context().clearCookies();
    await codeStep(page, user);
    await authForm(page).getByLabel('Verification Code').fill(backup[0]);
    await authForm(page).getByRole('button', { name: 'Verify' }).click();
    await expect(page.locator('.hud-ow-board')).toBeVisible();
    await page.context().clearCookies();
    await codeStep(page, user);
    await authForm(page).getByLabel('Verification Code').fill(backup[0]);
    await authForm(page).getByRole('button', { name: 'Verify' }).click();
    await expect(authForm(page).locator('#totp-error')).not.toBeEmpty();
    await authForm(page).getByRole('button', { name: 'Back to Login' }).click();
    await expect(authForm(page).getByRole('heading', { name: /BLAST/ })).toBeVisible();

    // Disable with password + a backup code.
    await page.context().clearCookies();
    await codeStep(page, user);
    await authForm(page).getByLabel('Verification Code').fill(backup[1]);
    await authForm(page).getByRole('button', { name: 'Verify' }).click();
    await leaveWorld(page);
    await openAccount(page);
    await page.getByRole('button', { name: 'Disable 2FA' }).click();
    const dialog = page.getByRole('dialog', { name: 'Disable Two-Factor Authentication' });
    await dialog.getByLabel('Password').fill('wrong-password');
    await dialog.getByLabel('Authenticator code or backup code').fill(backup[2]);
    resetRateLimits();
    await dialog.getByRole('button', { name: 'Disable 2FA' }).click();
    await expect(dialog.locator('#disable-2fa-status')).not.toBeEmpty();
    await dialog.getByLabel('Password').fill(PASSWORD);
    resetRateLimits();
    await dialog.getByRole('button', { name: 'Disable 2FA' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Enable 2FA' })).toBeVisible();
    // Password alone again.
    expect(await token(user.username)).toBeTruthy();
  });

  test("an admin resets a user's 2FA", async ({ page }) => {
    const user = await createUser();
    await lobby(page, user);
    await enable2fa(page);
    const { token: t } = await adminSession();
    await ok('POST', `/admin/users/${user.id}/reset-totp`, t);
    resetRateLimits();
    const login = await api<{ accessToken?: string; totpRequired?: boolean }>(
      'POST',
      '/auth/login',
      undefined,
      user,
    );
    expect(login.data.totpRequired).toBeFalsy();
    expect(login.data.accessToken).toBeTruthy();
  });
});

test.describe('settings: account', () => {
  test('rename', async ({ page }) => {
    const user = await createUser();
    await lobby(page, user);
    await openAccount(page);
    const field = page.getByLabel('Username', { exact: true });
    await field.fill('');
    await page.getByRole('button', { name: 'Save Username' }).click();
    await expect(page.locator('#acct-profile-status')).toHaveText('Username cannot be empty.');
    await field.fill(user.username);
    await page.getByRole('button', { name: 'Save Username' }).click();
    await expect(page.locator('#acct-profile-status')).toHaveText('No changes to save.');
    const renamed = `n${uid()}`;
    await field.fill(renamed);
    await page.getByRole('button', { name: 'Save Username' }).click();
    await expect(page.locator('#acct-profile-status')).toHaveText('Profile updated!');
    // The sidebar following the new name: part a's player/settings.spec.ts.
    expect(await token(renamed)).toBeTruthy();
  });

  test('change password', async ({ page }) => {
    const user = await createUser();
    await lobby(page, user);
    await openAccount(page);
    const current = page.getByLabel('Current password');
    const next = page.getByLabel('New password (min 8 characters)');
    const confirm = page.getByLabel('Confirm new password');
    const save = page.getByRole('button', { name: 'Change Password' });
    const status = page.locator('#acct-password-status');
    await save.click();
    await expect(status).toHaveText('Please fill in both password fields.');
    await current.fill(PASSWORD);
    await next.fill('short');
    await save.click();
    await expect(status).toHaveText('New password must be at least 8 characters.');
    await next.fill('Second-Pass-2026');
    await confirm.fill('Second-Pass-2027');
    await save.click();
    await expect(status).toHaveText('New passwords do not match.');
    await current.fill('not-my-password');
    await confirm.fill('Second-Pass-2026');
    await save.click();
    await expect(status).toHaveClass(/settings-status/);
    await expect(status.locator('.text-danger')).toBeVisible();
    await current.fill(PASSWORD);
    await save.click();
    await expect(status).toHaveText('Password changed!');
    expect(await token(user.username, 'Second-Pass-2026')).toBeTruthy();
  });

  test('change email: confirmation mail, pending change, cancel and confirm', async ({ page }) => {
    const user = await createUser();
    await lobby(page, user);
    await openAccount(page);
    const field = page.getByLabel('New email address');
    const send = page.getByRole('button', { name: 'Send Confirmation' });
    await send.click();
    await expect(page.locator('#acct-email-status')).toHaveText('Enter a new email address.');

    // Request, see it pending, cancel it.
    const first = `m${uid()}@blast-e2e.example`;
    await field.fill(first);
    await send.click();
    await expect(page.locator('#acct-email-status')).toHaveText(
      'Confirmation email sent to your new address. The link expires in 24 hours.',
    );
    await mailTo(first, /Confirm your new email address/);
    await page.locator('#settings-tab-bar').getByRole('button', { name: 'Preferences' }).click();
    await page.locator('#settings-tab-bar').getByRole('button', { name: 'Account' }).click();
    await expect(page.getByText('Pending change to')).toBeVisible();
    await page.locator('.settings-pending-banner').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Pending change to')).toHaveCount(0);
    const stale = firstLink((await mailTo(first, /Confirm/)).html);

    // Request again and confirm through the link.
    const second = `m${uid()}@blast-e2e.example`;
    await field.fill(second);
    await send.click();
    const link = firstLink((await mailTo(second, /Confirm your new email address/)).html);
    expect((await page.request.get(stale, { maxRedirects: 0 })).status()).toBe(400);
    await page.goto(link);
    await expect(
      page.locator('.toast').filter({ hasText: 'Email address updated!' }),
    ).toBeVisible();
    // Password reset now goes to the new address.
    resetRateLimits();
    await ok('POST', '/auth/forgot-password', undefined, { email: second });
    await mailTo(second, /Reset your BlastArena password/);
  });

  test('an admin changes the email directly', async ({ page }) => {
    const boss = await createUser('admin', 'a');
    await lobby(page, boss);
    await openAccount(page);
    const email = `a${uid()}@blast-e2e.example`;
    await page.getByLabel('New email address').fill(email);
    await page.getByRole('button', { name: 'Change Email' }).click();
    await expect(page.locator('#acct-email-status')).toHaveText('Email address updated!');
    expect(await mailCount(email)).toBe(0);
    // Admins have no Danger Zone.
    await expect(page.getByRole('button', { name: 'Delete Account' })).toHaveCount(0);
  });

  test('delete the account', async ({ page }) => {
    const user = await createUser();
    await lobby(page, user);
    await openAccount(page);
    await page.getByRole('button', { name: 'Delete Account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete Account' });
    await dialog.getByRole('button', { name: 'Delete My Account' }).click();
    await expect(dialog.locator('#delete-status')).toHaveText('Please enter your password.');
    await dialog.getByLabel('Enter your password to confirm').fill('not-my-password');
    await dialog.getByRole('button', { name: 'Delete My Account' }).click();
    await expect(dialog.locator('#delete-status .text-danger')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Delete Account' }).click();
    await dialog.getByLabel('Enter your password to confirm').fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Delete My Account' }).click();
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    expect(sql(`SELECT COUNT(*) FROM users WHERE username = '${user.username}'`).trim()).toBe('0');
  });
});

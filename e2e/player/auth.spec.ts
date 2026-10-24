import {
  test,
  expect,
  api,
  createUser,
  linkIn,
  login,
  mailTo,
  newPage,
  PASSWORD,
  resetRateLimits,
  uniq,
} from './lib';

/* The landing page and every way in or out of an account: register, verify (link from Mailpit),
 * log in, wrong password, log out, forgot/reset password, the language picker. */

test.beforeEach(() => resetRateLimits());

test('landing offers guest play, login and register', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Play as Guest' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('button', { name: 'Register' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByLabel('Username')).toBeVisible();
});

test('register validates, then verify by mail and log in', async ({ page }) => {
  const username = uniq('reg');
  const email = `${username.toLowerCase()}@blast-e2e.example`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Register' }).click();

  // Client-side checks first.
  await page.locator('#reg-btn').click();
  await expect(page.locator('#reg-error')).toHaveText('Please fill in all required fields');
  await page.getByLabel('Username').fill('a!');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.locator('#reg-btn').click();
  await expect(page.locator('#reg-error')).not.toBeEmpty();
  await page.getByLabel('Password').fill('short');
  await page.getByLabel('Username').fill(username);
  await page.locator('#reg-btn').click();
  await expect(page.locator('#reg-error')).toContainText('8');

  await page.getByLabel('Password').fill(PASSWORD);
  await page.locator('#reg-btn').click();
  await expect(page.getByText('Account created! Check your email to verify.')).toBeVisible();
  await expect(page.locator('#login-btn')).toBeVisible();

  // Logging in before verifying lands on the verification screen.
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.locator('#login-btn').click();
  await expect(page.getByRole('heading', { name: /VERIFY\s+EMAIL/ })).toBeVisible();
  await page.getByRole('button', { name: "I've Verified — Continue" }).click();
  await expect(page.getByText('Email not yet verified. Please check your inbox.')).toBeVisible();
  // A second mail on request (the newest link is the one used below).
  await page.locator('#verify-email-input').fill(email);
  await page.getByRole('button', { name: 'Resend' }).click();
  await expect(page.getByText('Verification email sent!')).toBeVisible();

  // The same name cannot be taken twice.
  const dup = await api('POST', '/auth/register', undefined, {
    username,
    email: `x${email}`,
    password: PASSWORD,
  });
  expect(dup.status).toBe(409);

  const mail = await mailTo(email, /verify/i);
  await page.goto(linkIn(mail.text));
  await expect(page.getByText('Email verified successfully!')).toBeVisible();
  // Still signed in from before: the lobby opens (into the open world).
  await expect(page.locator('.hud-ow-board')).toBeVisible();
});

test('a bad verification link is refused', async ({ page }) => {
  const res = await page.request.get('/api/auth/verify-email/not-a-real-token', {
    maxRedirects: 0,
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);
  expect(res.status()).toBeLessThan(500);
});

test('wrong password shows an error; logout returns to the landing page', async ({ page }) => {
  const u = await createUser('log');
  await page.goto('/');
  await page.getByRole('button', { name: 'Login' }).click();
  await page.locator('#login-btn').click();
  await expect(page.locator('#login-error')).toHaveText('Please fill in all fields');
  await page.getByLabel('Username').fill(u.username);
  await page.getByLabel('Password').fill('not-the-password');
  await page.locator('#login-btn').click();
  await expect(page.locator('#login-error')).not.toBeEmpty();

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel('Password').press('Enter');
  await expect(page.getByText('Welcome back!')).toBeVisible();
  await expect(page.locator('.hud-ow-board')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#leave-confirm').click();
  await page.locator('#nav-logout').click();
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();

  // The session is gone: a reload does not sign back in.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  await expect(page.locator('#nav-logout')).toHaveCount(0);
});

test('forgot password: reset link from the mail sets a new password', async ({ page }) => {
  const u = await createUser('rst');
  await page.goto('/');
  await page.getByRole('button', { name: 'Login' }).click();
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.locator('#forgot-btn').click();
  await expect(page.locator('#forgot-error')).toHaveText('Please enter your email');
  await page.getByLabel('Email').fill(u.email);
  await page.locator('#forgot-btn').click();
  await expect(page.getByText('If the email exists, a reset link has been sent')).toBeVisible();

  const link = linkIn((await mailTo(u.email, /reset/i)).text);
  expect(link).toContain('/reset-password?token=');
  await page.goto(link);
  await expect(page.getByLabel('New Password')).toBeVisible();
  await page.getByLabel('New Password').fill('NewPass-2026x');
  await page.getByLabel('Confirm Password').fill('NewPass-2026y');
  await page.locator('#reset-btn').click();
  await expect(page.locator('#reset-error')).toHaveText('Passwords do not match');
  await page.getByLabel('Confirm Password').fill('NewPass-2026x');
  await page.locator('#reset-btn').click();
  await expect(
    page.getByText('Password updated! You can now log in with your new password.'),
  ).toBeVisible();

  // The old password stops working, the new one works; the link is single-use.
  expect(
    (await api('POST', '/auth/login', undefined, { username: u.username, password: PASSWORD }))
      .status,
  ).toBe(401);
  await login(u.username, 'NewPass-2026x');
  await page.goto(link);
  await page.getByLabel('New Password').fill('Another-2026x');
  await page.getByLabel('Confirm Password').fill('Another-2026x');
  await page.locator('#reset-btn').click();
  await expect(page.locator('#reset-error')).not.toBeEmpty();
  await expect(page.locator('#reset-request-again')).toBeVisible();
});

test('the language picker switches the forms; a German browser starts in German', async ({
  page,
  browser,
  guard,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Login' }).click();
  await page.getByRole('button', { name: 'Language' }).click();
  await page.getByRole('button', { name: /Deutsch/ }).click();
  await expect(page.getByLabel('Benutzername')).toBeVisible();
  await expect(page.locator('#login-btn')).toHaveText('Anmelden');
  // The choice sticks across a reload.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Als Gast spielen' })).toBeVisible();

  const de = await newPage(browser, guard, { locale: 'de-AT' });
  await de.goto('/');
  await expect(de.getByRole('button', { name: 'Anmelden' })).toBeVisible();
  await expect(de.getByRole('button', { name: 'Registrieren' })).toBeVisible();
  await de.context().close();
});

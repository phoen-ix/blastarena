import {
  adminSession,
  authForm,
  createUser,
  expect,
  key,
  landing,
  LANGUAGES,
  locale,
  lobby,
  mailTo,
  nav,
  ok,
  resetRateLimits,
  sql,
  test,
  token,
} from './support';

/* The 12 interface languages: the sign-in form's picker, the browser language, the settings
 * select (stored on the account, used for mail), and every lobby + admin label per language. */

const NAMES: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  pt: 'Português',
  pl: 'Polski',
  nl: 'Nederlands',
  tr: 'Türkçe',
  sv: 'Svenska',
  nb: 'Norsk',
  da: 'Dansk',
};

const auth = (lng: string) => locale('frontend', lng, 'auth');
const ui = (lng: string) => locale('frontend', lng, 'ui');
/** An i18next key that leaked into the page instead of its text. */
const RAW_KEY = /\b(?:ui|auth|admin|common|game|campaign|errors):[a-zA-Z]/;

test('the sign-in form switches through all 12 languages and remembers the choice', async ({
  page,
}) => {
  await landing(page);
  await page.getByRole('button', { name: 'Login' }).click();
  let current = 'en';
  for (const lng of [...LANGUAGES.slice(1), 'en']) {
    const form = authForm(page);
    await form.getByRole('button', { name: key(auth(current), 'language'), exact: true }).click();
    await form.getByRole('button', { name: NAMES[lng] }).click();
    const t = auth(lng);
    await expect(form.getByRole('heading')).toHaveText(
      `${key(t, 'login.title')}${key(t, 'login.titleAccent')}`,
    );
    await expect(form.getByLabel(key(t, 'login.username'))).toBeVisible();
    await expect(
      form.getByRole('button', { name: key(t, 'login.submit'), exact: true }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', lng);
    expect(await page.evaluate(() => localStorage.getItem('blast-arena-lang'))).toBe(lng);
    current = lng;
  }
  // Remembered across a reload.
  await page.evaluate(() => localStorage.setItem('blast-arena-lang', 'pl'));
  await page.reload();
  await expect(page.getByRole('button', { name: key(ui('pl'), 'menu.login') })).toBeVisible();
});

test('a browser set to German starts in German', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'de-AT' });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByRole('button', { name: key(ui('de'), 'menu.login') })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await ctx.close();
});

test('the language picked in the settings belongs to the account', async ({ page, browser }) => {
  const user = await createUser();
  await lobby(page, user);
  await nav(page, 'Settings').click();
  await page.locator('#settings-tab-bar').getByRole('button', { name: 'Preferences' }).click();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('de');
  const de = ui('de');
  await expect(nav(page, key(de, 'sidebar.settings'))).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect
    .poll(() => sql(`SELECT language FROM users WHERE id = ${user.id}`).trim())
    .toBe('de');

  // Another browser (English) switches to German on sign-in.
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await lobby(other, user);
  await expect(nav(other, key(de, 'sidebar.settings'))).toBeVisible();
  await ctx.close();

  // Mail to the account is in German too.
  resetRateLimits();
  await ok('POST', '/auth/forgot-password', undefined, { email: user.email });
  const subject = key(locale('backend', 'de', 'email'), 'passwordReset.subject');
  const mail = await mailTo(user.email, new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  expect(mail.subject).toBe(subject);
});

test('account messages come in the interface language', async ({ page }) => {
  const user = await createUser();
  await ok('PUT', '/user/language', await token(user.username), { language: 'de' });
  await lobby(page, user);
  const de = ui('de');
  await nav(page, key(de, 'sidebar.settings')).click();
  await page
    .locator('#settings-tab-bar')
    .getByRole('button', { name: key(de, 'settings.tabs.account') })
    .click();
  await page.getByLabel(key(de, 'settings.account.currentPassword')).fill(user.password);
  await page.getByLabel(key(de, 'settings.account.newPassword')).fill('Neues-Pass-2026');
  await page.getByLabel(key(de, 'settings.account.confirmPassword')).fill('Neues-Pass-2026');
  await page.getByRole('button', { name: key(de, 'settings.account.changePassword') }).click();
  await expect(page.locator('#acct-password-status')).toHaveText(
    key(de, 'settings.account.passwordChanged'),
  );
  await page.getByLabel(key(de, 'settings.account.newEmailPlaceholder')).fill(`neu${user.email}`);
  await page.getByRole('button', { name: key(de, 'settings.account.sendConfirmation') }).click();
  await expect(page.locator('#acct-email-status')).toHaveText(
    key(de, 'settings.account.emailConfirmationSent'),
  );
});

for (const lng of LANGUAGES) {
  test(`lobby and admin labels in ${NAMES[lng]}`, async ({ page }) => {
    const boss = await createUser('admin', 'a');
    await ok('PUT', '/user/language', await token(boss.username), { language: lng });
    await adminSession();
    await lobby(page, boss);
    const t = ui(lng);
    for (const k of [
      'rooms',
      'campaign',
      'myMaps',
      'friends',
      'leaderboard',
      'settings',
      'help',
      'admin',
    ]) {
      await expect(nav(page, key(t, `sidebar.${k}`))).toBeVisible();
    }
    await nav(page, key(t, 'sidebar.admin')).click();
    const tabs = locale('frontend', lng, 'admin').tabs as Record<string, string>;
    const bar = page.locator('#admin-tab-bar');
    const order = [
      'dashboard',
      'users',
      'matches',
      'rooms',
      'logs',
      'simulations',
      'ai',
      'announcements',
      'campaign',
      'seasons',
      'achievements',
      'challenges',
    ];
    await expect(bar.getByRole('button')).toHaveText(order.map((id) => tabs[id]));
    await expect(page.locator('.main-body')).not.toContainText(RAW_KEY);
    await expect(page.locator('.sidebar')).not.toContainText(RAW_KEY);
  });
}

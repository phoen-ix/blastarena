import {
  adminSession,
  adminTab,
  api,
  createUser,
  expect,
  landing,
  leaveWorld,
  lobby,
  mailTo,
  ok,
  test,
  uid,
} from './support';
import type { Page } from '@playwright/test';

/* Admin > Dashboard: server settings, chat modes, XP, imprint/GitHub footer, open world, email
 * (SMTP + test mail), game/simulation defaults, the revoke-all-sessions guard. Settings are global,
 * so each test puts back what it changed. */
test.describe.configure({ mode: 'serial' });

async function dashboard(page: Page): Promise<void> {
  await lobby(page, await createUser('admin', 'a'));
  await adminTab(page, 'Dashboard');
  await expect(page.getByRole('heading', { name: 'Server Settings' })).toBeVisible();
}

const toast = (page: Page, text: string | RegExp) =>
  expect(page.locator('.toast').filter({ hasText: text }).first()).toBeVisible();

test('toggles and chat modes save and survive a reload', { tag: '@global' }, async ({ page }) => {
  const { token } = await adminSession();
  await dashboard(page);
  try {
    const recordings = page.getByLabel('Match Recordings');
    const was = await recordings.isChecked();
    await recordings.setChecked(!was);
    await toast(page, `Match recordings ${was ? 'disabled' : 'enabled'}`);
    await expect(page.getByText('Total Users')).toBeVisible();
    await recordings.setChecked(was);

    const spectator = page.getByLabel('Spectator Game Master (global)');
    await spectator.click();
    await toast(page, /Spectator Game Master (enabled|disabled)/);
    await spectator.click();

    // Registration off and on again (account.spec checks what players see while it is off).
    const registration = page.getByLabel('User Registration');
    await registration.uncheck();
    await toast(page, 'User registration disabled');
    expect(
      (await api<{ enabled: boolean }>('GET', '/admin/settings/registration_enabled')).data.enabled,
    ).toBe(false);
    await registration.check();
    await toast(page, 'User registration enabled');

    await page.getByRole('combobox', { name: 'Default Art Style' }).selectOption('neon');
    await toast(page, 'Default art style set to Neon Arena');
    expect(
      (await api<{ style: string }>('GET', '/admin/settings/default_art_style')).data.style,
    ).toBe('neon');

    await page.getByRole('combobox', { name: 'Party Chat' }).selectOption('staff');
    await toast(page, 'Party chat set to: Staff Only');
    for (const name of ['Lobby Chat', 'Direct Messages', 'In-Game Emotes', 'Spectator Chat']) {
      await page.getByRole('combobox', { name }).selectOption('admin_only');
      await toast(page, /set to: Admin Only/);
    }
    await page.reload();
    await leaveWorld(page);
    await adminTab(page, 'Dashboard');
    await expect(page.getByRole('combobox', { name: 'Party Chat' })).toHaveValue('staff');
    await expect(page.getByRole('combobox', { name: 'Spectator Chat' })).toHaveValue('admin_only');
    expect((await api<{ mode: string }>('GET', '/admin/settings/dm_mode')).data.mode).toBe(
      'admin_only',
    );
  } finally {
    for (const k of [
      'party_chat_mode',
      'lobby_chat_mode',
      'dm_mode',
      'emote_mode',
      'spectator_chat_mode',
    ]) {
      await ok('PUT', `/admin/settings/${k}`, token, { mode: 'everyone' });
    }
    await ok('PUT', '/admin/settings/registration_enabled', token, { enabled: true });
    await ok('PUT', '/admin/settings/default_art_style', token, { style: 'classic' });
  }
});

test('XP multiplier is range-checked and saved', { tag: '@global' }, async ({ page }) => {
  const { token } = await adminSession();
  await dashboard(page);
  const xp = page.getByRole('spinbutton', { name: 'XP Multiplier' });
  const save = xp.locator('xpath=following-sibling::button[1]');
  try {
    await xp.fill('11');
    await save.click();
    await toast(page, 'Multiplier must be between 0 and 10');
    await xp.fill('1.5');
    await save.click();
    await toast(page, 'XP multiplier set to 1.5');
    expect(
      (await api<{ multiplier: number }>('GET', '/admin/settings/xp_multiplier')).data.multiplier,
    ).toBe(1.5);
  } finally {
    await ok('PUT', '/admin/settings/xp_multiplier', token, { multiplier: 1 });
  }
});

test(
  'imprint and GitHub link appear on the sign-in form',
  { tag: '@global' },
  async ({ page, browser }) => {
    const { token } = await adminSession();
    await dashboard(page);
    const text = `BlastArena e2e imprint ${uid()}\nExample Street 1, Vienna`;
    try {
      await page.getByLabel('Display Imprint').check();
      await toast(page, 'Imprint enabled');
      await page.getByRole('textbox', { name: 'Imprint Text' }).fill(text);
      await page.getByRole('button', { name: 'Save Imprint' }).click();
      await toast(page, 'Imprint text saved');
      await page.getByLabel('Display GitHub Link').check();
      await toast(page, 'GitHub link enabled');

      const ctx = await browser.newContext();
      const guest = await ctx.newPage();
      await landing(guest);
      await guest.getByRole('button', { name: 'Login' }).click();
      await expect(guest.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
        'href',
        /github\.com\/phoen-ix\/blastarena/,
      );
      await guest.getByRole('link', { name: 'Imprint' }).click();
      await expect(guest.getByRole('dialog')).toContainText('Example Street 1, Vienna');
      await ctx.close();

      await page.getByLabel('Display Imprint').uncheck();
      await expect(page.getByRole('textbox', { name: 'Imprint Text' })).toBeHidden();
    } finally {
      await ok('PUT', '/admin/settings/imprint', token, { enabled: false, text: '' });
      await ok('PUT', '/admin/settings/display_github', token, { enabled: false });
    }
  },
);

test('open world settings save', { tag: '@global' }, async ({ page }) => {
  const { token } = await adminSession();
  const before = (await api('GET', '/admin/settings/open_world', token)).data;
  await dashboard(page);
  try {
    await page.getByRole('spinbutton', { name: 'Respawn Delay (s)' }).fill('5');
    await page.getByRole('button', { name: 'Save Open World Settings' }).click();
    await toast(page, 'Open World settings saved');
    const after = (await api<{ respawnDelay: number }>('GET', '/admin/settings/open_world', token))
      .data;
    expect(after.respawnDelay).toBe(5);
  } finally {
    await ok('PUT', '/admin/settings/open_world', token, before);
  }
});

test('email settings: save, send a test mail, reset', { tag: '@global' }, async ({ page }) => {
  const { token } = await adminSession();
  await dashboard(page);
  try {
    await page.getByRole('button', { name: /Email \/ SMTP Settings/ }).click();
    const host = page.getByLabel('SMTP Host');
    await expect(host).toHaveValue('mailpit');
    // Seeded by scripts/e2e.sh: Mailpit has no STARTTLS.
    await expect(page.getByLabel('Security')).toHaveValue('none');
    await page.getByLabel('From Name').fill('BlastArena E2E');
    await page.locator('#email-body').getByRole('button', { name: 'Save', exact: true }).click();
    await toast(page, 'Email settings saved');

    const to = `smtp${uid()}@blast-e2e.example`;
    await page.getByRole('button', { name: /Email \/ SMTP Settings/ }).click();
    await page.getByRole('button', { name: 'Send Test' }).click();
    await toast(page, 'Enter an email address for the test');
    await page.getByRole('textbox', { name: 'Test email address' }).fill(to);
    await page.getByRole('button', { name: 'Send Test' }).click();
    await toast(page, `Test email sent to ${to}`);
    const mail = await mailTo(to, /Test Email/);
    expect(mail.html).toContain('SMTP configuration');

    // Sending a test leaves the section open.
    await page.locator('#email-body').getByRole('button', { name: 'Reset to Defaults' }).click();
    await toast(page, 'Email settings reset to .env defaults');
    await page.getByRole('button', { name: /Email \/ SMTP Settings/ }).click();
    // Back to the stack's .env values.
    await expect(page.getByLabel('From Name')).not.toHaveValue('BlastArena E2E');
    // Unset Security follows the port: 1025 is not 465, so STARTTLS.
    await expect(page.getByLabel('Security')).toHaveValue('starttls');
  } finally {
    await ok('PUT', '/admin/settings/email_settings', token, { smtpSecurity: 'none' });
  }
});

for (const d of [
  // prettier-ignore
  { section: 'Game Creation Defaults', id: 'gd', key: 'game_defaults', word: 'Game', field: 'Game Mode', prop: 'gameMode', value: 'teams' },
  // prettier-ignore
  { section: 'Simulation Defaults', id: 'sd', key: 'simulation_defaults', word: 'Simulation', field: 'Speed', prop: 'speed', value: 'realtime' },
] as const) {
  test(`${d.section.toLowerCase()} save and reset`, { tag: '@global' }, async ({ page }) => {
    const { token } = await adminSession();
    await dashboard(page);
    const section = page.getByRole('button', { name: d.section });
    const body = page.locator(`#${d.id}-body`);
    const stored = async () =>
      (await ok<{ defaults: Record<string, unknown> }>('GET', `/admin/settings/${d.key}`, token))
        .defaults[d.prop];
    try {
      await section.click();
      await body.getByRole('combobox', { name: d.field, exact: true }).selectOption(d.value);
      await body.getByRole('button', { name: 'Save', exact: true }).click();
      await toast(page, `${d.word} defaults saved`);
      expect(await stored()).toBe(d.value);
      await section.click();
      await body.getByRole('button', { name: 'Reset to Defaults' }).click();
      await toast(page, `${d.word} defaults reset`);
      expect(await stored()).toBeUndefined();
    } finally {
      await ok('PUT', `/admin/settings/${d.key}`, token, { defaults: {} });
    }
  });
}

test(
  'revoke all sessions: typed confirmation, then everyone is signed out',
  { tag: '@global' },
  async ({ page, browser }) => {
    const ctx = await browser.newContext();
    const player = await ctx.newPage();
    await lobby(player, await createUser());

    await dashboard(page);
    await page.getByRole('button', { name: 'Revoke All Sessions' }).click();
    const dialog = page.getByRole('dialog', { name: 'Revoke All Sessions' });
    const confirm = dialog.getByRole('button', { name: 'Revoke All', exact: true });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox').fill('confirm');
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Revoke All Sessions' }).click();
    await dialog.getByRole('textbox').fill('CONFIRM');
    await confirm.click();
    await toast(page, /revoked/i);
    // The refresh cookie no longer works: a reload lands on the landing page.
    await player.reload();
    await expect(player.getByRole('button', { name: 'Login' })).toBeVisible();
    await ctx.close();
  },
);

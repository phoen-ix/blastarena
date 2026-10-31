import { adminTab, api, createUser, expect, lobby, nav, test, token } from './support';

/* Breadth: every admin tab as every role. Each tab renders its own content without a page error
 * or a 5xx (the guard fixture), and the server refuses what the role may not do. */

const ALL = [
  ['Dashboard', /Server Settings/],
  ['Users', /Username/],
  ['Matches', /Room Code|No matches found/],
  ['Rooms', /Code/],
  ['Logs', /Filter by action/],
  ['Simulations', /Bot Simulations/],
  ['AI', /Bot AI Management/],
  ['Announcements', /Broadcast Toast/],
  ['Campaign', /Campaign Manager/],
  ['Seasons', /Season Management/],
  ['Achievements', /Achievements & Cosmetics/],
  ['Challenges', /Map Challenges/],
] as const;
const STAFF = ['Users', 'Matches', 'Rooms'];

test('an admin opens all 12 tabs', async ({ page }) => {
  await lobby(page, await createUser('admin', 'a'));
  await nav(page, 'Admin').click();
  await expect(page.locator('#admin-tab-bar').getByRole('button')).toHaveText(ALL.map(([n]) => n));
  for (const [name, landmark] of ALL) {
    await adminTab(page, name);
    await expect(page.locator('#admin-tab-content')).toContainText(landmark);
    await expect(page.locator('#admin-tab-content')).not.toContainText(/Failed to load/i);
  }
});

test('a moderator gets the staff tabs and nothing admin-only', async ({ page }) => {
  const mod = await createUser('moderator', 'm');
  await lobby(page, mod);
  await nav(page, 'Admin').click();
  await expect(page.locator('#admin-tab-bar').getByRole('button')).toHaveText(STAFF);
  for (const [name, landmark] of ALL.filter(([n]) => STAFF.includes(n))) {
    await adminTab(page, name);
    await expect(page.locator('#admin-tab-content')).toContainText(landmark);
  }
  // Read-only Users: no create, role or delete controls.
  await adminTab(page, 'Users');
  await expect(page.getByRole('button', { name: 'Create User' })).toHaveCount(0);
  await expect(page.locator('#admin-users-table').getByRole('combobox')).toHaveCount(0);

  const t = await token(mod.username);
  for (const path of [
    '/admin/stats',
    '/admin/settings/email_settings',
    '/admin/ai',
    '/admin/seasons',
  ]) {
    expect((await api('GET', path, t)).status, path).toBe(403);
  }
  expect((await api('POST', '/admin/announcements/toast', t, { message: 'hi' })).status).toBe(403);
  expect((await api('GET', '/admin/users', t)).status).toBe(200);
});

test('a player has no Admin entry and the API refuses', async ({ page }) => {
  const user = await createUser();
  await lobby(page, user);
  await expect(nav(page, 'Settings')).toBeVisible();
  await expect(nav(page, 'Admin')).toHaveCount(0);
  const t = await token(user.username);
  expect((await api('GET', '/admin/users', t)).status).toBe(403);
  expect((await api('GET', '/admin/users')).status).toBe(401);
});

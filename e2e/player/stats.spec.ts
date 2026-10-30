import {
  test,
  expect,
  admin,
  createUser,
  ok,
  openLobby,
  openView,
  sql,
  uniq,
  type User,
} from './lib';

/* Progress views: leaderboard (seasons, paging, profile links), another player's profile (add
 * friend, private profiles), own profile with achievements, match history paging. Stats and
 * matches are backdated through SQL - only finished matches write them. */

function seedStats(u: User, elo: number, wins = 7): void {
  sql(
    `INSERT INTO user_stats (user_id, total_matches, total_wins, total_kills, total_deaths,
       total_bombs, total_powerups, total_playtime, win_streak, best_win_streak, elo_rating,
       peak_elo, total_xp, level)
     VALUES (${u.id}, 12, ${wins}, 30, 9, 80, 20, 1800, 2, 4, ${elo}, ${elo}, 4000, 7)
     ON DUPLICATE KEY UPDATE elo_rating = VALUES(elo_rating), total_wins = VALUES(total_wins),
       total_matches = VALUES(total_matches)`,
  );
}

test('leaderboard links to profiles; add friend from a profile', async ({ page }) => {
  const [me, top] = [await createUser('lbm'), await createUser('lbt')];
  // Far above any other test's players, so both are on page one.
  const elo = 9000 + Math.floor(Math.random() * 900);
  seedStats(top, elo + 1, 11);
  seedStats(me, elo);
  await openLobby(page, me);
  await openView(page, 'leaderboard');
  const table = page.locator('#lb-table-container');
  await expect(table.getByText(top.username)).toBeVisible();
  await expect(table.getByText(String(elo + 1))).toBeVisible();

  await table.getByRole('link', { name: top.username }).click();
  await expect(page.locator('.profile-page')).toContainText(top.username);
  await expect(page.locator('.profile-page')).toContainText('Statistics');
  await page.getByRole('button', { name: 'Add Friend' }).click();
  await expect(page.getByText(`Friend request sent to ${top.username}`)).toBeVisible();
});

test('leaderboard pages through the ranking', async ({ page }) => {
  // More ranked players than one page holds (25), whatever else the run has seeded.
  const ranked: User[] = [];
  for (let i = 0; i < 26; i++) ranked.push(await createUser('lbp'));
  for (const [i, u] of ranked.entries()) seedStats(u, 500 + i);
  await openLobby(page, ranked[0]);
  await openView(page, 'leaderboard');
  const info = page.locator('#lb-pagination .page-info');
  await expect(info).toHaveText(/^Page 1 of \d+$/);
  await expect(page.locator('#lb-prev')).toBeDisabled();
  await expect(page.locator('#lb-table-container tbody tr')).toHaveCount(25);
  await page.locator('#lb-next').click();
  await expect(info).toHaveText(/^Page 2 of \d+$/);
  await expect(page.locator('#lb-prev')).toBeEnabled();
  await page.locator('#lb-prev').click();
  await expect(info).toHaveText(/^Page 1 of \d+$/);
});

test(
  'a season with no games yet shows an empty leaderboard',
  { tag: '@global' },
  async ({ page }) => {
    const a = await admin();
    const name = uniq('Season ');
    await ok('POST', '/admin/seasons', a.token, {
      name,
      startDate: '2031-01-01',
      endDate: '2031-03-31',
    });
    const u = await createUser('lbs');
    await openLobby(page, u);
    await openView(page, 'leaderboard');
    const select = page.locator('#lb-season-select');
    await expect(select.locator('option', { hasText: name })).toHaveCount(1);
    await select.selectOption({ label: name });
    await expect(page.getByText('No entries yet for this season.')).toBeVisible();
  },
);

test('a private profile hides from other players', async ({ page }) => {
  const [me, shy] = [await createUser('pv'), await createUser('shy')];
  seedStats(shy, 9000 + Math.floor(Math.random() * 999));
  await openLobby(page, me);
  await openView(page, 'leaderboard');
  const link = page.locator('#lb-table-container').getByRole('link', { name: shy.username });
  await expect(link).toBeVisible();
  // The player turns private while the list is open: the profile no longer opens, and the next
  // load of the leaderboard leaves them out.
  await ok('PUT', '/user/privacy', shy.token, { isProfilePublic: false });
  await link.click();
  await expect(page.getByText('Profile is private or does not exist.')).toBeVisible();
  await openView(page, 'leaderboard');
  await expect(page.locator('#lb-table-container table')).toBeVisible();
  await expect(link).toHaveCount(0);
});

test('own profile: stats and achievements', async ({ page }) => {
  const u = await createUser('prf');
  seedStats(u, 1234);
  // One achievement unlocked, as the server would at match end.
  sql(
    `INSERT IGNORE INTO user_achievements (user_id, achievement_id, unlocked_at)
     SELECT ${u.id}, id, NOW() FROM achievements WHERE is_active ORDER BY id LIMIT 1`,
  );
  await openLobby(page, u);
  await page.locator('#sidebar-user-profile').click();
  const profile = page.locator('.profile-page');
  await expect(profile).toContainText(u.username);
  await expect(profile).toContainText('Achievements (1)');
  await expect(profile).toContainText(/In Progress \(\d+\)/);
  await expect(profile).toContainText('1234');
  // No friend button on one's own profile.
  await expect(page.getByRole('button', { name: 'Add Friend' })).toHaveCount(0);
});

test('match history pages through older matches', async ({ page }) => {
  const u = await createUser('mh');
  const code = uniq('M').slice(0, 8);
  for (let i = 0; i < 23; i++) {
    sql(
      `INSERT INTO matches (room_code, game_mode, map_seed, map_width, map_height, max_players,
         status, started_at, finished_at, duration, winner_id, created_at)
       VALUES ('${code}${i}', '${i % 2 ? 'teams' : 'ffa'}', ${i}, 15, 13, 2, 'finished',
         NOW() - INTERVAL ${i + 1} HOUR, NOW() - INTERVAL ${i + 1} HOUR + INTERVAL 3 MINUTE, 180,
         ${i % 3 ? u.id : 'NULL'}, NOW() - INTERVAL ${i + 1} HOUR);
       INSERT INTO match_players (match_id, user_id, placement, kills, deaths, bombs_placed,
         powerups_collected, survived_seconds)
       VALUES (LAST_INSERT_ID(), ${u.id}, ${i % 3 ? 1 : 2}, ${i % 4}, 1, 10, 2, 170)`,
    );
  }
  await openLobby(page, u);
  await openView(page, 'matchHistory');
  const rows = page.locator('.view-root tbody tr');
  await expect(rows).toHaveCount(20);
  await expect(page.locator('.view-root')).toContainText('WIN');
  await page.locator('#mh-next').click();
  await expect(rows).toHaveCount(3);
  await page.locator('#mh-prev').click();
  await expect(rows).toHaveCount(20);
});

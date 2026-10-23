import { execFileSync } from 'node:child_process';

import { io, type Socket } from 'socket.io-client';

/* Demo data for the docs tour. Idempotent: every step checks before it creates, so a restarted
 * worker can run it again. Everything goes through the app's API (REST + Socket.io) except what
 * has no API: the first admin's verification and role, and backdating rows to fixed dates so the
 * screenshots do not change from day to day (SQL via `docker exec`, see sql()). */

export const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:24200';
const PROJECT = process.env.COMPOSE_PROJECT_NAME ?? 'blastarena_docs';
export const PASSWORD = 'DemoPass-2026';

export const ADMIN = { username: 'MaraVoss', email: 'mara.voss@blast-demo.example' };
export const HERO = { username: 'LenaBlitz', email: 'lena.blitz@blast-demo.example' };
const OTHERS = [
  { username: 'JonasKeller', email: 'jonas.keller@blast-demo.example' },
  { username: 'TobiFuse', email: 'tobi.fuse@blast-demo.example' },
  { username: 'ElifStorm', email: 'elif.storm@blast-demo.example' },
  { username: 'KaiEmber', email: 'kai.ember@blast-demo.example' },
  { username: 'NoraPixel', email: 'nora.pixel@blast-demo.example' },
];
const PEOPLE = [ADMIN, HERO, ...OTHERS];

export const MAPS = {
  courtyard: 'Crossfire Courtyard',
  vault: 'Spiral Vault',
  bridges: 'Twin Bridges',
};
export const CHALLENGE = 'Courtyard Showdown';

// Leaderboard: [elo, matches, wins, kills, deaths, xp, level]
const STATS: Record<string, number[]> = {
  LenaBlitz: [1462, 48, 21, 133, 61, 9850, 14],
  JonasKeller: [1318, 52, 17, 120, 74, 9020, 13],
  ElifStorm: [1240, 37, 12, 88, 55, 6110, 10],
  TobiFuse: [1175, 41, 10, 79, 70, 5480, 9],
  KaiEmber: [1080, 26, 6, 41, 49, 2930, 6],
  NoraPixel: [985, 19, 3, 22, 38, 1720, 4],
  MaraVoss: [1120, 12, 4, 30, 21, 1650, 4],
};

/** Run SQL in the stack's MariaDB container. */
export function sql(statement: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      `${PROJECT}-db`,
      'mariadb',
      '-ublast_user',
      `-p${process.env.DB_PASSWORD ?? 'docs-db-not-a-secret'}`,
      '-N',
      'blast_arena',
      '-e',
      statement,
    ],
    { encoding: 'utf8' },
  );
}

/** Login and registration allow 10 and 3 requests per 15 min per IP; the tour signs in more. */
export function resetRateLimits(): void {
  execFileSync('docker', [
    'exec',
    `${PROJECT}-redis`,
    'redis-cli',
    'EVAL',
    "for _, k in ipairs(redis.call('KEYS', 'ratelimit:*')) do redis.call('DEL', k) end",
    '0',
  ]);
}

async function api<T>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : {}) as T };
}

async function ok<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const { status, data } = await api<T>(method, path, token, body);
  if (status >= 300) throw new Error(`[seed] ${method} ${path}: ${status} ${JSON.stringify(data)}`);
  return data;
}

interface Session {
  id: number;
  token: string;
}

async function login(username: string): Promise<Session> {
  const data = await ok<{ user: { id: number }; accessToken: string }>(
    'POST',
    '/auth/login',
    undefined,
    { username, password: PASSWORD },
  );
  return { id: data.user.id, token: data.accessToken };
}

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

/** Emits with an ack; waits out the per-socket limits (3-5 events per second). */
async function emit<T>(s: Socket, event: string, data: unknown): Promise<T> {
  for (;;) {
    const res = await new Promise<T & { error?: string }>((resolve) =>
      s.emit(event, data, resolve),
    );
    if (res?.error !== 'Rate limited') return res;
    await new Promise((r) => setTimeout(r, 1100));
  }
}

/** Odd-sized arena: border, pillar grid, crates in rings, open corners for the spawns. */
function arena(w: number, h: number, crate: (x: number, y: number) => boolean) {
  const spawns = [
    { x: 1, y: 1 },
    { x: w - 2, y: 1 },
    { x: 1, y: h - 2 },
    { x: w - 2, y: h - 2 },
  ];
  const nearSpawn = (x: number, y: number) =>
    spawns.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) <= 2);
  const tiles = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return 'wall';
      if (x % 2 === 0 && y % 2 === 0) return 'wall';
      if (spawns.some((p) => p.x === x && p.y === y)) return 'spawn';
      if (!nearSpawn(x, y) && crate(x, y)) return 'destructible';
      return 'empty';
    }),
  );
  return { mapWidth: w, mapHeight: h, tiles, spawnPoints: spawns };
}

export interface Demo {
  heroId: number;
  courtyardId: number;
}

export async function seedDemo(): Promise<Demo> {
  for (let i = 0; ; i++) {
    const res = await fetch(`${BASE}/api/health`).catch(() => null);
    if (res?.ok) break;
    if (i > 60) throw new Error('[seed] backend not healthy');
    await new Promise((r) => setTimeout(r, 2000));
  }
  resetRateLimits();

  // The first admin: registered like anyone, then verified and promoted (no API for either).
  await api('POST', '/auth/register', undefined, { ...ADMIN, password: PASSWORD });
  sql(
    `UPDATE users SET email_verified = TRUE, role = 'admin' WHERE username = '${ADMIN.username}'`,
  );
  const admin = await login(ADMIN.username);

  // Everyone else through the admin's user form (created verified).
  for (const p of [HERO, ...OTHERS]) {
    const { status } = await api('POST', '/admin/users', admin.token, { ...p, password: PASSWORD });
    if (status !== 201 && status !== 409) throw new Error(`[seed] create ${p.username}: ${status}`);
  }
  const s: Record<string, Session> = { [ADMIN.username]: admin };
  for (const p of [HERO, ...OTHERS]) s[p.username] = await login(p.username);
  const id = (name: string) => s[name].id;

  // Friends: Lena is friends with four players and has one request waiting (from Nora).
  const sockets: Record<string, Socket> = {};
  for (const p of PEOPLE) sockets[p.username] = await connect(s[p.username].token);
  for (const friend of ['JonasKeller', 'TobiFuse', 'ElifStorm', 'MaraVoss']) {
    await emit(sockets.LenaBlitz, 'friend:request', { username: friend });
    await emit(sockets[friend], 'friend:accept', { fromUserId: id(HERO.username) });
  }
  await emit(sockets.NoraPixel, 'friend:request', { username: HERO.username });

  // A conversation between Lena and Jonas.
  const existing = await ok<{ messages: unknown[] }>(
    'GET',
    `/messages/${id('JonasKeller')}`,
    s.LenaBlitz.token,
  );
  if (existing.messages.length === 0) {
    const chat: [string, string, string][] = [
      ['JonasKeller', HERO.username, 'Rematch on Crossfire Courtyard tonight?'],
      [HERO.username, 'JonasKeller', 'Only if you stop camping the teleporters 😄'],
      ['JonasKeller', HERO.username, 'No promises. 8pm, I bring Tobi and Elif.'],
      [HERO.username, 'JonasKeller', "Deal. I'll set up the room."],
    ];
    for (const [from, to, message] of chat) {
      await emit(sockets[from], 'dm:send', { toUserId: id(to), message });
    }
  }
  for (const sock of Object.values(sockets)) sock.disconnect();

  // Custom maps.
  const mine = async (name: string) =>
    (await ok<{ maps: { id: number; name: string }[] }>('GET', '/maps/mine', s[name].token)).maps;
  const ensureMap = async (
    owner: string,
    name: string,
    description: string,
    map: object,
    pub: boolean,
  ) => {
    const found = (await mine(owner)).find((m) => m.name === name);
    if (found) return found.id;
    const created = await ok<{ id: number }>('POST', '/maps', s[owner].token, {
      name,
      description,
      ...map,
      isPublished: pub,
    });
    return created.id;
  };
  const courtyardId = await ensureMap(
    HERO.username,
    MAPS.courtyard,
    'Open centre, crates in rings - fast and loud.',
    arena(15, 13, (x, y) => (x + y) % 3 !== 0 && !(x > 5 && x < 9 && y > 4 && y < 8)),
    true,
  );
  await ensureMap(
    HERO.username,
    MAPS.vault,
    'Work in progress: a spiral of crates around a sealed core.',
    arena(17, 15, (x, y) => (x * 7 + y * 3) % 4 !== 0),
    false,
  );
  const bridgesId = await ensureMap(
    'JonasKeller',
    MAPS.bridges,
    'Two lanes, one crossing. Bring kick.',
    arena(19, 13, (x, y) => y !== 6 && (x + 2 * y) % 5 !== 0),
    true,
  );
  for (const [rater, mapId, stars] of [
    ['JonasKeller', courtyardId, 5],
    ['TobiFuse', courtyardId, 4],
    ['ElifStorm', courtyardId, 5],
    [HERO.username, bridgesId, 4],
    ['KaiEmber', bridgesId, 3],
  ] as const) {
    await ok('POST', `/maps/${mapId}/rate`, s[rater].token, { rating: stars });
  }

  // A weekly challenge on Lena's map, and an upcoming season.
  const challenges = await ok<{ challenges: { id: number; title: string; isActive?: boolean }[] }>(
    'GET',
    '/admin/challenges',
    admin.token,
  );
  let challenge = challenges.challenges.find((c) => c.title === CHALLENGE);
  if (!challenge) {
    challenge = await ok<{ id: number; title: string }>('POST', '/admin/challenges', admin.token, {
      title: CHALLENGE,
      description: 'One week, one map: most wins on Crossfire Courtyard takes the crown.',
      customMapId: courtyardId,
      gameMode: 'ffa',
      startDate: '2026-06-12',
      endDate: '2026-06-19',
    });
    await ok('POST', `/admin/challenges/${challenge.id}/activate`, admin.token);
  }
  const seasons = await ok<{ seasons: { name: string }[] }>('GET', '/admin/seasons', admin.token);
  if (!seasons.seasons.some((x) => x.name === 'Summer Sparks')) {
    await ok('POST', '/admin/seasons', admin.token, {
      name: 'Summer Sparks',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
    });
  }

  // Backdating: stats, a match history and fixed timestamps (no API writes these).
  for (const [name, [elo, matches, wins, kills, deaths, xp, level]] of Object.entries(STATS)) {
    sql(
      `INSERT INTO user_stats (user_id, total_matches, total_wins, total_kills, total_deaths,
         total_bombs, total_powerups, total_playtime, win_streak, best_win_streak, elo_rating,
         peak_elo, total_xp, level)
       VALUES (${id(name)}, ${matches}, ${wins}, ${kills}, ${deaths}, ${kills * 6}, ${kills * 2},
         ${matches * 150}, 2, 5, ${elo}, ${elo + 40}, ${xp}, ${level})
       ON DUPLICATE KEY UPDATE total_matches = VALUES(total_matches), total_wins = VALUES(total_wins),
         total_kills = VALUES(total_kills), total_deaths = VALUES(total_deaths),
         total_bombs = VALUES(total_bombs), total_powerups = VALUES(total_powerups),
         total_playtime = VALUES(total_playtime), elo_rating = VALUES(elo_rating),
         peak_elo = VALUES(peak_elo), total_xp = VALUES(total_xp), level = VALUES(level)`,
    );
  }
  if (sql(`SELECT COUNT(*) FROM matches WHERE room_code LIKE 'DEMO%'`).trim() === '0') {
    const lineup = [HERO.username, 'JonasKeller', 'TobiFuse', 'ElifStorm'];
    const modes = ['ffa', 'teams', 'king_of_the_hill', 'battle_royale', 'deathmatch', 'ffa'];
    modes.forEach((mode, i) => {
      const day = 14 - i;
      const winner = lineup[i % 3 === 2 ? 1 : 0];
      sql(
        `INSERT INTO matches (room_code, game_mode, map_seed, map_width, map_height, max_players,
           status, started_at, finished_at, duration, winner_id, created_at)
         VALUES ('DEMO${i}', '${mode}', ${1000 + i}, 15, 13, 4, 'finished',
           '2026-06-${day} 19:${10 + i}:00', '2026-06-${day} 19:${13 + i}:20', ${180 + i * 17},
           ${id(winner)}, '2026-06-${day} 19:${10 + i}:00')`,
      );
      const matchId = sql(`SELECT id FROM matches WHERE room_code = 'DEMO${i}'`).trim();
      const order = [winner, ...lineup.filter((p) => p !== winner)];
      lineup.forEach((p, j) => {
        const place = order.indexOf(p) + 1;
        sql(
          `INSERT INTO match_players (match_id, user_id, team, placement, kills, deaths,
             bombs_placed, powerups_collected, survived_seconds)
           VALUES (${matchId}, ${id(p)}, ${mode === 'teams' ? j % 2 : 'NULL'}, ${place},
             ${(5 - place + i) % 5}, ${place === 1 ? 0 : 1}, ${14 + j * 3 + i}, ${3 + ((i + j) % 4)},
             ${180 + i * 17 - (place - 1) * 30})`,
        );
      });
    });
  }
  for (const [name, wins, kills, games] of [
    [HERO.username, 4, 11, 6],
    ['JonasKeller', 3, 9, 7],
    ['ElifStorm', 2, 7, 5],
    ['TobiFuse', 1, 4, 4],
  ] as const) {
    sql(
      `INSERT IGNORE INTO challenge_scores (challenge_id, user_id, wins, kills, deaths, games_played,
         best_placement) VALUES (${challenge.id}, ${id(name)}, ${wins}, ${kills}, ${games - wins},
         ${games}, 1)`,
    );
  }
  sql(
    `UPDATE custom_maps SET play_count = 3 + id * 4, created_at = '2026-05-28 17:00:00' + INTERVAL id DAY,
       updated_at = '2026-06-08 17:00:00' + INTERVAL id DAY`,
  );
  const ids = PEOPLE.map((p) => id(p.username)).join(',');
  sql(
    `UPDATE users SET created_at = '2026-03-02 18:00:00' + INTERVAL id DAY,
       last_login = '2026-06-15 09:30:00' - INTERVAL id HOUR WHERE id IN (${ids})`,
  );
  sql(
    `UPDATE friendships SET created_at = '2026-05-20 20:00:00', updated_at = '2026-05-20 20:05:00'`,
  );
  sql(
    `UPDATE direct_messages SET created_at = '2026-06-14 18:40:00' + INTERVAL id * 3 MINUTE,
       read_at = NULL`,
  );
  // The built-in enemy AIs are created in the same second at startup: give them a fixed order.
  sql(
    `UPDATE enemy_ais SET uploaded_at = '2026-03-01 12:00:00' + INTERVAL
       FIELD(builtin_key, 'ambusher', 'swarm', 'coward', 'bomber', 'patrol-guard', 'hunter') MINUTE
     WHERE builtin_key IS NOT NULL`,
  );
  sql(`UPDATE admin_actions SET created_at = '2026-06-10 12:00:00' + INTERVAL id * 7 MINUTE`);

  return { heroId: id(HERO.username), courtyardId };
}

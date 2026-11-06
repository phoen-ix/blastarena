import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PUT /admin/seasons/:id, /admin/achievements/:id, /admin/cosmetics/:id and /admin/challenges/:id
 * accepted an unvalidated body, and the seasons one handed a NaN id straight to the driver. Each
 * now runs the REAL validate() middleware with its POST schema made partial (so any subset of
 * fields is a valid update), and every :id route guards against NaN with a 400. (audit B9)
 *
 * Unlike admin.test.ts, `validate` here is the genuine implementation so the schemas themselves
 * are exercised.
 */

type AnyFn = (...args: any[]) => any;

// `then` stays undefined: vitest awaits a mock factory's result, and a thenable is no module.
const noopService = vi.hoisted(
  () => () =>
    new Proxy(
      {},
      {
        get: (_t, key) =>
          key === 'then' ? undefined : vi.fn<AnyFn>().mockResolvedValue(undefined),
      },
    ),
);

vi.mock('../../../backend/src/services/admin', () => noopService());
vi.mock('../../../backend/src/services/replay', () => noopService());
const mockSetSetting = vi.hoisted(() => vi.fn<AnyFn>());
vi.mock('../../../backend/src/services/settings', () => ({ setSetting: mockSetSetting }));
vi.mock('../../../backend/src/services/botai', () => noopService());
vi.mock('../../../backend/src/services/enemyai', () => noopService());
vi.mock('../../../backend/src/services/email', () => noopService());

const mockUpdateSeason = vi.hoisted(() => vi.fn<AnyFn>());
const mockGetSeasonById = vi.hoisted(() => vi.fn<AnyFn>());
const mockDeleteSeason = vi.hoisted(() => vi.fn<AnyFn>());
const mockActivateSeason = vi.hoisted(() => vi.fn<AnyFn>());
const mockEndSeason = vi.hoisted(() => vi.fn<AnyFn>());
vi.mock('../../../backend/src/services/season', () => ({
  updateSeason: mockUpdateSeason,
  getSeasonById: mockGetSeasonById,
  deleteSeason: mockDeleteSeason,
  activateSeason: mockActivateSeason,
  endSeason: mockEndSeason,
  getSeasons: vi.fn(),
  createSeason: vi.fn(),
}));

const mockUpdateAchievement = vi.hoisted(() => vi.fn<AnyFn>());
const mockDeleteAchievement = vi.hoisted(() => vi.fn<AnyFn>());
vi.mock('../../../backend/src/services/achievements', () => ({
  updateAchievement: mockUpdateAchievement,
  deleteAchievement: mockDeleteAchievement,
  getAchievementById: vi.fn<AnyFn>().mockResolvedValue({ id: 1 }),
  getAllAchievements: vi.fn(),
  createAchievement: vi.fn(),
}));

const mockUpdateCosmetic = vi.hoisted(() => vi.fn<AnyFn>());
const mockDeleteCosmetic = vi.hoisted(() => vi.fn<AnyFn>());
vi.mock('../../../backend/src/services/cosmetics', () => ({
  updateCosmetic: mockUpdateCosmetic,
  deleteCosmetic: mockDeleteCosmetic,
  getCosmeticById: vi.fn<AnyFn>().mockResolvedValue({ id: 1 }),
  getAllCosmetics: vi.fn(),
  createCosmetic: vi.fn(),
}));

const mockUpdateChallenge = vi.hoisted(() => vi.fn<AnyFn>());
vi.mock('../../../backend/src/services/challenges', () => ({
  updateChallenge: mockUpdateChallenge,
  listChallenges: vi.fn(),
  createChallenge: vi.fn(),
  deleteChallenge: vi.fn(),
  activateChallenge: vi.fn(),
  deactivateChallenge: vi.fn(),
}));

vi.mock('../../../backend/src/game/registry', () => ({
  getSimulationManager: () => ({}),
  getIO: () => ({ emit: vi.fn(), to: vi.fn().mockReturnValue({ emit: vi.fn() }) }),
}));
vi.mock('../../../backend/src/game/OpenWorldManager', () => ({
  openWorldManager: { getStatus: vi.fn(), reloadSettings: vi.fn(), handleSettingsChange: vi.fn() },
}));

const mockExecute = vi.hoisted(() => vi.fn<AnyFn>());
vi.mock('../../../backend/src/db/connection', () => ({
  execute: mockExecute,
  query: vi.fn(),
}));
vi.mock('../../../backend/src/config', () => ({
  getConfig: () => ({ APP_URL: 'http://localhost:8080' }),
}));
vi.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: vi.fn((_req: any, _res: any, next: any) => next()),
}));
vi.mock('../../../backend/src/middleware/admin', () => ({
  staffMiddleware: vi.fn((_req: any, _res: any, next: any) => next()),
  adminOnlyMiddleware: vi.fn((_req: any, _res: any, next: any) => next()),
}));
vi.mock('../../../backend/src/middleware/rateLimiter', () => ({
  rateLimiter: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));
vi.mock('../../../backend/src/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('multer', () => {
  const multerFn = () => ({ single: () => (_req: any, _res: any, next: any) => next() });
  multerFn.memoryStorage = () => ({});
  return { __esModule: true, default: multerFn };
});

import adminRouter from '../../../backend/src/routes/admin';
import { OPENWORLD_MAX_AFK_TIMEOUT } from '@blast-arena/shared';
import { getAchievementById } from '../../../backend/src/services/achievements';
import { getCosmeticById } from '../../../backend/src/services/cosmetics';

type Layer = { handle: Function };
type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: Layer[] } };

function routeStack(method: string, path: string): Layer[] {
  const stack = (adminRouter as any).stack as RouteLayer[];
  const layer = stack.find((l) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  return layer.route!.stack;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

/** Run the whole inline stack of a route (middleware + handler) like Express would. */
async function run(method: string, path: string, req: Record<string, unknown>) {
  const res = mockRes();
  const next = vi.fn();
  const fullReq = { user: { userId: 1, username: 'admin', role: 'admin' }, params: {}, ...req };
  for (const layer of routeStack(method, path)) {
    let advanced = false;
    await layer.handle(fullReq, res, (err?: unknown) => {
      advanced = true;
      if (err) next(err);
    });
    if (!advanced) break;
  }
  return { res, next, req: fullReq };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({ affectedRows: 1, insertId: 1 });
  mockGetSeasonById.mockResolvedValue({ id: 3, name: 'S' });
});

describe('PUT /admin/seasons/:id (audit B9)', () => {
  it('accepts a partial body and forwards only the given fields', async () => {
    const { res } = await run('put', '/admin/seasons/:id', {
      params: { id: '3' },
      body: { name: 'Season 3' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateSeason).toHaveBeenCalledWith(3, { name: 'Season 3' });
  });

  it('rejects a malformed field with 400 VALIDATION_ERROR before touching the service', async () => {
    const { res } = await run('put', '/admin/seasons/:id', {
      params: { id: '3' },
      body: { startDate: 'yesterday' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mockUpdateSeason).not.toHaveBeenCalled();
  });

  it('strips unknown fields', async () => {
    await run('put', '/admin/seasons/:id', {
      params: { id: '3' },
      body: { name: 'x', dropMe: true },
    });
    expect(mockUpdateSeason).toHaveBeenCalledWith(3, { name: 'x' });
  });

  it('returns 400 INVALID_ID for a non-numeric id instead of passing NaN to the driver', async () => {
    const { res } = await run('put', '/admin/seasons/:id', {
      params: { id: 'abc' },
      body: { name: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_ID' });
    expect(mockUpdateSeason).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe('season :id routes guard NaN (audit B9)', () => {
  it.each([
    ['delete', '/admin/seasons/:id', mockDeleteSeason],
    ['post', '/admin/seasons/:id/activate', mockActivateSeason],
  ])('%s %s', async (method, path, service) => {
    const { res } = await run(method, path, { params: { id: 'NaN' }, body: {} });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_ID' });
    expect(service).not.toHaveBeenCalled();
  });

  it('post /admin/seasons/:id/end', async () => {
    const { res } = await run('post', '/admin/seasons/:id/end', {
      params: { id: 'x' },
      body: { resetMode: 'hard' },
    });
    expect(res.statusCode).toBe(400);
    expect(mockEndSeason).not.toHaveBeenCalled();
  });
});

describe('PUT /admin/achievements/:id (audit B9)', () => {
  it('accepts a partial body, including the update-only isActive flag', async () => {
    const { res } = await run('put', '/admin/achievements/:id', {
      params: { id: '7' },
      body: { isActive: false, sortOrder: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateAchievement).toHaveBeenCalledWith(7, { isActive: false, sortOrder: 2 });
  });

  it('rejects an invalid conditionType', async () => {
    const { res } = await run('put', '/admin/achievements/:id', {
      params: { id: '7' },
      body: { conditionType: 'weekly' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mockUpdateAchievement).not.toHaveBeenCalled();
  });

  it('rejects an over-long name', async () => {
    const { res } = await run('put', '/admin/achievements/:id', {
      params: { id: '7' },
      body: { name: 'x'.repeat(101) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers 404 for an unknown id without updating or logging', async () => {
    // It answered 200 with `null`
    vi.mocked(getAchievementById).mockResolvedValueOnce(null);
    const { res } = await run('put', '/admin/achievements/:id', {
      params: { id: '404' },
      body: { sortOrder: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(mockUpdateAchievement).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_ID for a non-numeric id (PUT and DELETE)', async () => {
    const put = await run('put', '/admin/achievements/:id', { params: { id: 'q' }, body: {} });
    expect(put.res.statusCode).toBe(400);
    expect(put.res.body).toMatchObject({ code: 'INVALID_ID' });
    const del = await run('delete', '/admin/achievements/:id', { params: { id: 'q' } });
    expect(del.res.statusCode).toBe(400);
    expect(mockDeleteAchievement).not.toHaveBeenCalled();
  });
});

describe('PUT /admin/cosmetics/:id (audit B9)', () => {
  it('accepts a partial body, including the update-only isActive flag', async () => {
    const { res } = await run('put', '/admin/cosmetics/:id', {
      params: { id: '4' },
      body: { rarity: 'epic', isActive: true },
    });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateCosmetic).toHaveBeenCalledWith(4, { rarity: 'epic', isActive: true });
  });

  it('accepts the level_milestone unlock type', async () => {
    // Missing from the schema (and the admin form), so editing such a cosmetic flipped it to
    // an achievement unlock
    const { res } = await run('put', '/admin/cosmetics/:id', {
      params: { id: '4' },
      body: { unlockType: 'level_milestone', unlockRequirement: { level: 10 } },
    });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateCosmetic).toHaveBeenCalledWith(4, {
      unlockType: 'level_milestone',
      unlockRequirement: { level: 10 },
    });
  });

  it('rejects an invalid type / rarity / unlockType', async () => {
    for (const body of [{ type: 'hat' }, { rarity: 'mythic' }, { unlockType: 'purchase' }]) {
      const { res } = await run('put', '/admin/cosmetics/:id', { params: { id: '4' }, body });
      expect(res.statusCode).toBe(400);
    }
    expect(mockUpdateCosmetic).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown id without updating or logging', async () => {
    vi.mocked(getCosmeticById).mockResolvedValueOnce(null);
    const { res } = await run('put', '/admin/cosmetics/:id', {
      params: { id: '404' },
      body: { rarity: 'epic' },
    });
    expect(res.statusCode).toBe(404);
    expect(mockUpdateCosmetic).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_ID for a non-numeric id (PUT and DELETE)', async () => {
    const put = await run('put', '/admin/cosmetics/:id', { params: { id: 'q' }, body: {} });
    expect(put.res.statusCode).toBe(400);
    const del = await run('delete', '/admin/cosmetics/:id', { params: { id: 'q' } });
    expect(del.res.statusCode).toBe(400);
    expect(mockDeleteCosmetic).not.toHaveBeenCalled();
  });
});

describe('PUT /admin/challenges/:id (audit B9)', () => {
  it('accepts a partial body and does not inject the POST default for description', async () => {
    const { res } = await run('put', '/admin/challenges/:id', {
      params: { id: '2' },
      body: { title: 'Weekend Brawl' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateChallenge).toHaveBeenCalledWith(2, { title: 'Weekend Brawl' });
  });

  it('audit-logs the edit with the changed fields', async () => {
    await run('put', '/admin/challenges/:id', {
      params: { id: '2' },
      body: { title: 'Weekend Brawl' },
    });
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admin_actions'), [
      1,
      'challenge_update',
      'challenge',
      2,
      JSON.stringify({ fields: ['title'] }),
    ]);
  });

  it('rejects a malformed date', async () => {
    const { res } = await run('put', '/admin/challenges/:id', {
      params: { id: '2' },
      body: { endDate: '2026/09/30' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mockUpdateChallenge).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_ID for a non-numeric id', async () => {
    const { res } = await run('put', '/admin/challenges/:id', {
      params: { id: 'nope' },
      body: { title: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_ID' });
  });
});

// The AFK timeout shipped as 0-600 s (input, README); the later schema allowed 3600 by mistake.
describe('PUT /admin/settings/open_world afkTimeoutSeconds', () => {
  it.each([0, OPENWORLD_MAX_AFK_TIMEOUT])('accepts %i s', async (afkTimeoutSeconds) => {
    const { res, next } = await run('put', '/admin/settings/open_world', {
      body: { afkTimeoutSeconds },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.body).toEqual({ message: 'Open world settings updated' });
    expect(mockSetSetting).toHaveBeenCalledWith(
      'open_world_afk_timeout',
      String(afkTimeoutSeconds),
    );
  });

  it.each([OPENWORLD_MAX_AFK_TIMEOUT + 1, 3600, -1])('rejects %i s', async (afkTimeoutSeconds) => {
    const { res } = await run('put', '/admin/settings/open_world', {
      body: { afkTimeoutSeconds },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mockSetSetting).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled(); // nothing saved, nothing audit-logged
  });

  it('the limit is 600 s', () => {
    expect(OPENWORLD_MAX_AFK_TIMEOUT).toBe(600);
  });
});

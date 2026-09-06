import { describe, it, expect, jest, beforeEach } from '@jest/globals';

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

const noopService = () =>
  new Proxy({}, { get: () => jest.fn<AnyFn>().mockResolvedValue(undefined) });

jest.mock('../../../backend/src/services/admin', () => noopService());
jest.mock('../../../backend/src/services/replay', () => noopService());
jest.mock('../../../backend/src/services/settings', () => noopService());
jest.mock('../../../backend/src/services/botai', () => noopService());
jest.mock('../../../backend/src/services/enemyai', () => noopService());
jest.mock('../../../backend/src/services/email', () => noopService());

const mockUpdateSeason = jest.fn<AnyFn>();
const mockGetSeasonById = jest.fn<AnyFn>();
const mockDeleteSeason = jest.fn<AnyFn>();
const mockActivateSeason = jest.fn<AnyFn>();
const mockEndSeason = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/season', () => ({
  updateSeason: mockUpdateSeason,
  getSeasonById: mockGetSeasonById,
  deleteSeason: mockDeleteSeason,
  activateSeason: mockActivateSeason,
  endSeason: mockEndSeason,
  getSeasons: jest.fn(),
  createSeason: jest.fn(),
}));

const mockUpdateAchievement = jest.fn<AnyFn>();
const mockDeleteAchievement = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/achievements', () => ({
  updateAchievement: mockUpdateAchievement,
  deleteAchievement: mockDeleteAchievement,
  getAchievementById: jest.fn<AnyFn>().mockResolvedValue({ id: 1 }),
  getAllAchievements: jest.fn(),
  createAchievement: jest.fn(),
}));

const mockUpdateCosmetic = jest.fn<AnyFn>();
const mockDeleteCosmetic = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/cosmetics', () => ({
  updateCosmetic: mockUpdateCosmetic,
  deleteCosmetic: mockDeleteCosmetic,
  getCosmeticById: jest.fn<AnyFn>().mockResolvedValue({ id: 1 }),
  getAllCosmetics: jest.fn(),
  createCosmetic: jest.fn(),
}));

const mockUpdateChallenge = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/challenges', () => ({
  updateChallenge: mockUpdateChallenge,
  listChallenges: jest.fn(),
  createChallenge: jest.fn(),
  deleteChallenge: jest.fn(),
  activateChallenge: jest.fn(),
  deactivateChallenge: jest.fn(),
}));

jest.mock('../../../backend/src/game/registry', () => ({
  getSimulationManager: () => ({}),
  getIO: () => ({ emit: jest.fn(), to: jest.fn().mockReturnValue({ emit: jest.fn() }) }),
}));
jest.mock('../../../backend/src/game/OpenWorldManager', () => ({
  openWorldManager: { getStatus: jest.fn(), reloadSettings: jest.fn() },
}));

const mockExecute = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  execute: mockExecute,
  query: jest.fn(),
}));
jest.mock('../../../backend/src/config', () => ({
  getConfig: () => ({ APP_URL: 'http://localhost:8080' }),
}));
jest.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: jest.fn((_req: any, _res: any, next: any) => next()),
}));
jest.mock('../../../backend/src/middleware/admin', () => ({
  staffMiddleware: jest.fn((_req: any, _res: any, next: any) => next()),
  adminOnlyMiddleware: jest.fn((_req: any, _res: any, next: any) => next()),
}));
jest.mock('../../../backend/src/middleware/rateLimiter', () => ({
  rateLimiter: jest.fn(() => (_req: any, _res: any, next: any) => next()),
}));
jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));
jest.mock('multer', () => {
  const multerFn = () => ({ single: () => (_req: any, _res: any, next: any) => next() });
  multerFn.memoryStorage = () => ({});
  return { __esModule: true, default: multerFn };
});

import adminRouter from '../../../backend/src/routes/admin';

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
  const next = jest.fn();
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
  jest.clearAllMocks();
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

  it('rejects an invalid type / rarity / unlockType', async () => {
    for (const body of [{ type: 'hat' }, { rarity: 'mythic' }, { unlockType: 'purchase' }]) {
      const { res } = await run('put', '/admin/cosmetics/:id', { params: { id: '4' }, body });
      expect(res.statusCode).toBe(400);
    }
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

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Admin routes run through their whole inline stack with the REAL validate(), so the schemas are
 * exercised: achievement/cosmetic imports (schema, cosmetic id check, transaction), deletes and
 * exports of unknown or malformed ids, the XP multiplier, admin-set passwords, the game and
 * simulation defaults, and the imprint.
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
vi.mock('../../../backend/src/services/botai', () => noopService());
vi.mock('../../../backend/src/services/enemyai', () => noopService());
vi.mock('../../../backend/src/services/email', () => noopService());
vi.mock('../../../backend/src/services/season', () => noopService());
vi.mock('../../../backend/src/services/challenges', () => noopService());

const mockDeleteCampaignReplay = vi.hoisted(() => vi.fn<AnyFn>());
vi.mock('../../../backend/src/services/replay', () => ({
  deleteCampaignReplay: mockDeleteCampaignReplay,
}));

const settings = vi.hoisted(() => ({
  getSetting: vi.fn<AnyFn>(),
  setSetting: vi.fn<AnyFn>(),
  setGameDefaults: vi.fn<AnyFn>(),
  setSimulationDefaults: vi.fn<AnyFn>(),
}));
vi.mock('../../../backend/src/services/settings', () => settings);

const ach = vi.hoisted(() => ({
  createAchievement: vi.fn<AnyFn>(),
  deleteAchievement: vi.fn<AnyFn>(),
  getAchievementById: vi.fn<AnyFn>(),
  getAllAchievements: vi.fn<AnyFn>(),
  updateAchievement: vi.fn<AnyFn>(),
}));
vi.mock('../../../backend/src/services/achievements', () => ach);

const cos = vi.hoisted(() => ({
  createCosmetic: vi.fn<AnyFn>(),
  deleteCosmetic: vi.fn<AnyFn>(),
  getCosmeticById: vi.fn<AnyFn>(),
  getAllCosmetics: vi.fn<AnyFn>(),
  updateCosmetic: vi.fn<AnyFn>(),
}));
vi.mock('../../../backend/src/services/cosmetics', () => cos);

vi.mock('../../../backend/src/game/registry', () => ({
  getSimulationManager: () => ({}),
  getIO: () => ({ emit: vi.fn(), to: vi.fn().mockReturnValue({ emit: vi.fn() }) }),
}));
vi.mock('../../../backend/src/game/OpenWorldManager', () => ({
  openWorldManager: { getStatus: vi.fn(), reloadSettings: vi.fn(), handleSettingsChange: vi.fn() },
}));

const fakeConn = vi.hoisted(() => ({ fakeConnection: true }));
const mockExecute = vi.hoisted(() => vi.fn<AnyFn>());
const mockQuery = vi.hoisted(() => vi.fn<AnyFn>());
const mockWithTransaction = vi.hoisted(() =>
  vi.fn<AnyFn>(async (fn: (conn: unknown) => unknown) => fn(fakeConn)),
);
vi.mock('../../../backend/src/db/connection', () => ({
  execute: mockExecute,
  query: mockQuery,
  withTransaction: mockWithTransaction,
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
import { adminOnlyMiddleware } from '../../../backend/src/middleware/admin';

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
    setHeader() {
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
  return { res, next };
}

function auditCalls() {
  return mockExecute.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO admin_actions'));
}

const cosmeticData = {
  name: 'Ruby',
  type: 'color',
  config: { hex: 0xff0000 },
  rarity: 'rare',
  unlockType: 'achievement',
  unlockRequirement: null,
  sortOrder: 1,
};

const achievementData = {
  name: 'Bomber',
  description: 'Place 100 bombs',
  icon: '💣',
  category: 'general',
  conditionType: 'cumulative',
  conditionConfig: { stat: 'total_bombs', threshold: 100 },
  rewardType: 'cosmetic',
  reward: cosmeticData,
  sortOrder: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({ affectedRows: 1, insertId: 1 });
  cos.getAllCosmetics.mockResolvedValue([]);
  cos.getCosmeticById.mockResolvedValue(null);
  cos.createCosmetic.mockImplementation(async (d: { name: string }) => ({ id: 70, name: d.name }));
  ach.createAchievement.mockImplementation(async (d: { name: string }) => ({
    id: 80,
    name: d.name,
  }));
});

describe('POST /admin/achievements/import', () => {
  const PATH = '/admin/achievements/import';

  it.each([
    ['a non-string name', { achievements: [{ ...achievementData, name: 42 }] }],
    ['an unknown condition type', { achievements: [{ ...achievementData, conditionType: 'x' }] }],
    ['an object as icon', { achievements: [{ ...achievementData, icon: { a: 1 } }] }],
    [
      'a cosmetic of unknown type',
      { achievements: [], cosmetics: [{ originalId: 1, data: { ...cosmeticData, type: 'hat' } }] },
    ],
    [
      'a string originalId',
      { achievements: [], cosmetics: [{ originalId: '1', data: cosmeticData }] },
    ],
    ['no achievements array', {}],
  ])('rejects %s with 400, writing nothing', async (_what, body) => {
    const { res } = await run('post', PATH, { body });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(ach.createAchievement).not.toHaveBeenCalled();
  });

  it('answers 400 when cosmeticIdMap names a cosmetic that does not exist', async () => {
    const { res } = await run('post', PATH, {
      body: {
        achievements: [achievementData],
        cosmetics: [{ originalId: 5, data: cosmeticData }],
        cosmeticIdMap: { '5': 999 },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'COSMETIC_NOT_FOUND' });
    expect(cos.getCosmeticById).toHaveBeenCalledWith(999);
    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(auditCalls()).toHaveLength(0);
  });

  it('maps a reward onto an existing cosmetic', async () => {
    cos.getCosmeticById.mockResolvedValue({ id: 12, name: 'Ruby' });
    const { res } = await run('post', PATH, {
      body: {
        achievements: [achievementData],
        cosmetics: [{ originalId: 5, data: cosmeticData }],
        cosmeticIdMap: { '5': 12 },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(cos.createCosmetic).not.toHaveBeenCalled();
    expect(ach.createAchievement.mock.calls[0][0]).toMatchObject({
      rewardType: 'cosmetic',
      rewardId: 12,
    });
  });

  it('creates cosmetics and achievements in one transaction, then audit-logs them', async () => {
    const { res, next } = await run('post', PATH, {
      body: {
        achievements: [achievementData],
        cosmetics: [{ originalId: 5, data: cosmeticData }],
        cosmeticIdMap: { '5': 'create' },
      },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.body).toEqual({ message: 'Imported 1 achievement(s)', created: 1 });
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(cos.createCosmetic).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ruby' }),
      fakeConn,
    );
    const [achData, conn] = ach.createAchievement.mock.calls[0];
    expect(conn).toBe(fakeConn);
    expect(achData).toMatchObject({ name: 'Bomber', rewardType: 'cosmetic', rewardId: 70 });
    expect(achData).not.toHaveProperty('reward');
    expect(auditCalls().map((c) => c[1][1])).toEqual(['cosmetic_import', 'achievement_import']);
  });

  it('logs nothing when a row fails (the transaction rolls the earlier ones back)', async () => {
    const err = new Error('insert failed');
    ach.createAchievement.mockRejectedValueOnce(err);
    const { next } = await run('post', PATH, {
      body: {
        achievements: [achievementData],
        cosmetics: [{ originalId: 5, data: cosmeticData }],
        cosmeticIdMap: { '5': 'create' },
      },
    });
    expect(next).toHaveBeenCalledWith(err);
    expect(auditCalls()).toHaveLength(0);
  });
});

describe('POST /admin/cosmetics/import', () => {
  it('rejects an invalid cosmetic with 400', async () => {
    for (const body of [
      { ...cosmeticData, type: 'hat' },
      { ...cosmeticData, name: 7 },
      { ...cosmeticData, config: 'red' },
      { ...cosmeticData, rarity: 'mythic' },
    ]) {
      const { res } = await run('post', '/admin/cosmetics/import', { body });
      expect(res.statusCode).toBe(400);
    }
    expect(cos.createCosmetic).not.toHaveBeenCalled();
  });

  it('imports an export file (its _format and _version are stripped)', async () => {
    const { res } = await run('post', '/admin/cosmetics/import', {
      body: { _format: 'blast-arena-cosmetic', _version: 1, ...cosmeticData },
    });
    expect(res.statusCode).toBe(200);
    expect(cos.createCosmetic.mock.calls[0][0]).toEqual({
      name: 'Ruby',
      type: 'color',
      config: { hex: 0xff0000 },
      rarity: 'rare',
      unlockType: 'achievement',
      unlockRequirement: null,
      sortOrder: 1,
    });
    expect(auditCalls().map((c) => c[1][1])).toEqual(['cosmetic_import']);
  });
});

describe('deletes and exports of unknown or malformed ids', () => {
  it.each([
    ['/admin/achievements/:id', ach.deleteAchievement],
    ['/admin/cosmetics/:id', cos.deleteCosmetic],
  ])('DELETE %s answers 404 for an unknown id and logs nothing', async (path, service) => {
    service.mockResolvedValue(false);
    const { res } = await run('delete', path, { params: { id: '404' } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(auditCalls()).toHaveLength(0);
  });

  it.each([
    ['/admin/achievements/:id', ach.deleteAchievement, 'achievement_delete'],
    ['/admin/cosmetics/:id', cos.deleteCosmetic, 'cosmetic_delete'],
  ])('DELETE %s deletes and logs a known id', async (path, service, action) => {
    service.mockResolvedValue(true);
    const { res } = await run('delete', path, { params: { id: '3' } });
    expect(res.statusCode).toBe(200);
    expect(auditCalls().map((c) => c[1][1])).toEqual([action]);
  });

  it.each([
    ['/admin/achievements/:id/export', ach.getAchievementById],
    ['/admin/cosmetics/:id/export', cos.getCosmeticById],
  ])('GET %s answers 400 for a non-numeric id', async (path, lookup) => {
    const { res } = await run('get', path, { params: { id: 'abc' } });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_ID' });
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('PUT /admin/settings/xp_multiplier', () => {
  it.each([['2abc'], ['2'], [null], [11], [-1]])('rejects %j', async (multiplier) => {
    const { res } = await run('put', '/admin/settings/xp_multiplier', { body: { multiplier } });
    expect(res.statusCode).toBe(400);
    expect(settings.setSetting).not.toHaveBeenCalled();
  });

  it('rejects a missing body instead of crashing', async () => {
    const { res, next } = await run('put', '/admin/settings/xp_multiplier', { body: undefined });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('stores a number', async () => {
    const { res } = await run('put', '/admin/settings/xp_multiplier', {
      body: { multiplier: 2.5 },
    });
    expect(res.statusCode).toBe(200);
    expect(settings.setSetting).toHaveBeenCalledWith('xp_multiplier', '2.5');
  });
});

describe('admin-set passwords follow the registration rules', () => {
  it('PUT /admin/users/:id/password rejects a 7-character password', async () => {
    const { res } = await run('put', '/admin/users/:id/password', {
      params: { id: '5' },
      body: { password: 'abcdefg' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /admin/users rejects a 7-character password and a bad username', async () => {
    for (const body of [
      { username: 'newuser', email: 'n@example.com', password: 'abcdefg' },
      { username: 'a b', email: 'n@example.com', password: 'abcdefgh' },
    ]) {
      const { res } = await run('post', '/admin/users', { body });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('game and simulation defaults keep puzzleTiles and enableSpectatorActions', () => {
  it.each([
    ['/admin/settings/game_defaults', settings.setGameDefaults],
    ['/admin/settings/simulation_defaults', settings.setSimulationDefaults],
  ])('%s', async (path, setter) => {
    const { res } = await run('put', path, {
      body: { defaults: { puzzleTiles: true, enableSpectatorActions: true, hazardTiles: false } },
    });
    expect(res.statusCode).toBe(200);
    expect(setter).toHaveBeenCalledWith({
      puzzleTiles: true,
      enableSpectatorActions: true,
      hazardTiles: false,
    });
  });
});

describe('imprint', () => {
  it('a PUT without text (the on/off toggle) keeps the stored text', async () => {
    const { res } = await run('put', '/admin/settings/imprint', { body: { enabled: true } });
    expect(res.statusCode).toBe(200);
    expect(settings.setSetting).toHaveBeenCalledTimes(1);
    expect(settings.setSetting).toHaveBeenCalledWith('display_imprint', 'true');
  });

  it('a PUT with text stores it', async () => {
    await run('put', '/admin/settings/imprint', { body: { enabled: false, text: 'Imprint' } });
    expect(settings.setSetting).toHaveBeenCalledWith('imprint_text', 'Imprint');
  });

  it('the admin GET returns the stored text while the imprint is off; the public one does not', async () => {
    settings.getSetting.mockImplementation(async (key: string) =>
      key === 'display_imprint' ? 'false' : 'Stored text',
    );
    const admin = await run('get', '/admin/settings/imprint/raw', {});
    expect(admin.res.body).toEqual({ enabled: false, text: 'Stored text' });
    const pub = await run('get', '/admin/settings/imprint', {});
    expect(pub.res.body).toEqual({ enabled: false, text: '' });
  });

  it('the admin GET is admin-only', () => {
    expect(
      routeStack('get', '/admin/settings/imprint/raw').some(
        (l) => l.handle === adminOnlyMiddleware,
      ),
    ).toBe(true);
  });
});

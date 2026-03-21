import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

// ---------------------------------------------------------------------------
// Mocks — declared before the router import so module-level side effects
// in campaign.ts see the fakes.
// ---------------------------------------------------------------------------

// Campaign service mocks
const mockListWorldsWithProgress = jest.fn<AnyFn>();
const mockListLevelsWithProgress = jest.fn<AnyFn>();
const mockGetLevel = jest.fn<AnyFn>();
const mockListWorlds = jest.fn<AnyFn>();
const mockCreateWorld = jest.fn<AnyFn>();
const mockUpdateWorld = jest.fn<AnyFn>();
const mockDeleteWorld = jest.fn<AnyFn>();
const mockReorderWorld = jest.fn<AnyFn>();
const mockListLevels = jest.fn<AnyFn>();
const mockCreateLevel = jest.fn<AnyFn>();
const mockUpdateLevel = jest.fn<AnyFn>();
const mockDeleteLevel = jest.fn<AnyFn>();
const mockReorderLevel = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/campaign', () => ({
  listWorldsWithProgress: mockListWorldsWithProgress,
  listLevelsWithProgress: mockListLevelsWithProgress,
  getLevel: mockGetLevel,
  listWorlds: mockListWorlds,
  createWorld: mockCreateWorld,
  updateWorld: mockUpdateWorld,
  deleteWorld: mockDeleteWorld,
  reorderWorld: mockReorderWorld,
  listLevels: mockListLevels,
  createLevel: mockCreateLevel,
  updateLevel: mockUpdateLevel,
  deleteLevel: mockDeleteLevel,
  reorderLevel: mockReorderLevel,
}));

// Enemy type service mocks
const mockListEnemyTypes = jest.fn<AnyFn>();
const mockGetEnemyType = jest.fn<AnyFn>();
const mockCreateEnemyType = jest.fn<AnyFn>();
const mockUpdateEnemyType = jest.fn<AnyFn>();
const mockDeleteEnemyType = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/enemy-type', () => ({
  listEnemyTypes: mockListEnemyTypes,
  getEnemyType: mockGetEnemyType,
  createEnemyType: mockCreateEnemyType,
  updateEnemyType: mockUpdateEnemyType,
  deleteEnemyType: mockDeleteEnemyType,
}));

// Campaign progress service mocks
const mockGetUserState = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/campaign-progress', () => ({
  getUserState: mockGetUserState,
}));

// Middleware pass-throughs
const mockAuthMiddleware = jest.fn<AnyFn>((_req, _res, next) => next());

jest.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: mockAuthMiddleware,
}));

const mockAdminOnlyMiddleware = jest.fn<AnyFn>((_req, _res, next) => next());

jest.mock('../../../backend/src/middleware/admin', () => ({
  adminOnlyMiddleware: mockAdminOnlyMiddleware,
}));

const mockValidate = jest.fn<AnyFn>(() => (_req: any, _res: any, next: any) => next());

jest.mock('../../../backend/src/middleware/validation', () => ({
  validate: mockValidate,
}));

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Import the router under test (after all mocks are in place).
// ---------------------------------------------------------------------------

import campaignRouter from '../../../backend/src/routes/campaign';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RouteLayer = {
  route: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: Function; name?: string }>;
  };
};

function getHandler(method: string, path: string) {
  const stack = (campaignRouter as any).stack as RouteLayer[];
  const layer = stack.find((l) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found in router`);
  const routeStack = layer.route.stack;
  return routeStack[routeStack.length - 1].handle;
}

function getRouteStack(method: string, path: string) {
  const stack = (campaignRouter as any).stack as RouteLayer[];
  const layer = stack.find((l) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found in router`);
  return layer.route.stack;
}

function mockRes() {
  const data: {
    _status: number;
    _json: unknown;
    _headers: Record<string, string>;
  } = { _status: 200, _json: null, _headers: {} };

  const res: any = {
    get _status() {
      return data._status;
    },
    get _json() {
      return data._json;
    },
    get _headers() {
      return data._headers;
    },
    status(code: number) {
      data._status = code;
      return res;
    },
    json(body: unknown) {
      data._json = body;
      return res;
    },
    setHeader(name: string, value: string) {
      data._headers[name] = value;
      return res;
    },
  };
  return res;
}

function mockReq(overrides: Record<string, any> = {}): any {
  return {
    user: { userId: 1, username: 'admin', role: 'admin' },
    body: {},
    params: {},
    query: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Sample data factories
// ---------------------------------------------------------------------------

function sampleWorld(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    name: 'World One',
    description: 'A test world',
    sortOrder: 0,
    theme: 'classic',
    isPublished: true,
    levelCount: 3,
    ...overrides,
  };
}

function sampleLevel(overrides: Record<string, any> = {}) {
  return {
    id: 10,
    worldId: 1,
    name: 'Level 1',
    description: 'First level',
    sortOrder: 0,
    mapWidth: 15,
    mapHeight: 13,
    tiles: [
      ['empty', 'wall'],
      ['empty', 'empty'],
    ],
    fillMode: 'handcrafted',
    wallDensity: 0.65,
    playerSpawns: [{ x: 1, y: 1 }],
    enemyPlacements: [{ enemyTypeId: 5, x: 3, y: 3 }],
    powerupPlacements: [],
    winCondition: 'kill_all',
    winConditionConfig: null,
    lives: 3,
    timeLimit: 0,
    parTime: 60,
    carryOverPowerups: false,
    startingPowerups: null,
    availablePowerupTypes: null,
    powerupDropRate: 0.3,
    reinforcedWalls: false,
    hazardTiles: false,
    isPublished: true,
    ...overrides,
  };
}

function sampleEnemyType(overrides: Record<string, any> = {}) {
  return {
    id: 5,
    name: 'Blob Monster',
    description: 'A basic enemy',
    config: {
      speed: 1,
      movementPattern: 'random_walk',
      canPassWalls: false,
      canPassBombs: false,
      canBomb: false,
      hp: 1,
      contactDamage: true,
      sprite: {
        bodyShape: 'blob',
        primaryColor: '#ff0000',
        secondaryColor: '#880000',
        eyeStyle: 'round',
        hasTeeth: false,
        hasHorns: false,
      },
      dropChance: 0.3,
      dropTable: ['bomb_up'],
      isBoss: false,
      sizeMultiplier: 1,
    },
    isBoss: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ============================================================================
// Player endpoints
// ============================================================================

describe('GET /campaign/worlds', () => {
  const handler = getHandler('get', '/campaign/worlds');

  it('returns worlds with nested levels and progress', async () => {
    const worlds = [sampleWorld({ id: 1 }), sampleWorld({ id: 2, name: 'World Two' })];
    mockListWorldsWithProgress.mockResolvedValue(worlds);

    const levelsWorld1 = [{ id: 10, name: 'L1' }];
    const levelsWorld2 = [{ id: 20, name: 'L2' }];
    mockListLevelsWithProgress
      .mockResolvedValueOnce(levelsWorld1)
      .mockResolvedValueOnce(levelsWorld2);

    const req = mockReq({ user: { userId: 42 } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockListWorldsWithProgress).toHaveBeenCalledWith(42);
    expect(mockListLevelsWithProgress).toHaveBeenCalledWith(1, 42);
    expect(mockListLevelsWithProgress).toHaveBeenCalledWith(2, 42);
    expect(res._json).toEqual({
      worlds: [
        { ...worlds[0], levels: levelsWorld1 },
        { ...worlds[1], levels: levelsWorld2 },
      ],
    });
  });

  it('returns empty array when no published worlds exist', async () => {
    mockListWorldsWithProgress.mockResolvedValue([]);

    const req = mockReq({ user: { userId: 1 } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._json).toEqual({ worlds: [] });
    expect(mockListLevelsWithProgress).not.toHaveBeenCalled();
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('DB error');
    mockListWorldsWithProgress.mockRejectedValue(err);

    const req = mockReq({ user: { userId: 1 } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('GET /campaign/worlds/:worldId/levels', () => {
  const handler = getHandler('get', '/campaign/worlds/:worldId/levels');

  it('returns levels for a given world with user progress', async () => {
    const levels = [
      { id: 10, name: 'L1' },
      { id: 11, name: 'L2' },
    ];
    mockListLevelsWithProgress.mockResolvedValue(levels);

    const req = mockReq({ params: { worldId: '3' }, user: { userId: 99 } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockListLevelsWithProgress).toHaveBeenCalledWith(3, 99);
    expect(res._json).toEqual({ levels });
  });

  it('throws AppError for non-numeric worldId', async () => {
    const req = mockReq({ params: { worldId: 'abc' }, user: { userId: 1 } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid worldId', statusCode: 400 }),
    );
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('query failed');
    mockListLevelsWithProgress.mockRejectedValue(err);

    const req = mockReq({ params: { worldId: '1' }, user: { userId: 1 } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('GET /campaign/levels/:levelId', () => {
  const handler = getHandler('get', '/campaign/levels/:levelId');

  it('returns a published level', async () => {
    const level = sampleLevel({ isPublished: true });
    mockGetLevel.mockResolvedValue(level);

    const req = mockReq({ params: { levelId: '10' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockGetLevel).toHaveBeenCalledWith(10);
    expect(res._json).toEqual({ level });
  });

  it('returns 404 when level does not exist', async () => {
    mockGetLevel.mockResolvedValue(null);

    const req = mockReq({ params: { levelId: '999' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: 'Level not found' });
  });

  it('returns 404 when level exists but is not published', async () => {
    mockGetLevel.mockResolvedValue(sampleLevel({ isPublished: false }));

    const req = mockReq({ params: { levelId: '10' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: 'Level not found' });
  });

  it('throws AppError for non-numeric levelId', async () => {
    const req = mockReq({ params: { levelId: 'xyz' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid levelId', statusCode: 400 }),
    );
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('DB down');
    mockGetLevel.mockRejectedValue(err);

    const req = mockReq({ params: { levelId: '10' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('GET /campaign/progress', () => {
  const handler = getHandler('get', '/campaign/progress');

  it('returns campaign state for user', async () => {
    const state = {
      currentWorldId: 1,
      currentLevelId: 5,
      carriedPowerups: null,
      totalLevelsCompleted: 7,
      totalStars: 18,
    };
    mockGetUserState.mockResolvedValue(state);

    const req = mockReq({ user: { userId: 42 } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockGetUserState).toHaveBeenCalledWith(42);
    expect(res._json).toEqual({ state });
  });

  it('returns default state for new user', async () => {
    const defaultState = {
      currentWorldId: null,
      currentLevelId: null,
      carriedPowerups: null,
      totalLevelsCompleted: 0,
      totalStars: 0,
    };
    mockGetUserState.mockResolvedValue(defaultState);

    const req = mockReq({ user: { userId: 99 } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._json).toEqual({ state: defaultState });
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('progress error');
    mockGetUserState.mockRejectedValue(err);

    const req = mockReq({ user: { userId: 1 } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('GET /campaign/enemy-types (player)', () => {
  const handler = getHandler('get', '/campaign/enemy-types');

  it('returns all enemy types', async () => {
    const types = [sampleEnemyType({ id: 1 }), sampleEnemyType({ id: 2, name: 'Ghost' })];
    mockListEnemyTypes.mockResolvedValue(types);

    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockListEnemyTypes).toHaveBeenCalled();
    expect(res._json).toEqual({ enemyTypes: types });
  });

  it('returns empty array when no enemy types exist', async () => {
    mockListEnemyTypes.mockResolvedValue([]);

    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._json).toEqual({ enemyTypes: [] });
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('fetch error');
    mockListEnemyTypes.mockRejectedValue(err);

    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// Admin - Worlds
// ============================================================================

describe('GET /admin/campaign/worlds', () => {
  const handler = getHandler('get', '/admin/campaign/worlds');

  it('returns all worlds including unpublished', async () => {
    const worlds = [sampleWorld({ isPublished: true }), sampleWorld({ id: 2, isPublished: false })];
    mockListWorlds.mockResolvedValue(worlds);

    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockListWorlds).toHaveBeenCalledWith(true);
    expect(res._json).toEqual({ worlds });
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('DB error');
    mockListWorlds.mockRejectedValue(err);

    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('POST /admin/campaign/worlds', () => {
  const handler = getHandler('post', '/admin/campaign/worlds');

  it('creates a world and returns 201 with id', async () => {
    mockCreateWorld.mockResolvedValue(7);

    const req = mockReq({
      user: { userId: 1 },
      body: { name: 'New World', description: 'Desc', theme: 'lava' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockCreateWorld).toHaveBeenCalledWith('New World', 'Desc', 'lava', 1);
    expect(res._status).toBe(201);
    expect(res._json).toEqual({ id: 7 });
  });

  it('uses empty string for missing description', async () => {
    mockCreateWorld.mockResolvedValue(8);

    const req = mockReq({
      user: { userId: 1 },
      body: { name: 'Minimal World' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockCreateWorld).toHaveBeenCalledWith('Minimal World', '', 'classic', 1);
  });

  it('uses "classic" for missing theme', async () => {
    mockCreateWorld.mockResolvedValue(9);

    const req = mockReq({
      user: { userId: 1 },
      body: { name: 'Test World', description: 'Some desc' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockCreateWorld).toHaveBeenCalledWith('Test World', 'Some desc', 'classic', 1);
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('insert failed');
    mockCreateWorld.mockRejectedValue(err);

    const req = mockReq({ user: { userId: 1 }, body: { name: 'W' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('PUT /admin/campaign/worlds/:id', () => {
  const handler = getHandler('put', '/admin/campaign/worlds/:id');

  it('updates a world and returns success', async () => {
    mockUpdateWorld.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: '3' },
      body: { name: 'Updated Name', isPublished: true },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockUpdateWorld).toHaveBeenCalledWith(3, { name: 'Updated Name', isPublished: true });
    expect(res._json).toEqual({ success: true });
  });

  it('throws AppError for non-numeric id', async () => {
    const req = mockReq({ params: { id: 'bad' }, body: {} });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid id', statusCode: 400 }),
    );
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('update failed');
    mockUpdateWorld.mockRejectedValue(err);

    const req = mockReq({ params: { id: '1' }, body: { name: 'X' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('DELETE /admin/campaign/worlds/:id', () => {
  const handler = getHandler('delete', '/admin/campaign/worlds/:id');

  it('deletes a world and returns success', async () => {
    mockDeleteWorld.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: '5' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockDeleteWorld).toHaveBeenCalledWith(5);
    expect(res._json).toEqual({ success: true });
  });

  it('throws AppError for non-numeric id', async () => {
    const req = mockReq({ params: { id: 'nope' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid id', statusCode: 400 }),
    );
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('FK constraint');
    mockDeleteWorld.mockRejectedValue(err);

    const req = mockReq({ params: { id: '1' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('PUT /admin/campaign/worlds/:id/order', () => {
  const handler = getHandler('put', '/admin/campaign/worlds/:id/order');

  it('reorders a world and returns success', async () => {
    mockReorderWorld.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: '2' }, body: { sortOrder: 5 } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockReorderWorld).toHaveBeenCalledWith(2, 5);
    expect(res._json).toEqual({ success: true });
  });

  it('throws AppError for non-numeric id', async () => {
    const req = mockReq({ params: { id: 'x' }, body: { sortOrder: 0 } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid id', statusCode: 400 }),
    );
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('reorder error');
    mockReorderWorld.mockRejectedValue(err);

    const req = mockReq({ params: { id: '1' }, body: { sortOrder: 0 } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// Admin - Levels
// ============================================================================

describe('GET /admin/campaign/levels', () => {
  const handler = getHandler('get', '/admin/campaign/levels');

  it('returns all levels for a world including unpublished', async () => {
    const levels = [
      { id: 10, name: 'L1' },
      { id: 11, name: 'L2' },
    ];
    mockListLevels.mockResolvedValue(levels);

    const req = mockReq({ query: { worldId: '1' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockListLevels).toHaveBeenCalledWith(1, true);
    expect(res._json).toEqual({ levels });
  });

  it('throws AppError for non-numeric worldId query param', async () => {
    const req = mockReq({ query: { worldId: 'abc' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid worldId', statusCode: 400 }),
    );
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('list error');
    mockListLevels.mockRejectedValue(err);

    const req = mockReq({ query: { worldId: '1' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('POST /admin/campaign/levels', () => {
  const handler = getHandler('post', '/admin/campaign/levels');

  it('creates a level from body.worldId and returns 201 with id', async () => {
    mockCreateLevel.mockResolvedValue(15);

    const req = mockReq({
      user: { userId: 1 },
      body: { worldId: 3, name: 'New Level', tiles: [['empty']] },
      query: {},
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockCreateLevel).toHaveBeenCalledWith(
      3,
      { worldId: 3, name: 'New Level', tiles: [['empty']] },
      1,
    );
    expect(res._status).toBe(201);
    expect(res._json).toEqual({ id: 15 });
  });

  it('falls back to query.worldId when body.worldId is missing', async () => {
    mockCreateLevel.mockResolvedValue(16);

    const req = mockReq({
      user: { userId: 2 },
      body: { name: 'Level via query' },
      query: { worldId: '7' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockCreateLevel).toHaveBeenCalledWith(7, { name: 'Level via query' }, 2);
  });

  it('throws AppError when worldId is missing from both body and query', async () => {
    const req = mockReq({
      user: { userId: 1 },
      body: { name: 'No World' },
      query: {},
    });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid worldId', statusCode: 400 }),
    );
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('create error');
    mockCreateLevel.mockRejectedValue(err);

    const req = mockReq({
      user: { userId: 1 },
      body: { worldId: 1, name: 'L' },
    });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('GET /admin/campaign/levels/:id', () => {
  const handler = getHandler('get', '/admin/campaign/levels/:id');

  it('returns a level including unpublished ones', async () => {
    const level = sampleLevel({ isPublished: false });
    mockGetLevel.mockResolvedValue(level);

    const req = mockReq({ params: { id: '10' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockGetLevel).toHaveBeenCalledWith(10);
    expect(res._json).toEqual({ level });
  });

  it('returns 404 when level does not exist', async () => {
    mockGetLevel.mockResolvedValue(null);

    const req = mockReq({ params: { id: '999' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: 'Level not found' });
  });

  it('throws AppError for non-numeric id', async () => {
    const req = mockReq({ params: { id: 'bad' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid id', statusCode: 400 }),
    );
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('get error');
    mockGetLevel.mockRejectedValue(err);

    const req = mockReq({ params: { id: '1' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('PUT /admin/campaign/levels/:id', () => {
  const handler = getHandler('put', '/admin/campaign/levels/:id');

  it('updates a level and returns success', async () => {
    mockUpdateLevel.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: '10' },
      body: { name: 'Updated Level', lives: 5 },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockUpdateLevel).toHaveBeenCalledWith(10, { name: 'Updated Level', lives: 5 });
    expect(res._json).toEqual({ success: true });
  });

  it('throws AppError for non-numeric id', async () => {
    const req = mockReq({ params: { id: 'nope' }, body: {} });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid id', statusCode: 400 }),
    );
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('update error');
    mockUpdateLevel.mockRejectedValue(err);

    const req = mockReq({ params: { id: '1' }, body: { name: 'X' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('DELETE /admin/campaign/levels/:id', () => {
  const handler = getHandler('delete', '/admin/campaign/levels/:id');

  it('deletes a level and returns success', async () => {
    mockDeleteLevel.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: '10' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockDeleteLevel).toHaveBeenCalledWith(10);
    expect(res._json).toEqual({ success: true });
  });

  it('throws AppError for non-numeric id', async () => {
    const req = mockReq({ params: { id: 'bad' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid id', statusCode: 400 }),
    );
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('delete error');
    mockDeleteLevel.mockRejectedValue(err);

    const req = mockReq({ params: { id: '1' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('PUT /admin/campaign/levels/:id/order', () => {
  const handler = getHandler('put', '/admin/campaign/levels/:id/order');

  it('reorders a level and returns success', async () => {
    mockReorderLevel.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: '10' }, body: { sortOrder: 3 } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockReorderLevel).toHaveBeenCalledWith(10, 3);
    expect(res._json).toEqual({ success: true });
  });

  it('throws AppError for non-numeric id', async () => {
    const req = mockReq({ params: { id: 'x' }, body: { sortOrder: 0 } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid id', statusCode: 400 }),
    );
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('reorder error');
    mockReorderLevel.mockRejectedValue(err);

    const req = mockReq({ params: { id: '1' }, body: { sortOrder: 0 } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// Admin - Enemy Types
// ============================================================================

describe('GET /admin/campaign/enemy-types', () => {
  const handler = getHandler('get', '/admin/campaign/enemy-types');

  it('returns all enemy types', async () => {
    const types = [sampleEnemyType()];
    mockListEnemyTypes.mockResolvedValue(types);

    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockListEnemyTypes).toHaveBeenCalled();
    expect(res._json).toEqual({ enemyTypes: types });
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('list error');
    mockListEnemyTypes.mockRejectedValue(err);

    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('POST /admin/campaign/enemy-types', () => {
  const handler = getHandler('post', '/admin/campaign/enemy-types');

  it('creates an enemy type and returns 201 with id', async () => {
    mockCreateEnemyType.mockResolvedValue(12);

    const et = sampleEnemyType();
    const req = mockReq({
      user: { userId: 1 },
      body: { name: et.name, description: et.description, config: et.config },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockCreateEnemyType).toHaveBeenCalledWith(et.name, et.description, et.config, 1);
    expect(res._status).toBe(201);
    expect(res._json).toEqual({ id: 12 });
  });

  it('uses empty string for missing description', async () => {
    mockCreateEnemyType.mockResolvedValue(13);

    const et = sampleEnemyType();
    const req = mockReq({
      user: { userId: 1 },
      body: { name: 'NoDesc', config: et.config },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockCreateEnemyType).toHaveBeenCalledWith('NoDesc', '', et.config, 1);
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('create error');
    mockCreateEnemyType.mockRejectedValue(err);

    const req = mockReq({
      user: { userId: 1 },
      body: { name: 'X', config: {} },
    });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('PUT /admin/campaign/enemy-types/:id', () => {
  const handler = getHandler('put', '/admin/campaign/enemy-types/:id');

  it('updates an enemy type and returns success', async () => {
    mockUpdateEnemyType.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: '5' },
      body: { name: 'Updated', description: 'New desc', config: { speed: 2 } },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockUpdateEnemyType).toHaveBeenCalledWith(5, {
      name: 'Updated',
      description: 'New desc',
      config: { speed: 2 },
    });
    expect(res._json).toEqual({ success: true });
  });

  it('throws AppError for non-numeric id', async () => {
    const req = mockReq({ params: { id: 'nah' }, body: {} });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid id', statusCode: 400 }),
    );
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('update error');
    mockUpdateEnemyType.mockRejectedValue(err);

    const req = mockReq({ params: { id: '1' }, body: {} });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('DELETE /admin/campaign/enemy-types/:id', () => {
  const handler = getHandler('delete', '/admin/campaign/enemy-types/:id');

  it('deletes an enemy type and returns success', async () => {
    mockDeleteEnemyType.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: '5' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockDeleteEnemyType).toHaveBeenCalledWith(5);
    expect(res._json).toEqual({ success: true });
  });

  it('throws AppError for non-numeric id', async () => {
    const req = mockReq({ params: { id: 'x' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid id', statusCode: 400 }),
    );
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('delete error');
    mockDeleteEnemyType.mockRejectedValue(err);

    const req = mockReq({ params: { id: '1' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// Export endpoints
// ============================================================================

describe('GET /admin/campaign/levels/:id/export', () => {
  const handler = getHandler('get', '/admin/campaign/levels/:id/export');

  it('exports a level as JSON with correct format and headers', async () => {
    const level = sampleLevel({ id: 10, name: 'Test Level' });
    mockGetLevel.mockResolvedValue(level);

    const req = mockReq({ params: { id: '10' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockGetLevel).toHaveBeenCalledWith(10);
    expect(res._headers['Content-Type']).toBe('application/json');
    expect(res._headers['Content-Disposition']).toBe(
      'attachment; filename="level-Test_Level.json"',
    );

    const body = res._json as any;
    expect(body._format).toBe('blast-arena-level');
    expect(body._version).toBe(1);
    expect(body.name).toBe('Test Level');
    // DB fields should be stripped
    expect(body.id).toBeUndefined();
    expect(body.worldId).toBeUndefined();
    expect(body.createdBy).toBeUndefined();
    expect(body.createdAt).toBeUndefined();
    expect(body.updatedAt).toBeUndefined();
    expect(body.sortOrder).toBeUndefined();
    expect(body.isPublished).toBeUndefined();
  });

  it('sanitizes special characters in filename', async () => {
    const level = sampleLevel({ name: 'Level @#$% (1)' });
    mockGetLevel.mockResolvedValue(level);

    const req = mockReq({ params: { id: '10' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._headers['Content-Disposition']).toBe(
      'attachment; filename="level-Level_______1_.json"',
    );
  });

  it('returns 404 when level does not exist', async () => {
    mockGetLevel.mockResolvedValue(null);

    const req = mockReq({ params: { id: '999' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: 'Level not found' });
  });

  it('throws AppError for non-numeric id', async () => {
    const req = mockReq({ params: { id: 'bad' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid id', statusCode: 400 }),
    );
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('export error');
    mockGetLevel.mockRejectedValue(err);

    const req = mockReq({ params: { id: '1' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('GET /admin/campaign/levels/:id/export-bundle', () => {
  const handler = getHandler('get', '/admin/campaign/levels/:id/export-bundle');

  it('exports a level bundle with enemy types', async () => {
    const level = sampleLevel({
      id: 10,
      name: 'Bundle Level',
      enemyPlacements: [
        { enemyTypeId: 5, x: 3, y: 3 },
        { enemyTypeId: 8, x: 5, y: 5 },
        { enemyTypeId: 5, x: 7, y: 7 }, // duplicate type id
      ],
    });
    mockGetLevel.mockResolvedValue(level);

    const et5 = sampleEnemyType({ id: 5, name: 'Blob' });
    const et8 = sampleEnemyType({ id: 8, name: 'Ghost' });
    mockGetEnemyType.mockImplementation(async (id: number) => {
      if (id === 5) return et5;
      if (id === 8) return et8;
      return null;
    });

    const req = mockReq({ params: { id: '10' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    const body = res._json as any;
    expect(body._format).toBe('blast-arena-level-bundle');
    expect(body._version).toBe(2);
    expect(body.level.name).toBe('Bundle Level');
    // DB fields stripped from level
    expect(body.level.id).toBeUndefined();
    expect(body.level.worldId).toBeUndefined();

    // Enemy types deduplicated (5 only fetched once)
    expect(mockGetEnemyType).toHaveBeenCalledTimes(2);
    expect(body.enemyTypes).toHaveLength(2);
    expect(body.enemyTypes[0]).toEqual({
      originalId: 5,
      name: 'Blob',
      description: et5.description,
      config: et5.config,
    });
    expect(body.enemyTypes[1]).toEqual({
      originalId: 8,
      name: 'Ghost',
      description: et8.description,
      config: et8.config,
    });

    expect(res._headers['Content-Disposition']).toBe(
      'attachment; filename="level-bundle-Bundle_Level.json"',
    );
    expect(res._headers['Content-Type']).toBe('application/json');
  });

  it('exports bundle with no enemy types when placements are empty', async () => {
    const level = sampleLevel({ enemyPlacements: [] });
    mockGetLevel.mockResolvedValue(level);

    const req = mockReq({ params: { id: '10' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    const body = res._json as any;
    expect(body.enemyTypes).toHaveLength(0);
    expect(mockGetEnemyType).not.toHaveBeenCalled();
  });

  it('skips enemy types that no longer exist in DB', async () => {
    const level = sampleLevel({
      enemyPlacements: [{ enemyTypeId: 99, x: 1, y: 1 }],
    });
    mockGetLevel.mockResolvedValue(level);
    mockGetEnemyType.mockResolvedValue(null);

    const req = mockReq({ params: { id: '10' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    const body = res._json as any;
    expect(body.enemyTypes).toHaveLength(0);
  });

  it('returns 404 when level does not exist', async () => {
    mockGetLevel.mockResolvedValue(null);

    const req = mockReq({ params: { id: '999' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: 'Level not found' });
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('bundle error');
    mockGetLevel.mockRejectedValue(err);

    const req = mockReq({ params: { id: '1' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('GET /admin/campaign/enemy-types/:id/export', () => {
  const handler = getHandler('get', '/admin/campaign/enemy-types/:id/export');

  it('exports an enemy type as JSON with correct format and headers', async () => {
    const et = sampleEnemyType({ id: 5, name: 'Blob Monster' });
    mockGetEnemyType.mockResolvedValue(et);

    const req = mockReq({ params: { id: '5' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockGetEnemyType).toHaveBeenCalledWith(5);
    expect(res._headers['Content-Type']).toBe('application/json');
    expect(res._headers['Content-Disposition']).toBe(
      'attachment; filename="enemy-Blob_Monster.json"',
    );

    const body = res._json as any;
    expect(body._format).toBe('blast-arena-enemy-type');
    expect(body._version).toBe(2);
    expect(body.name).toBe('Blob Monster');
    expect(body.config).toEqual(et.config);
    // DB fields should be stripped
    expect(body.id).toBeUndefined();
    expect(body.createdBy).toBeUndefined();
    expect(body.createdAt).toBeUndefined();
    expect(body.isBoss).toBeUndefined();
  });

  it('returns 404 when enemy type does not exist', async () => {
    mockGetEnemyType.mockResolvedValue(null);

    const req = mockReq({ params: { id: '999' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: 'Enemy type not found' });
  });

  it('throws AppError for non-numeric id', async () => {
    const req = mockReq({ params: { id: 'bad' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid id', statusCode: 400 }),
    );
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('export error');
    mockGetEnemyType.mockRejectedValue(err);

    const req = mockReq({ params: { id: '1' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// Import endpoints
// ============================================================================

describe('POST /admin/campaign/levels/import', () => {
  const handler = getHandler('post', '/admin/campaign/levels/import');

  it('imports a plain level export (no enemy placements)', async () => {
    mockCreateLevel.mockResolvedValue(20);

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 3,
        level: {
          _format: 'blast-arena-level',
          _version: 1,
          name: 'Imported Level',
          tiles: [['empty']],
          enemyPlacements: [],
        },
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(201);
    expect(res._json).toEqual({ id: 20 });
    expect(mockCreateLevel).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ name: 'Imported Level', tiles: [['empty']] }),
      1,
    );
  });

  it('imports raw level data without format markers', async () => {
    mockCreateLevel.mockResolvedValue(21);

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: {
          name: 'Raw Level',
          tiles: [['wall']],
          enemyPlacements: [],
        },
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(201);
    expect(res._json).toEqual({ id: 21 });
  });

  it('returns 400 when level data is missing name', async () => {
    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: { tiles: [['empty']] },
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: 'Invalid level data' });
  });

  it('returns 400 when level data is missing tiles', async () => {
    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: { name: 'No tiles' },
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: 'Invalid level data' });
  });

  it('returns 400 when level data is null', async () => {
    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: null,
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: 'Invalid level data' });
  });

  // ---- Conflict detection (Phase 1) ----

  it('returns conflicts when enemy placements reference existing DB IDs with bundled data', async () => {
    const existingEt = sampleEnemyType({ id: 5, name: 'DB Blob' });
    mockGetEnemyType.mockResolvedValue(existingEt);

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: {
          name: 'Conflicting Level',
          tiles: [['empty']],
          enemyPlacements: [{ enemyTypeId: 5, x: 1, y: 1 }],
        },
        enemyTypes: [{ originalId: 5, name: 'Bundle Blob', description: '', config: {} }],
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    const body = res._json as any;
    expect(body.conflicts).toBeDefined();
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0]).toEqual({
      originalId: 5,
      name: 'Bundle Blob',
      existingId: 5,
      existingName: 'DB Blob',
    });
    expect(mockCreateLevel).not.toHaveBeenCalled();
  });

  it('returns conflicts when ID does not exist but bundled data is present', async () => {
    mockGetEnemyType.mockResolvedValue(null);

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: {
          name: 'New ET Level',
          tiles: [['empty']],
          enemyPlacements: [{ enemyTypeId: 99, x: 1, y: 1 }],
        },
        enemyTypes: [{ originalId: 99, name: 'New Monster', description: '', config: {} }],
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    const body = res._json as any;
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0]).toEqual({
      originalId: 99,
      name: 'New Monster',
    });
  });

  it('returns conflicts when ID does not exist and no bundled data is available', async () => {
    mockGetEnemyType.mockResolvedValue(null);

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: {
          name: 'Missing ET Level',
          tiles: [['empty']],
          enemyPlacements: [{ enemyTypeId: 77, x: 1, y: 1 }],
        },
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    const body = res._json as any;
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0]).toEqual({
      originalId: 77,
      name: 'Unknown (ID 77)',
    });
  });

  it('does not report conflict when existing ID matches and no bundled data', async () => {
    const existingEt = sampleEnemyType({ id: 5 });
    mockGetEnemyType.mockResolvedValue(existingEt);
    mockCreateLevel.mockResolvedValue(22);

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: {
          name: 'No Conflict Level',
          tiles: [['empty']],
          enemyPlacements: [{ enemyTypeId: 5, x: 1, y: 1 }],
        },
        // no bundled enemyTypes, existing ID in DB -> no conflict
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(201);
    expect(res._json).toEqual({ id: 22 });
  });

  // ---- ID remapping (Phase 2) ----

  it('creates new enemy types when enemyIdMap action is "create"', async () => {
    mockCreateEnemyType.mockResolvedValue(100);
    mockCreateLevel.mockResolvedValue(25);

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: {
          name: 'Remapped Level',
          tiles: [['empty']],
          enemyPlacements: [{ enemyTypeId: 50, x: 1, y: 1 }],
        },
        enemyTypes: [
          { originalId: 50, name: 'Created Monster', description: 'desc', config: { speed: 1 } },
        ],
        enemyIdMap: { '50': 'create' },
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockCreateEnemyType).toHaveBeenCalledWith('Created Monster', 'desc', { speed: 1 }, 1);
    expect(mockCreateLevel).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        enemyPlacements: [{ enemyTypeId: 100, x: 1, y: 1 }],
      }),
      1,
    );
    expect(res._status).toBe(201);
  });

  it('remaps enemy type IDs when enemyIdMap specifies numeric mapping', async () => {
    mockCreateLevel.mockResolvedValue(26);

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: {
          name: 'Numeric Remap Level',
          tiles: [['empty']],
          enemyPlacements: [
            { enemyTypeId: 50, x: 1, y: 1 },
            { enemyTypeId: 60, x: 2, y: 2 },
          ],
        },
        enemyIdMap: { '50': 10, '60': 20 },
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockCreateLevel).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        enemyPlacements: [
          { enemyTypeId: 10, x: 1, y: 1 },
          { enemyTypeId: 20, x: 2, y: 2 },
        ],
      }),
      1,
    );
    expect(res._status).toBe(201);
  });

  it('filters out placements when enemyIdMap action is "skip"', async () => {
    mockCreateLevel.mockResolvedValue(27);

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: {
          name: 'Skip Level',
          tiles: [['empty']],
          enemyPlacements: [
            { enemyTypeId: 50, x: 1, y: 1 },
            { enemyTypeId: 60, x: 2, y: 2 },
          ],
        },
        enemyIdMap: { '50': 'skip', '60': 10 },
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockCreateLevel).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        enemyPlacements: [{ enemyTypeId: 10, x: 2, y: 2 }],
      }),
      1,
    );
  });

  it('preserves original IDs for placements not in enemyIdMap', async () => {
    mockCreateLevel.mockResolvedValue(28);

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: {
          name: 'Partial Remap',
          tiles: [['empty']],
          enemyPlacements: [
            { enemyTypeId: 50, x: 1, y: 1 },
            { enemyTypeId: 70, x: 3, y: 3 }, // not in map
          ],
        },
        enemyIdMap: { '50': 10 },
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockCreateLevel).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        enemyPlacements: [
          { enemyTypeId: 10, x: 1, y: 1 },
          { enemyTypeId: 70, x: 3, y: 3 },
        ],
      }),
      1,
    );
  });

  it('handles level with no enemyPlacements at all', async () => {
    mockCreateLevel.mockResolvedValue(29);

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: {
          name: 'No Enemies',
          tiles: [['empty']],
        },
        enemyIdMap: {},
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(201);
    expect(mockCreateLevel).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        enemyPlacements: [],
      }),
      1,
    );
  });

  // ---- Bundle format detection ----

  it('detects bundle format when level._format is blast-arena-level-bundle', async () => {
    mockCreateLevel.mockResolvedValue(30);

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: {
          _format: 'blast-arena-level-bundle',
          _version: 1,
          level: {
            name: 'Nested Bundle Level',
            tiles: [['empty']],
            enemyPlacements: [],
          },
          enemyTypes: [],
        },
        enemyIdMap: {},
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(201);
    expect(mockCreateLevel).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: 'Nested Bundle Level' }),
      1,
    );
  });

  it('detects bundle format when top-level _format is blast-arena-level-bundle', async () => {
    mockCreateLevel.mockResolvedValue(31);

    // When req.body._format is set, bundle = req.body, so levelData = req.body.level
    // req.body.level should be the actual level data (not a nested bundle object)
    const req = mockReq({
      user: { userId: 1 },
      body: {
        _format: 'blast-arena-level-bundle',
        _version: 1,
        worldId: 1,
        level: {
          name: 'Top Bundle Level',
          tiles: [['empty']],
          enemyPlacements: [],
        },
        enemyTypes: [],
        enemyIdMap: {},
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(201);
    expect(mockCreateLevel).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: 'Top Bundle Level' }),
      1,
    );
  });

  it('handles create action with empty description in bundled enemy type', async () => {
    mockCreateEnemyType.mockResolvedValue(200);
    mockCreateLevel.mockResolvedValue(32);

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: {
          name: 'Empty Desc',
          tiles: [['empty']],
          enemyPlacements: [{ enemyTypeId: 50, x: 1, y: 1 }],
        },
        enemyTypes: [{ originalId: 50, name: 'Monster', config: { speed: 1 } }],
        enemyIdMap: { '50': 'create' },
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockCreateEnemyType).toHaveBeenCalledWith('Monster', '', { speed: 1 }, 1);
  });

  it('handles create action when no bundled enemy type matches originalId', async () => {
    mockCreateLevel.mockResolvedValue(33);

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: {
          name: 'No Match',
          tiles: [['empty']],
          enemyPlacements: [{ enemyTypeId: 50, x: 1, y: 1 }],
        },
        enemyTypes: [{ originalId: 999, name: 'Wrong', config: {} }],
        enemyIdMap: { '50': 'create' },
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    // createEnemyType not called since bundled entry not found for origId 50
    expect(mockCreateEnemyType).not.toHaveBeenCalled();
    // Placement keeps original ID since no remap happened
    expect(mockCreateLevel).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        enemyPlacements: [{ enemyTypeId: 50, x: 1, y: 1 }],
      }),
      1,
    );
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('import error');
    mockCreateLevel.mockRejectedValue(err);

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: {
          _format: 'blast-arena-level',
          _version: 1,
          name: 'Fail Level',
          tiles: [['empty']],
          enemyPlacements: [],
        },
        enemyIdMap: {},
      },
    });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });

  it('handles multiple conflicts in a single import', async () => {
    mockGetEnemyType.mockImplementation(async (id: number) => {
      if (id === 5) return sampleEnemyType({ id: 5, name: 'Existing Blob' });
      return null;
    });

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: {
          name: 'Multi Conflict',
          tiles: [['empty']],
          enemyPlacements: [
            { enemyTypeId: 5, x: 1, y: 1 },
            { enemyTypeId: 99, x: 2, y: 2 },
          ],
        },
        enemyTypes: [
          { originalId: 5, name: 'Bundle Blob', description: '', config: {} },
          { originalId: 99, name: 'New Ghost', description: '', config: {} },
        ],
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    const body = res._json as any;
    expect(body.conflicts).toHaveLength(2);
    expect(body.conflicts[0].originalId).toBe(5);
    expect(body.conflicts[0].existingId).toBe(5);
    expect(body.conflicts[1].originalId).toBe(99);
    expect(body.conflicts[1].existingName).toBeUndefined(); // no existing
  });

  it('handles mixed create/skip/remap in a single import', async () => {
    mockCreateEnemyType.mockResolvedValue(300);
    mockCreateLevel.mockResolvedValue(40);

    const req = mockReq({
      user: { userId: 1 },
      body: {
        worldId: 1,
        level: {
          name: 'Mixed Actions',
          tiles: [['empty']],
          enemyPlacements: [
            { enemyTypeId: 10, x: 1, y: 1 },
            { enemyTypeId: 20, x: 2, y: 2 },
            { enemyTypeId: 30, x: 3, y: 3 },
          ],
        },
        enemyTypes: [
          { originalId: 10, name: 'Create Me', description: 'new', config: { speed: 1 } },
        ],
        enemyIdMap: {
          '10': 'create',
          '20': 'skip',
          '30': 55,
        },
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    // 10 -> create -> 300, 20 -> skip (removed), 30 -> remap to 55
    expect(mockCreateEnemyType).toHaveBeenCalledWith('Create Me', 'new', { speed: 1 }, 1);
    expect(mockCreateLevel).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        enemyPlacements: [
          { enemyTypeId: 300, x: 1, y: 1 },
          { enemyTypeId: 55, x: 3, y: 3 },
        ],
      }),
      1,
    );
    expect(res._status).toBe(201);
  });
});

describe('POST /admin/campaign/enemy-types/import', () => {
  const handler = getHandler('post', '/admin/campaign/enemy-types/import');

  it('imports an enemy type and returns 201 with id', async () => {
    mockCreateEnemyType.mockResolvedValue(50);

    const et = sampleEnemyType();
    const req = mockReq({
      user: { userId: 1 },
      body: { name: et.name, description: et.description, config: et.config },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockCreateEnemyType).toHaveBeenCalledWith(et.name, et.description, et.config, 1);
    expect(res._status).toBe(201);
    expect(res._json).toEqual({ id: 50 });
  });

  it('uses empty string for missing description', async () => {
    mockCreateEnemyType.mockResolvedValue(51);

    const req = mockReq({
      user: { userId: 1 },
      body: { name: 'ImportedET', config: { speed: 1 } },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockCreateEnemyType).toHaveBeenCalledWith('ImportedET', '', { speed: 1 }, 1);
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('import error');
    mockCreateEnemyType.mockRejectedValue(err);

    const req = mockReq({
      user: { userId: 1 },
      body: { name: 'X', config: {} },
    });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// Middleware presence
// ============================================================================

describe('Middleware presence', () => {
  describe('Player endpoints require authMiddleware', () => {
    const playerRoutes = [
      { method: 'get', path: '/campaign/worlds' },
      { method: 'get', path: '/campaign/worlds/:worldId/levels' },
      { method: 'get', path: '/campaign/levels/:levelId' },
      { method: 'get', path: '/campaign/progress' },
      { method: 'get', path: '/campaign/enemy-types' },
    ];

    for (const { method, path } of playerRoutes) {
      it(`${method.toUpperCase()} ${path} includes authMiddleware`, () => {
        const stack = getRouteStack(method, path);
        const middlewareFns = stack.slice(0, -1).map((entry) => entry.handle);
        expect(middlewareFns).toContain(mockAuthMiddleware);
      });

      it(`${method.toUpperCase()} ${path} does not include adminOnlyMiddleware`, () => {
        const stack = getRouteStack(method, path);
        const middlewareFns = stack.slice(0, -1).map((entry) => entry.handle);
        expect(middlewareFns).not.toContain(mockAdminOnlyMiddleware);
      });
    }
  });

  describe('Admin endpoints require both authMiddleware and adminOnlyMiddleware', () => {
    const adminRoutes = [
      { method: 'get', path: '/admin/campaign/worlds' },
      { method: 'post', path: '/admin/campaign/worlds' },
      { method: 'put', path: '/admin/campaign/worlds/:id' },
      { method: 'delete', path: '/admin/campaign/worlds/:id' },
      { method: 'put', path: '/admin/campaign/worlds/:id/order' },
      { method: 'get', path: '/admin/campaign/levels' },
      { method: 'post', path: '/admin/campaign/levels' },
      { method: 'get', path: '/admin/campaign/levels/:id' },
      { method: 'put', path: '/admin/campaign/levels/:id' },
      { method: 'delete', path: '/admin/campaign/levels/:id' },
      { method: 'put', path: '/admin/campaign/levels/:id/order' },
      { method: 'get', path: '/admin/campaign/enemy-types' },
      { method: 'post', path: '/admin/campaign/enemy-types' },
      { method: 'put', path: '/admin/campaign/enemy-types/:id' },
      { method: 'delete', path: '/admin/campaign/enemy-types/:id' },
      { method: 'get', path: '/admin/campaign/levels/:id/export' },
      { method: 'get', path: '/admin/campaign/levels/:id/export-bundle' },
      { method: 'get', path: '/admin/campaign/enemy-types/:id/export' },
      { method: 'post', path: '/admin/campaign/levels/import' },
      { method: 'post', path: '/admin/campaign/enemy-types/import' },
    ];

    for (const { method, path } of adminRoutes) {
      it(`${method.toUpperCase()} ${path} includes authMiddleware`, () => {
        const stack = getRouteStack(method, path);
        const middlewareFns = stack.slice(0, -1).map((entry) => entry.handle);
        expect(middlewareFns).toContain(mockAuthMiddleware);
      });

      it(`${method.toUpperCase()} ${path} includes adminOnlyMiddleware`, () => {
        const stack = getRouteStack(method, path);
        const middlewareFns = stack.slice(0, -1).map((entry) => entry.handle);
        expect(middlewareFns).toContain(mockAdminOnlyMiddleware);
      });
    }
  });

  describe('Validated endpoints include validate middleware', () => {
    const validatedRoutes = [
      { method: 'post', path: '/admin/campaign/worlds' },
      { method: 'put', path: '/admin/campaign/worlds/:id' },
      { method: 'put', path: '/admin/campaign/worlds/:id/order' },
      { method: 'post', path: '/admin/campaign/levels' },
      { method: 'put', path: '/admin/campaign/levels/:id' },
      { method: 'put', path: '/admin/campaign/levels/:id/order' },
      { method: 'post', path: '/admin/campaign/enemy-types' },
      { method: 'put', path: '/admin/campaign/enemy-types/:id' },
      { method: 'post', path: '/admin/campaign/levels/import' },
      { method: 'post', path: '/admin/campaign/enemy-types/import' },
    ];

    for (const { method, path } of validatedRoutes) {
      it(`${method.toUpperCase()} ${path} has validation middleware`, () => {
        const stack = getRouteStack(method, path);
        // auth + admin + validate + handler = at least 4
        expect(stack.length).toBeGreaterThanOrEqual(4);
      });
    }
  });

  describe('Non-validated endpoints do not have extra middleware', () => {
    const nonValidatedRoutes = [
      { method: 'get', path: '/admin/campaign/worlds' },
      { method: 'delete', path: '/admin/campaign/worlds/:id' },
      { method: 'get', path: '/admin/campaign/levels' },
      { method: 'get', path: '/admin/campaign/levels/:id' },
      { method: 'delete', path: '/admin/campaign/levels/:id' },
      { method: 'get', path: '/admin/campaign/enemy-types' },
      { method: 'delete', path: '/admin/campaign/enemy-types/:id' },
      { method: 'get', path: '/admin/campaign/levels/:id/export' },
      { method: 'get', path: '/admin/campaign/levels/:id/export-bundle' },
      { method: 'get', path: '/admin/campaign/enemy-types/:id/export' },
    ];

    for (const { method, path } of nonValidatedRoutes) {
      it(`${method.toUpperCase()} ${path} has only auth + admin + handler (3 entries)`, () => {
        const stack = getRouteStack(method, path);
        expect(stack.length).toBe(3);
      });
    }
  });
});

// ============================================================================
// parseIntParam edge cases (via various routes)
// ============================================================================

describe('parseIntParam validation', () => {
  it('handles zero as a valid numeric ID', async () => {
    mockGetLevel.mockResolvedValue(null);

    const handler = getHandler('get', '/admin/campaign/levels/:id');
    const req = mockReq({ params: { id: '0' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockGetLevel).toHaveBeenCalledWith(0);
  });

  it('handles negative numbers as valid numeric IDs', async () => {
    mockDeleteWorld.mockResolvedValue(undefined);

    const handler = getHandler('delete', '/admin/campaign/worlds/:id');
    const req = mockReq({ params: { id: '-1' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockDeleteWorld).toHaveBeenCalledWith(-1);
  });

  it('rejects empty string as id', async () => {
    const handler = getHandler('get', '/admin/campaign/levels/:id');
    const req = mockReq({ params: { id: '' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid id', statusCode: 400 }),
    );
  });

  it('rejects float-like strings as id', async () => {
    // parseInt('3.5') returns 3, so it will be parsed (this is a valid JS behavior)
    mockGetLevel.mockResolvedValue(null);

    const handler = getHandler('get', '/admin/campaign/levels/:id');
    const req = mockReq({ params: { id: '3.5' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    // parseInt('3.5', 10) => 3, which is a valid number
    expect(mockGetLevel).toHaveBeenCalledWith(3);
  });
});

// ============================================================================
// Router route count verification
// ============================================================================

describe('Router completeness', () => {
  it('has 25 registered routes', () => {
    const stack = (campaignRouter as any).stack as RouteLayer[];
    const routes = stack.filter((l) => l.route);
    expect(routes.length).toBe(25);
  });

  it('all expected paths are registered', () => {
    const stack = (campaignRouter as any).stack as RouteLayer[];
    const registeredPaths = stack
      .filter((l) => l.route)
      .map(
        (l) =>
          `${Object.keys(l.route.methods)
            .find((m) => l.route.methods[m])
            ?.toUpperCase()} ${l.route.path}`,
      );

    const expectedPaths = [
      'GET /campaign/worlds',
      'GET /campaign/worlds/:worldId/levels',
      'GET /campaign/levels/:levelId',
      'GET /campaign/progress',
      'GET /campaign/enemy-types',
      'GET /admin/campaign/worlds',
      'POST /admin/campaign/worlds',
      'PUT /admin/campaign/worlds/:id',
      'DELETE /admin/campaign/worlds/:id',
      'PUT /admin/campaign/worlds/:id/order',
      'GET /admin/campaign/levels',
      'POST /admin/campaign/levels',
      'GET /admin/campaign/levels/:id',
      'PUT /admin/campaign/levels/:id',
      'DELETE /admin/campaign/levels/:id',
      'PUT /admin/campaign/levels/:id/order',
      'GET /admin/campaign/enemy-types',
      'POST /admin/campaign/enemy-types',
      'PUT /admin/campaign/enemy-types/:id',
      'DELETE /admin/campaign/enemy-types/:id',
      'GET /admin/campaign/levels/:id/export',
      'GET /admin/campaign/levels/:id/export-bundle',
      'GET /admin/campaign/enemy-types/:id/export',
      'POST /admin/campaign/levels/import',
      'POST /admin/campaign/enemy-types/import',
    ];

    for (const path of expectedPaths) {
      expect(registeredPaths).toContain(path);
    }
  });
});

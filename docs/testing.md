# Testing

BlastArena has **1883 tests** across 59 test suites covering the full stack: game logic, backend services, API routes, middleware, utilities, and frontend.

| Stack | Framework | Suites | Tests |
|-------|-----------|--------|-------|
| Backend | Jest + ts-jest | 56 | 1841 |
| Frontend | Vitest + happy-dom | 3 | 42 |

## Running Tests

```bash
npm test                                                      # All workspaces
npx jest --config tests/backend/jest.config.ts                # Backend only (from project root)
cd frontend && npx vitest run                                 # Frontend only
npx jest --config tests/backend/jest.config.ts -- <file>      # Single backend file
npx jest --config tests/backend/jest.config.ts --watch        # Backend watch mode
cd frontend && npx vitest                                     # Frontend watch mode
```

## Test Configuration

**Backend** (`tests/backend/jest.config.ts`):
- Preset: `ts-jest` (TypeScript compilation via `ts-jest`)
- Environment: `node`
- Test match: `tests/backend/**/*.test.ts` + `tests/shared/**/*.test.ts`
- Module alias: `@blast-arena/shared` → `<rootDir>/shared/src`
- Diagnostic override: suppresses TS1378 (top-level await) false positives

**Frontend** (`frontend/vitest.config.ts`):
- Environment: `happy-dom` (lightweight DOM implementation)
- Test include: `tests/**/*.test.ts`
- Module alias: `@blast-arena/shared` → `<rootDir>/../shared/src`

## Test Organization

```
tests/
├── backend/
│   ├── game/           17 files — core game logic
│   ├── services/       20 files — business logic layer
│   ├── routes/          9 files — API endpoint handlers
│   ├── middleware/      4 files — auth, validation, rate limiting, errors
│   ├── simulation/      1 file  — batch bot simulation runner
│   ├── utils/           2 files — crypto, socket rate limiting
│   └── shared/          1 file  — XP math
└── shared/              2 files — grid utilities, validation (run by backend Jest)

frontend/tests/
├── utils/               1 file  — HTML escaping
├── game/                1 file  — Settings manager
└── shared/              1 file  — grid utilities
```

## Test Inventory

### Game Logic (17 files, 486 tests)

Core game mechanics — these test the server-authoritative game state directly without mocks.

| File | Tests | Coverage |
|------|-------|----------|
| `game/GameState.test.ts` | 75 | Full lifecycle, movement, bombs, explosions, power-ups, all 6 game modes |
| `game/CampaignGame.test.ts` | 66 | Map building, spawn fallback chains, enemy spawning, win/loss conditions |
| `game/Player.test.ts` | 62 | State management, movement cooldowns, power-up effects, shield, death, respawn |
| `game/EnemyAI.test.ts` | 52 | 5 movement patterns (wander, chase, patrol, guard, flee), pathfinding, boss behaviors |
| `game/Enemy.test.ts` | 51 | Movement, speed divisor formula, boss phases, type config parsing |
| `game/RoomManager.test.ts` | 35 | Room lifecycle, player connections, disconnect cleanup, state management |
| `game/Explosion.test.ts` | 29 | Propagation, timing, chain reactions, wall destruction, pierce interaction |
| `game/BotAI.test.ts` | 19 | BFS pathfinding, game phase system, stalemate breakers, bomb/pierce awareness |
| `game/PowerUp.test.ts` | 15 | All 8 power-up types, grid placement, removal mechanics |
| `game/GameRoom.test.ts` | 14 | Socket event handling, replay recording toggle, game over flow |
| `game/InputBuffer.test.ts` | 10 | Input queuing, sequence numbering, deduplication |
| `game/BattleRoyale.test.ts` | 8 | Zone shrinking mechanics, damage application |
| `game/CollisionSystem.test.ts` | 7 | Collision detection, tile occupancy checks |
| `game/Map.test.ts` | 7 | Map generation, tile types, indestructible wall grid pattern |
| `game/Bomb.test.ts` | 3 | Bomb creation, countdown timer, detonation |
| `game/GameLoop.test.ts` | 4 | Tick timing, game state progression, circuit breaker |
| `game/HazardTiles.test.ts` | 29 | All 10 hazard tile types, slowing effects, instant-kill tiles, conveyors, teleporters, ice sliding, spikes cycling, dark rift, collision walkability |

### Services (20 files, 692 tests)

Business logic layer — each service is tested with mocked database and Redis.

| File | Tests | Coverage |
|------|-------|----------|
| `services/email.test.ts` | 71 | SMTP config, send verification/reset/change/test emails, transporter caching, env vs DB config priority |
| `services/cosmetics.test.ts` | 67 | CRUD, equip/unequip, batch game fetch, default unlock, campaign star unlocks, getPlayerCosmeticsForGame |
| `services/campaign.test.ts` | 63 | Worlds/levels/enemies CRUD, reorder, next-level logic, JSON field mapping |
| `services/achievements.test.ts` | 49 | CRUD, all 4 condition types (cumulative/per-game/mode-specific/campaign), unlock + reward flow |
| `services/botai.test.ts` | 46 | Upload, compile, update, reupload, delete, registry lifecycle, source download |
| `services/elo.test.ts` | 44 | Expected score, K-factor scaling, FFA pairwise calc, team calc, processMatchElo, bot filtering |
| `services/admin.test.ts` | 41 | User CRUD, roles, deactivation, server stats, match history/detail, audit log, announcements |
| `services/leaderboard.test.ts` | 40 | Pagination, privacy filtering, getRankForElo with/without sub-tiers, public profile, user rank |
| `services/enemy-type.test.ts` | 39 | CRUD, bulk config fetch, JSON config parsing, isBoss extraction |
| `services/campaign-progress.test.ts` | 32 | User state, level progress, star calculation, attempt/completion recording |
| `services/replay.test.ts` | 32 | List/read/delete/placements, gzip decompression, file discovery on disk |
| `services/friends.test.ts` | 26 | Send/accept/decline/cancel/remove/block/unblock, getFriends with presence, isBlocked, search |
| `services/party.test.ts` | 24 | Create/join/leave/kick/disband, Lua script atomic join, invite CRUD |
| `services/botai-sandbox.test.ts` | 22 | Source scan, global access blocking, vm sandbox, import blocking, eval/Function blocking |
| `services/season.test.ts` | 21 | CRUD, activate/deactivate, end with hard/soft reset, user history |
| `services/auth.test.ts` | 20 | Register, login, refresh, logout, verify email, forgot/reset password, atomic reset |
| `services/lobby.test.ts` | 17 | Room CRUD via Redis, join (atomic Lua), leave, ready toggle, teams |
| `services/user.test.ts` | 16 | Profile CRUD, username/email/password changes, admin bypass |
| `services/settings.test.ts` | 13 | Get/set/defaults, registration toggle, chat mode settings |
| `services/presence.test.ts` | 9 | Set/get/getBatch (MGET pipeline), remove, refresh TTL |

### Routes / API (9 files, 486 tests)

HTTP endpoint tests — Express route handlers tested with mocked services and pass-through middleware.

| File | Tests | Coverage |
|------|-------|----------|
| `routes/admin.test.ts` | 191 | Users, matches, rooms, audit log, announcements, simulations, bot-ai, replays, settings, chat modes, staff vs admin middleware |
| `routes/campaign.test.ts` | 177 | Worlds/levels/enemies CRUD, reorder, progress, import/export with conflict resolution |
| `routes/auth.test.ts` | 26 | Register, login, logout, refresh, verify email, forgot/reset password, cookie handling |
| `routes/user.test.ts` | 24 | Profile CRUD, email change (admin bypass), password validation, confirm-email public endpoint |
| `routes/leaderboard.test.ts` | 21 | Leaderboard pagination, rank tiers/seasons, public profile, user rank with level/XP |
| `routes/cosmetics.test.ts` | 20 | All cosmetics list, user cosmetics/equipped, equip endpoint, achievement progress |
| `routes/lobby.test.ts` | 12 | Room list/create, user mapping, team assignment, middleware presence |
| `routes/friends.test.ts` | 9 | Friends list, blocked users, search with presence, middleware checks |
| `routes/health.test.ts` | 6 | Health check endpoint, response format |

### Middleware (4 files, 36 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `middleware/auth-and-admin.test.ts` | 13 | JWT verification, admin/moderator role checks, staff middleware |
| `middleware/rateLimiter.test.ts` | 9 | Redis-backed rate limiting, in-memory fallback, per-IP tracking |
| `middleware/validation.test.ts` | 8 | Zod schema validation, field-level error details |
| `middleware/errorHandler.test.ts` | 6 | Error response formatting, HTTP status codes, AppError handling |

### Simulation (1 file, 69 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `simulation/SimulationManager.test.ts` | 69 | Batch lifecycle, queue management (max 10), getHistory pagination, disk scanning, batch results/deletion |

### Utilities & Shared (5 files, 72 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `shared/xp.test.ts` | 29 | XP calculation, level-from-XP math, level-for-XP inverse, placement bonuses, multiplier |
| `utils/socketRateLimit.test.ts` | 12 | Sliding window per-socket, parallel per-IP rate limiters |
| `../tests/shared/validation.test.ts` | 12 | Username, password, email, room name validation rules |
| `../tests/shared/grid.test.ts` | 11 | Grid coordinate conversions, explosion cell calculation |
| `utils/crypto.test.ts` | 8 | Password hashing/comparison, token generation |

### Frontend (3 files, 42 tests)

| File | Tests | Framework | Coverage |
|------|-------|-----------|----------|
| `tests/shared/grid.test.ts` | 21 | Vitest | posToTile, tileToPos, getExplosionCells, manhattanDistance, isInBounds |
| `tests/utils/html.test.ts` | 12 | Vitest | escapeHtml, escapeAttr — XSS prevention |
| `tests/game/Settings.test.ts` | 9 | Vitest | localStorage cache, defaults, merge behavior, updateSetting |

## Mocking Patterns

### 1. Database Mocking

All service tests mock the database connection module. Mocks must be declared **before** importing the module under test (Jest hoists `jest.mock()` calls but the mock factory runs at import time).

```typescript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();

jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
  withTransaction: jest.fn<AnyFn>((fn: any) => fn({ query: mockQuery, execute: mockExecute })),
}));

// NOW import the service under test
import { someFunction } from '../../../backend/src/services/someService';

beforeEach(() => {
  jest.clearAllMocks();
});

it('queries the database', async () => {
  mockQuery.mockResolvedValueOnce([{ id: 1, name: 'test' }]);
  const result = await someFunction();
  expect(mockQuery).toHaveBeenCalledWith('SELECT ...', [expectedArgs]);
  expect(result).toEqual({ id: 1, name: 'test' });
});
```

### 2. Redis Mocking

Services that use Redis (lobby, presence, party) use an in-memory `Map` to simulate Redis operations:

```typescript
const store = new Map<string, string>();
const mockRedis = {
  get: jest.fn<AnyFn>((key: string) => Promise.resolve(store.get(key) || null)),
  set: jest.fn<AnyFn>((...args: unknown[]) => {
    store.set(args[0] as string, args[1] as string);
    return Promise.resolve('OK');
  }),
  del: jest.fn<AnyFn>((key: string) => { store.delete(key); return Promise.resolve(1); }),
  scan: jest.fn<AnyFn>((_cursor, _matchKw, pattern) => {
    const prefix = pattern.replace('*', '');
    const matched = [...store.keys()].filter(k => k.startsWith(prefix));
    return Promise.resolve(['0', matched]);
  }),
  mget: jest.fn<AnyFn>((...keys: string[]) =>
    Promise.resolve(keys.map(k => store.get(k) || null))
  ),
  eval: jest.fn<AnyFn>(),
};

jest.mock('../../../backend/src/db/redis', () => ({
  getRedis: () => mockRedis,
}));
```

### 3. Service Mocking (for Route Tests)

Route tests mock entire service modules to isolate HTTP handler logic:

```typescript
const mockCreateRoom = jest.fn<AnyFn>();
const mockListRooms = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/lobby', () => ({
  createRoom: mockCreateRoom,
  listRooms: mockListRooms,
}));
```

### 4. Middleware Pass-Through

Route tests skip auth/validation to test handler logic in isolation:

```typescript
jest.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: jest.fn((_req: any, _res: any, next: any) => {
    _req.user = { userId: 1, username: 'testuser', role: 'admin' };
    next();
  }),
}));

jest.mock('../../../backend/src/middleware/admin', () => ({
  staffMiddleware: jest.fn((_req: any, _res: any, next: any) => next()),
  adminOnlyMiddleware: jest.fn((_req: any, _res: any, next: any) => next()),
}));
```

### 5. Route Handler Extraction

Route tests extract Express handlers from the router stack rather than using supertest:

```typescript
import router from '../../../backend/src/routes/lobby';

// Extract the handler for a specific route
function findHandler(method: string, path: string) {
  for (const layer of (router as any).stack) {
    if (layer.route?.path === path && layer.route.methods[method]) {
      const handlers = layer.route.stack.map((s: any) => s.handle);
      return handlers[handlers.length - 1]; // last handler (after middleware)
    }
  }
  throw new Error(`Handler not found: ${method} ${path}`);
}

// Create mock request/response
function mockReqRes(body = {}, params = {}, query = {}) {
  const req: any = { body, params, query, user: { userId: 1 } };
  const res: any = {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}
```

## Writing New Tests

### File Naming
Place tests in the matching category directory:
```
tests/backend/services/myNewService.test.ts
tests/backend/routes/myNewRoute.test.ts
tests/backend/game/MyNewGameFeature.test.ts
```

### Template for a Service Test

```typescript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

// 1. Declare mocks BEFORE imports
const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();

jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
}));

// 2. Mock any other dependencies
jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

// 3. Import the module under test AFTER mocks
import { myFunction } from '../../../backend/src/services/myService';

// 4. Reset mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
});

describe('myFunction', () => {
  it('returns expected result', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 1 }]);
    const result = await myFunction(1);
    expect(result).toEqual({ id: 1 });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('throws on not found', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await expect(myFunction(999)).rejects.toThrow('Not found');
  });
});
```

### Template for a Route Test

```typescript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

// Mock services
const mockGetItems = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/myService', () => ({
  getItems: mockGetItems,
}));

// Pass-through middleware
jest.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: jest.fn((_req: any, _res: any, next: any) => {
    _req.user = { userId: 1, username: 'test', role: 'user' };
    next();
  }),
}));

import router from '../../../backend/src/routes/myRoute';

// Helper to extract handler and create mock req/res
// ... (see Route Handler Extraction pattern above)

beforeEach(() => jest.clearAllMocks());

describe('GET /my-route', () => {
  it('returns items', async () => {
    mockGetItems.mockResolvedValueOnce([{ id: 1 }]);
    const { req, res, next } = mockReqRes();
    await findHandler('get', '/my-route')(req, res, next);
    expect(res.json).toHaveBeenCalledWith({ items: [{ id: 1 }] });
  });
});
```

### Game Logic Tests

Game tests typically instantiate real `GameStateManager` objects rather than mocking:

```typescript
import { GameStateManager } from '../../../backend/src/game/GameState';

function createTestGame(overrides = {}) {
  return new GameStateManager({
    mapWidth: 15, mapHeight: 13, mapSeed: 42,
    gameMode: 'ffa', maxPlayers: 4, roundTime: 180,
    wallDensity: 0.3, powerUpDropRate: 0.3,
    enabledPowerUps: ['bomb_up', 'fire_up', 'speed_up'],
    ...overrides,
  });
}

it('player moves correctly', () => {
  const gs = createTestGame();
  gs.addPlayer(1, 'player1');
  gs.processInput(1, { type: 'move', direction: 'right' });
  // Process enough ticks for movement cooldown
  for (let i = 0; i < 6; i++) gs.processTick();
  const player = gs.players.get(1)!;
  expect(player.x).toBe(2);
});
```

## Frontend Testing

Frontend tests use Vitest with `happy-dom` for DOM APIs. Most tests cover pure utility functions that don't need DOM mocking.

```typescript
import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../../src/utils/html';

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });
});
```

For stateful modules (like Settings), use `vi.resetModules()`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

it('loads defaults when no stored settings', async () => {
  const { Settings } = await import('../../src/game/Settings');
  const settings = new Settings();
  expect(settings.get('animations')).toBe(true);
});
```

# Testing

BlastArena has **2379 tests** across 78 test suites covering the full stack: game logic, backend services, API routes, socket handlers, middleware, utilities, and frontend.

| Stack | Framework | Suites | Tests |
|-------|-----------|--------|-------|
| Backend | Jest + ts-jest | 75 | 2337 |
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
│   ├── services/       28 files — business logic layer
│   ├── routes/         12 files — API endpoint handlers
│   ├── handlers/        4 files — Socket.io event handlers
│   ├── middleware/      6 files — auth, validation, rate limiting, errors, email, locale
│   ├── simulation/      1 file  — batch bot simulation runner
│   ├── utils/           2 files — crypto, socket rate limiting
│   └── shared/          1 file  — XP math
└── shared/              4 files — grid utilities, validation, map validation, puzzle (run by backend Jest)

frontend/tests/
├── utils/               1 file  — HTML escaping
├── game/                1 file  — Settings manager
└── shared/              1 file  — grid utilities
```

## Test Inventory

### Game Logic (17 files, 593 tests)

Core game mechanics — these test the server-authoritative game state directly without mocks.

| File | Tests | Coverage |
|------|-------|----------|
| `game/GameState.test.ts` | 100 | Full lifecycle, movement, bombs, explosions, power-ups, all 6 game modes, conveyors, teleporters, KOTH, deathmatch, remote/pierce/line bombs, bomb throw/kick, shield, self-kill |
| `game/Player.test.ts` | 87 | State management, movement cooldowns, all 9 power-up effects, shield, death, respawn, buddy mode, remote detonation, frozen state, cosmetics |
| `game/CampaignGame.test.ts` | 76 | Map building, spawn fallback chains, enemy spawning, win/loss, buddy mode, hazard tiles, boss enemies, puzzle tiles, covered tiles |
| `game/EnemyAI.test.ts` | 52 | 5 movement patterns (wander, chase, patrol, guard, flee), pathfinding, boss behaviors |
| `game/Enemy.test.ts` | 51 | Movement, speed divisor formula, boss phases, type config parsing |
| `game/RoomManager.test.ts` | 35 | Room lifecycle, player connections, disconnect cleanup, state management |
| `game/Explosion.test.ts` | 29 | Propagation, timing, chain reactions, wall destruction, pierce interaction |
| `game/HazardTiles.test.ts` | 29 | All 10 hazard tile types, slowing effects, instant-kill tiles, conveyors, teleporters, ice sliding, spikes cycling, dark rift, collision walkability |
| `game/BotAI.test.ts` | 27 | BFS pathfinding, game phase system, stalemate breakers, bomb/pierce awareness, danger awareness, power-up seeking, aggression by difficulty |
| `game/CollisionSystem.test.ts` | 24 | All walkable/non-walkable special tiles, reinforced walls, vine destruction, canBuddyMoveTo, out-of-bounds |
| `game/PowerUp.test.ts` | 15 | All 8 power-up types, grid placement, removal mechanics |
| `game/Map.test.ts` | 15 | Map generation, tile types, indestructible wall grid pattern, min/max sizes, wallDensity, hazard placement |
| `game/GameRoom.test.ts` | 14 | Socket event handling, replay recording toggle, game over flow |
| `game/Bomb.test.ts` | 13 | Bomb creation, countdown, detonation, remote/pierce types, REMOTE_BOMB_MAX_TIMER, sliding, toState() |
| `game/InputBuffer.test.ts` | 10 | Input queuing, sequence numbering, deduplication |
| `game/BattleRoyale.test.ts` | 14 | Zone shrinking, damage, boundary edge cases, center stability, asymmetric maps, toState() |
| `game/GameLoop.test.ts` | 10 | Tick timing, game state progression, circuit breaker, double-start, onGameOver, setTickRate |

### Services (28 files, 854 tests)

Business logic layer — each service is tested with mocked database and Redis.

| File | Tests | Coverage |
|------|-------|----------|
| `services/email.test.ts` | 71 | SMTP config, send verification/reset/change/test emails, transporter caching, env vs DB config priority |
| `services/cosmetics.test.ts` | 67 | CRUD, equip/unequip, batch game fetch, default unlock, campaign star unlocks, getPlayerCosmeticsForGame |
| `services/campaign.test.ts` | 63 | Worlds/levels/enemies CRUD, reorder, next-level logic, JSON field mapping |
| `services/achievements.test.ts` | 49 | CRUD, all 4 condition types (cumulative/per-game/mode-specific/campaign), unlock + reward flow |
| `services/botai.test.ts` | 46 | Upload, compile, update, reupload, delete, registry lifecycle, source download |
| `services/elo.test.ts` | 44 | Expected score, K-factor scaling, FFA pairwise calc, team calc, processMatchElo, bot filtering |
| `services/enemyai.test.ts` | 41 | Full CRUD, file upload/download, compilation on upload, registry load/unload on activate/deactivate, audit logging |
| `services/admin.test.ts` | 41 | User CRUD, roles, deactivation, server stats, match history/detail, audit log, announcements |
| `services/leaderboard.test.ts` | 40 | Pagination, privacy filtering, getRankForElo with/without sub-tiers, public profile, user rank |
| `services/enemy-type.test.ts` | 39 | CRUD, bulk config fetch, JSON config parsing, isBoss extraction |
| `services/campaign-progress.test.ts` | 32 | User state, level progress, star calculation, attempt/completion recording |
| `services/replay.test.ts` | 32 | List/read/delete/placements, gzip decompression, file discovery on disk |
| `services/friends.test.ts` | 26 | Send/accept/decline/cancel/remove/block/unblock, getFriends with presence, isBlocked, search |
| `services/custom-maps.test.ts` | 25 | Full CRUD, JSON parsing with safeJsonParse fallback, snake_case→camelCase mapping, ownership enforcement |
| `services/party.test.ts` | 24 | Create/join/leave/kick/disband, Lua script atomic join, invite CRUD |
| `services/messages.test.ts` | 22 | sendMessage (friendship/block checks, truncation), getConversation (pagination), markRead, getUnreadCounts |
| `services/botai-sandbox.test.ts` | 22 | Source scan, global access blocking, vm sandbox, import blocking, eval/Function blocking |
| `services/season.test.ts` | 21 | CRUD, activate/deactivate, end with hard/soft reset, user history |
| `services/auth.test.ts` | 20 | Register, login, refresh, logout, verify email, forgot/reset password, atomic reset |
| `services/botai-registry.test.ts` | 18 | Built-in always registered, fallback to built-in, createInstance, cannot unload built-in |
| `services/lobby.test.ts` | 17 | Room CRUD via Redis, join (atomic Lua), leave, ready toggle, teams |
| `services/botai-compiler.test.ts` | 16 | scanAndBuildAI (file size, esbuild errors), compileBotAI (class finding, method validation), sandbox execution |
| `services/user.test.ts` | 16 | Profile CRUD, username/email/password changes, admin bypass |
| `services/enemyai-registry.test.ts` | 14 | Initialize, loadAI (sandbox + class finding), createInstance, unload/reload |
| `services/settings.test.ts` | 13 | Get/set/defaults, registration toggle, chat mode settings |
| `services/enemyai-compiler.test.ts` | 12 | compileEnemyAI with decide() validation, DUMMY_TYPE_CONFIG, export patterns |
| `services/presence.test.ts` | 9 | Set/get/getBatch (MGET pipeline), remove, refresh TTL |
| `services/buddy.test.ts` | 8 | getBuddySettings defaults, saveBuddySettings UPSERT with partial merge |

### Routes / API (12 files, 537 tests)

HTTP endpoint tests — Express route handlers tested with mocked services and pass-through middleware.

| File | Tests | Coverage |
|------|-------|----------|
| `routes/admin.test.ts` | 191 | Users, matches, rooms, audit log, announcements, simulations, bot-ai, replays, settings, chat modes, staff vs admin middleware |
| `routes/campaign.test.ts` | 177 | Worlds/levels/enemies CRUD, reorder, progress, import/export with conflict resolution |
| `routes/auth.test.ts` | 26 | Register, login, logout, refresh, verify email, forgot/reset password, cookie handling |
| `routes/user.test.ts` | 24 | Profile CRUD, email change (admin bypass), password validation, confirm-email public endpoint |
| `routes/custom-maps.test.ts` | 23 | CRUD endpoints, validateCustomMap integration, Zod schema enforcement, ownership checks |
| `routes/leaderboard.test.ts` | 21 | Leaderboard pagination, rank tiers/seasons, public profile, user rank with level/XP |
| `routes/cosmetics.test.ts` | 20 | All cosmetics list, user cosmetics/equipped, equip endpoint, achievement progress |
| `routes/messages.test.ts` | 16 | Conversation list, unread counts, paginated history, mark read, limit cap at 50 |
| `routes/docs.test.ts` | 12 | Public/staff doc serving, path traversal prevention, whitelist enforcement, middleware presence |
| `routes/lobby.test.ts` | 12 | Room list/create, user mapping, team assignment, middleware presence |
| `routes/friends.test.ts` | 9 | Friends list, blocked users, search with presence, middleware checks |
| `routes/health.test.ts` | 6 | Health check endpoint, response format |

### Socket Handlers (4 files, 62 tests)

Socket.io event handler tests — handlers tested with mock socket/io objects and captured callback invocations.

| File | Tests | Coverage |
|------|-------|----------|
| `handlers/partyHandlers.test.ts` | 22 | Party lifecycle (create/invite/accept/decline/leave/kick/chat), room invites, disconnect cleanup |
| `handlers/friendHandlers.test.ts` | 18 | All 8 socket events, notifyFriendsOnline/Offline, dual rate limiters |
| `handlers/dmHandlers.test.ts` | 12 | dm:send (mode checks, sendMessage, dm:receive emission), dm:read (mark read, read receipt) |
| `handlers/lobbyHandlers.test.ts` | 10 | Chat mode enforcement (disabled/admin_only/staff), message truncation, rate limiting |

### Middleware (6 files, 55 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `middleware/auth-and-admin.test.ts` | 13 | JWT verification, admin/moderator role checks, staff middleware |
| `middleware/emailVerified.test.ts` | 11 | 401/403/500 paths, DB query verification, next() never called on error |
| `middleware/rateLimiter.test.ts` | 9 | Redis-backed rate limiting, in-memory fallback, per-IP tracking |
| `middleware/locale.test.ts` | 8 | x-language priority, accept-language fallback, base language extraction, default 'en' |
| `middleware/validation.test.ts` | 8 | Zod schema validation, field-level error details |
| `middleware/errorHandler.test.ts` | 6 | Error response formatting, HTTP status codes, AppError handling |

### Simulation (1 file, 69 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `simulation/SimulationManager.test.ts` | 69 | Batch lifecycle, queue management (max 10), getHistory pagination, disk scanning, batch results/deletion |

### Utilities & Shared (7 files, 165 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `../tests/shared/puzzle.test.ts` | 75 | All switch/gate helpers (4 colors), color extraction, round-trip construction, isPuzzleTile, constants |
| `shared/xp.test.ts` | 29 | XP calculation, level-from-XP math, level-for-XP inverse, placement bonuses, multiplier |
| `../tests/shared/mapValidation.test.ts` | 18 | Dimension validation, odd enforcement, border walls, spawn counts, teleporter pairing |
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

### 6. Socket Handler Mocking

Socket handler tests use mock socket/io objects with handler capture via `socket.on()`:

```typescript
function createMockSocket(overrides: Record<string, unknown> = {}) {
  const handlers: Record<string, AnyFn> = {};
  return {
    id: 'socket-1',
    data: { userId: 1, username: 'testuser', role: 'user', ...overrides },
    on: jest.fn((event: string, handler: AnyFn) => { handlers[event] = handler; }),
    join: jest.fn(),
    leave: jest.fn(),
    _handlers: handlers,  // access captured handlers for direct invocation
  };
}

function createMockIO() {
  const emitFn = jest.fn();
  return {
    emit: jest.fn(),
    to: jest.fn().mockReturnValue({ emit: emitFn }),
    in: jest.fn().mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([]) }),
    _emitFn: emitFn,
  };
}

// Register handlers, then invoke directly:
registerHandlers(io as any, socket as any);
await socket._handlers['event:name'](data, callback);
```

## Writing New Tests

### File Naming
Place tests in the matching category directory:
```
tests/backend/services/myNewService.test.ts
tests/backend/routes/myNewRoute.test.ts
tests/backend/handlers/myNewHandler.test.ts
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

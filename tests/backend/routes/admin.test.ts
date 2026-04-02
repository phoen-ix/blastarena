import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

// ---------------------------------------------------------------------------
// Mocks — declared before the router import so module-level side effects
// in admin.ts see the fakes.
// ---------------------------------------------------------------------------

// --- adminService ---
const mockCreateUser = jest.fn<AnyFn>();
const mockListUsers = jest.fn<AnyFn>();
const mockChangeUserRole = jest.fn<AnyFn>();
const mockDeactivateUser = jest.fn<AnyFn>();
const mockDeleteUser = jest.fn<AnyFn>();
const mockResetUserPassword = jest.fn<AnyFn>();
const mockGetServerStats = jest.fn<AnyFn>();
const mockGetMatchHistory = jest.fn<AnyFn>();
const mockGetMatchDetail = jest.fn<AnyFn>();
const mockGetAdminActions = jest.fn<AnyFn>();
const mockGetActiveRooms = jest.fn<AnyFn>();
const mockSendToast = jest.fn<AnyFn>();
const mockSetBanner = jest.fn<AnyFn>();
const mockClearBanner = jest.fn<AnyFn>();
const mockGetActiveBanner = jest.fn<AnyFn>();
const mockPreviewCleanup = jest.fn<AnyFn>();
const mockExecuteCleanup = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/admin', () => ({
  createUser: mockCreateUser,
  listUsers: mockListUsers,
  changeUserRole: mockChangeUserRole,
  deactivateUser: mockDeactivateUser,
  deleteUser: mockDeleteUser,
  resetUserPassword: mockResetUserPassword,
  getServerStats: mockGetServerStats,
  getMatchHistory: mockGetMatchHistory,
  getMatchDetail: mockGetMatchDetail,
  getAdminActions: mockGetAdminActions,
  getActiveRooms: mockGetActiveRooms,
  sendToast: mockSendToast,
  setBanner: mockSetBanner,
  clearBanner: mockClearBanner,
  getActiveBanner: mockGetActiveBanner,
  previewCleanup: mockPreviewCleanup,
  executeCleanup: mockExecuteCleanup,
}));

// --- replayService ---
const mockListReplays = jest.fn<AnyFn>();
const mockGetReplay = jest.fn<AnyFn>();
const mockDeleteReplay = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/replay', () => ({
  listReplays: mockListReplays,
  getReplay: mockGetReplay,
  deleteReplay: mockDeleteReplay,
}));

// --- settingsService ---
const mockIsRegistrationEnabled = jest.fn<AnyFn>();
const mockIsRecordingEnabled = jest.fn<AnyFn>();
const mockGetGameDefaults = jest.fn<AnyFn>();
const mockSetGameDefaults = jest.fn<AnyFn>();
const mockGetSimulationDefaults = jest.fn<AnyFn>();
const mockSetSimulationDefaults = jest.fn<AnyFn>();
const mockSetSetting = jest.fn<AnyFn>();
const mockGetEmailSettings = jest.fn<AnyFn>();
const mockSetEmailSettings = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/settings', () => ({
  isRegistrationEnabled: mockIsRegistrationEnabled,
  isRecordingEnabled: mockIsRecordingEnabled,
  getGameDefaults: mockGetGameDefaults,
  setGameDefaults: mockSetGameDefaults,
  getSimulationDefaults: mockGetSimulationDefaults,
  setSimulationDefaults: mockSetSimulationDefaults,
  setSetting: mockSetSetting,
  getEmailSettings: mockGetEmailSettings,
  setEmailSettings: mockSetEmailSettings,
}));

// --- botaiService ---
const mockListAllAIs = jest.fn<AnyFn>();
const mockListActiveAIs = jest.fn<AnyFn>();
const mockUploadAI = jest.fn<AnyFn>();
const mockUpdateAI = jest.fn<AnyFn>();
const mockReuploadAI = jest.fn<AnyFn>();
const mockDownloadSource = jest.fn<AnyFn>();
const mockDeleteAI = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/botai', () => ({
  listAllAIs: mockListAllAIs,
  listActiveAIs: mockListActiveAIs,
  uploadAI: mockUploadAI,
  updateAI: mockUpdateAI,
  reuploadAI: mockReuploadAI,
  downloadSource: mockDownloadSource,
  deleteAI: mockDeleteAI,
}));

// --- email service ---
const mockInvalidateTransporter = jest.fn<AnyFn>();
const mockSendTestEmail = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/email', () => ({
  invalidateTransporter: mockInvalidateTransporter,
  sendTestEmail: mockSendTestEmail,
}));

// --- registry ---
const mockGetHistory = jest.fn<AnyFn>();
const mockGetBatchResults = jest.fn<AnyFn>();
const mockGetSimulationReplay = jest.fn<AnyFn>();
const mockStartBatch = jest.fn<AnyFn>();
const mockCancelBatch = jest.fn<AnyFn>();
const mockDeleteBatch = jest.fn<AnyFn>();

const mockSimulationManager = {
  getHistory: mockGetHistory,
  getBatchResults: mockGetBatchResults,
  getSimulationReplay: mockGetSimulationReplay,
  startBatch: mockStartBatch,
  cancelBatch: mockCancelBatch,
  deleteBatch: mockDeleteBatch,
};

const mockIOEmit = jest.fn<AnyFn>();
const mockIO = { emit: mockIOEmit, to: jest.fn<AnyFn>().mockReturnValue({ emit: mockIOEmit }) };

jest.mock('../../../backend/src/game/registry', () => ({
  getSimulationManager: () => mockSimulationManager,
  getIO: () => mockIO,
}));

// --- db connection ---
const mockExecute = jest.fn<AnyFn>();

jest.mock('../../../backend/src/db/connection', () => ({
  execute: mockExecute,
}));

// --- config ---
const mockGetConfig = jest.fn<AnyFn>();

jest.mock('../../../backend/src/config', () => ({
  getConfig: mockGetConfig,
}));

// --- Middleware pass-throughs ---
const mockAuthMiddleware = jest.fn<AnyFn>((_req, _res, next) => next());
const mockStaffMiddleware = jest.fn<AnyFn>((_req, _res, next) => next());
const mockAdminOnlyMiddleware = jest.fn<AnyFn>((_req, _res, next) => next());

jest.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: mockAuthMiddleware,
}));

jest.mock('../../../backend/src/middleware/admin', () => ({
  staffMiddleware: mockStaffMiddleware,
  adminOnlyMiddleware: mockAdminOnlyMiddleware,
}));

const mockValidate = jest.fn<AnyFn>(() => (_req: any, _res: any, next: any) => next());

jest.mock('../../../backend/src/middleware/validation', () => ({
  validate: mockValidate,
}));

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

// Mock multer to just pass through, injecting req.file when present
jest.mock('multer', () => {
  const multerFn = () => ({
    single: () => (req: any, _res: any, next: any) => next(),
  });
  multerFn.memoryStorage = () => ({});
  return { __esModule: true, default: multerFn };
});

// ---------------------------------------------------------------------------
// Import the router under test (after all mocks are in place).
// ---------------------------------------------------------------------------

import adminRouter from '../../../backend/src/routes/admin';
import { adminOnlyMiddleware } from '../../../backend/src/middleware/admin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: Function; name?: string }>;
  };
  name?: string;
  handle?: Function;
};

/**
 * Extract the final handler (the actual route logic, after middleware) from
 * an Express Router for a given method + path.
 */
function getHandler(method: string, path: string) {
  const stack = (adminRouter as any).stack as RouteLayer[];
  const layer = stack.find((l) => l.route?.path === path && l.route!.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found in router`);
  const routeStack = layer.route!.stack;
  return routeStack[routeStack.length - 1].handle;
}

/** Return the full route stack (middleware + handler) for a method+path. */
function getRouteStack(method: string, path: string) {
  const stack = (adminRouter as any).stack as RouteLayer[];
  const layer = stack.find((l) => l.route?.path === path && l.route!.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found in router`);
  return layer.route!.stack;
}

/** Check if a route has adminOnlyMiddleware in its inline stack. */
function hasAdminOnly(method: string, path: string): boolean {
  const routeStack = getRouteStack(method, path);
  return routeStack.some((entry) => entry.handle === mockAdminOnlyMiddleware);
}

function mockRes() {
  const data: {
    _status: number;
    _json: unknown;
    _headers: Record<string, string>;
    _sent: unknown;
  } = { _status: 200, _json: null, _headers: {}, _sent: null };

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
    get _sent() {
      return data._sent;
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
    send(body: unknown) {
      data._sent = body;
      return res;
    },
  };
  return res;
}

function mockReq(overrides: Record<string, unknown> = {}): any {
  return {
    user: { userId: 1, username: 'admin', role: 'admin' },
    body: {},
    params: {},
    query: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockGetConfig.mockReturnValue({
    APP_URL: 'http://localhost:8080',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: 587,
    SMTP_USER: 'user@example.com',
    SMTP_PASSWORD: 'envpass',
    SMTP_FROM_EMAIL: 'noreply@example.com',
    SMTP_FROM_NAME: 'BlastArena',
  });
  mockExecute.mockResolvedValue({ insertId: 0, affectedRows: 0 });
});

// ============================================================================
// PUBLIC ROUTES (no auth/staff middleware)
// ============================================================================

describe('GET /admin/settings/registration_enabled (public)', () => {
  const handler = getHandler('get', '/admin/settings/registration_enabled');

  it('returns { enabled: true } when registration is enabled', async () => {
    mockIsRegistrationEnabled.mockResolvedValue(true);
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual({ enabled: true });
  });

  it('returns { enabled: false } when registration is disabled', async () => {
    mockIsRegistrationEnabled.mockResolvedValue(false);
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual({ enabled: false });
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockIsRegistrationEnabled.mockRejectedValue(err);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('GET /admin/settings/recordings_enabled (public)', () => {
  const handler = getHandler('get', '/admin/settings/recordings_enabled');

  it('returns { enabled: true } when recording is enabled', async () => {
    mockIsRecordingEnabled.mockResolvedValue(true);
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual({ enabled: true });
  });

  it('returns { enabled: false } when recording is disabled', async () => {
    mockIsRecordingEnabled.mockResolvedValue(false);
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual({ enabled: false });
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockIsRecordingEnabled.mockRejectedValue(err);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('GET /admin/settings/game_defaults (public)', () => {
  const handler = getHandler('get', '/admin/settings/game_defaults');

  it('returns game defaults', async () => {
    const defaults = { gameMode: 'ffa', maxPlayers: 4 };
    mockGetGameDefaults.mockResolvedValue(defaults);
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual({ defaults });
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockGetGameDefaults.mockRejectedValue(err);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('GET /admin/ai/active (public)', () => {
  const handler = getHandler('get', '/admin/ai/active');

  it('returns active AIs', async () => {
    const ais = [{ id: '1', name: 'TestAI', isActive: true }];
    mockListActiveAIs.mockResolvedValue(ais);
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual({ ais });
  });

  it('returns empty array when no active AIs', async () => {
    mockListActiveAIs.mockResolvedValue([]);
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual({ ais: [] });
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockListActiveAIs.mockRejectedValue(err);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('GET /admin/announcements/banner (public)', () => {
  const handler = getHandler('get', '/admin/announcements/banner');

  it('returns active banner data', async () => {
    const banner = { active: true, message: 'Maintenance soon' };
    mockGetActiveBanner.mockResolvedValue(banner);
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual(banner);
  });

  it('returns null/empty when no banner active', async () => {
    mockGetActiveBanner.mockResolvedValue({ active: false, message: null });
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual({ active: false, message: null });
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockGetActiveBanner.mockRejectedValue(err);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// SETTINGS ROUTES (staff + admin-only)
// ============================================================================

describe('PUT /admin/settings/registration_enabled', () => {
  const handler = getHandler('put', '/admin/settings/registration_enabled');

  it('updates setting and returns success message', async () => {
    mockSetSetting.mockResolvedValue(undefined);
    const req = mockReq({ body: { enabled: true } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockSetSetting).toHaveBeenCalledWith('registration_enabled', 'true');
    expect(res._json).toEqual({ message: 'Setting updated' });
  });

  it('logs admin action to DB', async () => {
    mockSetSetting.mockResolvedValue(undefined);
    const req = mockReq({ body: { enabled: false } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_actions'),
      expect.arrayContaining([1, 'update_setting', 'setting', 0]),
    );
  });

  it('broadcasts settings change via IO', async () => {
    mockSetSetting.mockResolvedValue(undefined);
    const req = mockReq({ body: { enabled: true } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockIOEmit).toHaveBeenCalledWith('admin:settingsChanged', {
      key: 'registration_enabled',
      value: true,
    });
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('put', '/admin/settings/registration_enabled')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockSetSetting.mockRejectedValue(err);
    const req = mockReq({ body: { enabled: true } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('PUT /admin/settings/recordings_enabled', () => {
  const handler = getHandler('put', '/admin/settings/recordings_enabled');

  it('updates setting and returns success message', async () => {
    mockSetSetting.mockResolvedValue(undefined);
    const req = mockReq({ body: { enabled: false } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockSetSetting).toHaveBeenCalledWith('recordings_enabled', 'false');
    expect(res._json).toEqual({ message: 'Setting updated' });
  });

  it('logs admin action to DB', async () => {
    mockSetSetting.mockResolvedValue(undefined);
    const req = mockReq({ body: { enabled: true } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_actions'),
      expect.arrayContaining([1, 'update_setting', 'setting', 0]),
    );
  });

  it('broadcasts settings change via IO', async () => {
    mockSetSetting.mockResolvedValue(undefined);
    const req = mockReq({ body: { enabled: false } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockIOEmit).toHaveBeenCalledWith('admin:settingsChanged', {
      key: 'recordings_enabled',
      value: false,
    });
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('put', '/admin/settings/recordings_enabled')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockSetSetting.mockRejectedValue(err);
    const req = mockReq({ body: { enabled: true } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// --- Game/Simulation Defaults ---

describe('GET /admin/settings/simulation_defaults', () => {
  const handler = getHandler('get', '/admin/settings/simulation_defaults');

  it('returns simulation defaults', async () => {
    const defaults = { gameMode: 'ffa', botCount: 4, speed: 'fast' };
    mockGetSimulationDefaults.mockResolvedValue(defaults);
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual({ defaults });
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockGetSimulationDefaults.mockRejectedValue(err);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('PUT /admin/settings/game_defaults', () => {
  const handler = getHandler('put', '/admin/settings/game_defaults');

  it('updates game defaults and returns success message', async () => {
    mockSetGameDefaults.mockResolvedValue(undefined);
    const defaults = { gameMode: 'ffa', maxPlayers: 6 };
    const req = mockReq({ body: { defaults } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockSetGameDefaults).toHaveBeenCalledWith(defaults);
    expect(res._json).toEqual({ message: 'Game defaults updated' });
  });

  it('logs admin action to DB', async () => {
    mockSetGameDefaults.mockResolvedValue(undefined);
    const defaults = { gameMode: 'teams' };
    const req = mockReq({ body: { defaults } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_actions'),
      expect.arrayContaining([1, 'update_setting', 'setting', 0]),
    );
  });

  it('broadcasts settings change via IO', async () => {
    mockSetGameDefaults.mockResolvedValue(undefined);
    const defaults = { gameMode: 'ffa' };
    const req = mockReq({ body: { defaults } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockIOEmit).toHaveBeenCalledWith('admin:settingsChanged', {
      key: 'game_defaults',
      value: defaults,
    });
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('put', '/admin/settings/game_defaults')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockSetGameDefaults.mockRejectedValue(err);
    const req = mockReq({ body: { defaults: {} } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('PUT /admin/settings/simulation_defaults', () => {
  const handler = getHandler('put', '/admin/settings/simulation_defaults');

  it('updates simulation defaults and returns success message', async () => {
    mockSetSimulationDefaults.mockResolvedValue(undefined);
    const defaults = { botCount: 8, speed: 'fast' };
    const req = mockReq({ body: { defaults } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockSetSimulationDefaults).toHaveBeenCalledWith(defaults);
    expect(res._json).toEqual({ message: 'Simulation defaults updated' });
  });

  it('logs admin action to DB', async () => {
    mockSetSimulationDefaults.mockResolvedValue(undefined);
    const defaults = { speed: 'realtime' };
    const req = mockReq({ body: { defaults } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_actions'),
      expect.arrayContaining([1, 'update_setting', 'setting', 0]),
    );
  });

  it('broadcasts settings change via IO', async () => {
    mockSetSimulationDefaults.mockResolvedValue(undefined);
    const defaults = { speed: 'fast' };
    const req = mockReq({ body: { defaults } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockIOEmit).toHaveBeenCalledWith('admin:settingsChanged', {
      key: 'simulation_defaults',
      value: defaults,
    });
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('put', '/admin/settings/simulation_defaults')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockSetSimulationDefaults.mockRejectedValue(err);
    const req = mockReq({ body: { defaults: {} } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// EMAIL SETTINGS
// ============================================================================

describe('GET /admin/settings/email_settings', () => {
  const handler = getHandler('get', '/admin/settings/email_settings');

  it('returns effective email settings with password masked', async () => {
    mockGetEmailSettings.mockResolvedValue({});
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual({
      settings: {
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: 'user@example.com',
        smtpPassword: '••••••••',
        fromEmail: 'noreply@example.com',
        fromName: 'BlastArena',
      },
    });
  });

  it('uses DB settings over env config when available', async () => {
    mockGetEmailSettings.mockResolvedValue({
      smtpHost: 'db-smtp.example.com',
      smtpPort: 465,
      smtpUser: 'dbuser@example.com',
      smtpPassword: 'dbpass',
      fromEmail: 'db@example.com',
      fromName: 'DBBlast',
    });
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual({
      settings: {
        smtpHost: 'db-smtp.example.com',
        smtpPort: 465,
        smtpUser: 'dbuser@example.com',
        smtpPassword: '••••••••',
        fromEmail: 'db@example.com',
        fromName: 'DBBlast',
      },
    });
  });

  it('shows empty password when neither DB nor env has one', async () => {
    mockGetEmailSettings.mockResolvedValue({});
    mockGetConfig.mockReturnValue({
      APP_URL: 'http://localhost:8080',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      SMTP_USER: 'user@example.com',
      SMTP_PASSWORD: '',
      SMTP_FROM_EMAIL: 'noreply@example.com',
      SMTP_FROM_NAME: 'BlastArena',
    });
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect((res._json as any).settings.smtpPassword).toBe('');
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('get', '/admin/settings/email_settings')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockGetEmailSettings.mockRejectedValue(err);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('PUT /admin/settings/email_settings', () => {
  const handler = getHandler('put', '/admin/settings/email_settings');

  it('updates email settings and returns success', async () => {
    mockGetEmailSettings.mockResolvedValue({});
    mockSetEmailSettings.mockResolvedValue(undefined);
    const req = mockReq({
      body: { smtpHost: 'new-smtp.example.com', smtpPort: 465 },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockSetEmailSettings).toHaveBeenCalled();
    expect(res._json).toEqual({ message: 'Email settings updated' });
  });

  it('preserves existing password when masked value is sent', async () => {
    mockGetEmailSettings.mockResolvedValue({ smtpPassword: 'existing-secret' });
    mockSetEmailSettings.mockResolvedValue(undefined);
    const req = mockReq({
      body: { smtpPassword: '••••••••', smtpHost: 'smtp.test.com' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    const savedSettings = mockSetEmailSettings.mock.calls[0][0];
    expect(savedSettings.smtpPassword).toBe('existing-secret');
  });

  it('preserves existing password when smtpPassword is undefined', async () => {
    mockGetEmailSettings.mockResolvedValue({ smtpPassword: 'old-pw' });
    mockSetEmailSettings.mockResolvedValue(undefined);
    const req = mockReq({
      body: { smtpHost: 'smtp.test.com' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    const savedSettings = mockSetEmailSettings.mock.calls[0][0];
    expect(savedSettings.smtpPassword).toBe('old-pw');
  });

  it('clears password when empty string is sent', async () => {
    mockGetEmailSettings.mockResolvedValue({ smtpPassword: 'existing' });
    mockSetEmailSettings.mockResolvedValue(undefined);
    const req = mockReq({
      body: { smtpPassword: '' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    const savedSettings = mockSetEmailSettings.mock.calls[0][0];
    expect(savedSettings.smtpPassword).toBeUndefined();
  });

  it('sets new password when a non-masked value is provided', async () => {
    mockGetEmailSettings.mockResolvedValue({});
    mockSetEmailSettings.mockResolvedValue(undefined);
    const req = mockReq({
      body: { smtpPassword: 'brand-new-password' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    const savedSettings = mockSetEmailSettings.mock.calls[0][0];
    expect(savedSettings.smtpPassword).toBe('brand-new-password');
  });

  it('invalidates transporter after update', async () => {
    mockGetEmailSettings.mockResolvedValue({});
    mockSetEmailSettings.mockResolvedValue(undefined);
    const req = mockReq({ body: { smtpHost: 'new.host.com' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockInvalidateTransporter).toHaveBeenCalled();
  });

  it('logs admin action to DB', async () => {
    mockGetEmailSettings.mockResolvedValue({});
    mockSetEmailSettings.mockResolvedValue(undefined);
    const req = mockReq({ body: { smtpHost: 'new.host.com' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_actions'),
      expect.arrayContaining([1, 'update_setting', 'setting', 0]),
    );
  });

  it('broadcasts settings change via IO', async () => {
    mockGetEmailSettings.mockResolvedValue({});
    mockSetEmailSettings.mockResolvedValue(undefined);
    const req = mockReq({ body: { smtpHost: 'new.host.com' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockIOEmit).toHaveBeenCalledWith('admin:settingsChanged', {
      key: 'email_settings',
    });
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('put', '/admin/settings/email_settings')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockGetEmailSettings.mockRejectedValue(err);
    const req = mockReq({ body: {} });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('POST /admin/settings/email_settings/test', () => {
  const handler = getHandler('post', '/admin/settings/email_settings/test');

  it('sends test email and returns success message', async () => {
    mockSendTestEmail.mockResolvedValue(undefined);
    const req = mockReq({ body: { to: 'test@example.com' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockSendTestEmail).toHaveBeenCalledWith('test@example.com', 'en');
    expect(res._json).toEqual({ message: 'Test email sent successfully' });
  });

  it('returns 400 with error message on send failure', async () => {
    mockSendTestEmail.mockRejectedValue(new Error('SMTP connect failed'));
    const req = mockReq({ body: { to: 'test@example.com' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(400);
    expect(res._json).toEqual({
      error: expect.stringContaining('Failed to send test email'),
    });
  });

  it('includes error message detail in response', async () => {
    mockSendTestEmail.mockRejectedValue(new Error('Connection refused'));
    const req = mockReq({ body: { to: 'test@example.com' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect((res._json as any).error).toContain('Connection refused');
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('post', '/admin/settings/email_settings/test')).toBe(true);
  });
});

// ============================================================================
// USER MANAGEMENT ROUTES
// ============================================================================

describe('POST /admin/users', () => {
  const handler = getHandler('post', '/admin/users');

  it('creates user and returns 201', async () => {
    const user = { id: 5, username: 'newuser' };
    mockCreateUser.mockResolvedValue(user);
    const req = mockReq({
      body: { username: 'newuser', email: 'new@example.com', password: 'pass123' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(201);
    expect(res._json).toEqual(user);
  });

  it('passes adminId, username, email, password, role to service', async () => {
    mockCreateUser.mockResolvedValue({ id: 1, username: 'x' });
    const req = mockReq({
      user: { userId: 10, username: 'admin', role: 'admin' },
      body: {
        username: 'newmod',
        email: 'mod@example.com',
        password: 'securepass',
        role: 'moderator',
      },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockCreateUser).toHaveBeenCalledWith(
      10,
      'newmod',
      'mod@example.com',
      'securepass',
      'moderator',
    );
  });

  it('creates user without explicit role (optional)', async () => {
    mockCreateUser.mockResolvedValue({ id: 2, username: 'basic' });
    const req = mockReq({
      body: { username: 'basic', email: 'basic@example.com', password: 'pass123' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockCreateUser).toHaveBeenCalledWith(
      1,
      'basic',
      'basic@example.com',
      'pass123',
      undefined,
    );
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('post', '/admin/users')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('Username taken');
    mockCreateUser.mockRejectedValue(err);
    const req = mockReq({
      body: { username: 'dup', email: 'dup@example.com', password: 'pass123' },
    });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('GET /admin/users', () => {
  const handler = getHandler('get', '/admin/users');

  it('returns paginated user list', async () => {
    const result = { users: [{ id: 1, username: 'alice' }], total: 1 };
    mockListUsers.mockResolvedValue(result);
    const req = mockReq({ query: { page: '1', limit: '20' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual(result);
    expect(mockListUsers).toHaveBeenCalledWith(1, 20, undefined);
  });

  it('passes search parameter to service', async () => {
    mockListUsers.mockResolvedValue({ users: [], total: 0 });
    const req = mockReq({ query: { page: '1', limit: '10', search: 'alice' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockListUsers).toHaveBeenCalledWith(1, 10, 'alice');
  });

  it('defaults to page 1 and limit 20 when not specified', async () => {
    mockListUsers.mockResolvedValue({ users: [], total: 0 });
    const req = mockReq({ query: {} });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockListUsers).toHaveBeenCalledWith(1, 20, undefined);
  });

  it('handles non-numeric page/limit as defaults', async () => {
    mockListUsers.mockResolvedValue({ users: [], total: 0 });
    const req = mockReq({ query: { page: 'abc', limit: 'xyz' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockListUsers).toHaveBeenCalledWith(1, 20, undefined);
  });

  it('does not have adminOnlyMiddleware (accessible to staff)', () => {
    expect(hasAdminOnly('get', '/admin/users')).toBe(false);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockListUsers.mockRejectedValue(err);
    const req = mockReq({ query: {} });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('PUT /admin/users/:id/role', () => {
  const handler = getHandler('put', '/admin/users/:id/role');

  it('changes user role and returns success message', async () => {
    mockChangeUserRole.mockResolvedValue(undefined);
    const req = mockReq({ params: { id: '5' }, body: { role: 'moderator' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockChangeUserRole).toHaveBeenCalledWith(1, 5, 'moderator');
    expect(res._json).toEqual({ message: 'Role updated' });
  });

  it('parses user ID from params as integer', async () => {
    mockChangeUserRole.mockResolvedValue(undefined);
    const req = mockReq({ params: { id: '42' }, body: { role: 'admin' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockChangeUserRole).toHaveBeenCalledWith(1, 42, 'admin');
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('put', '/admin/users/:id/role')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('Cannot change own role');
    mockChangeUserRole.mockRejectedValue(err);
    const req = mockReq({ params: { id: '1' }, body: { role: 'user' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('PUT /admin/users/:id/deactivate', () => {
  const handler = getHandler('put', '/admin/users/:id/deactivate');

  it('deactivates a user and returns deactivation message', async () => {
    mockDeactivateUser.mockResolvedValue(undefined);
    const req = mockReq({ params: { id: '7' }, body: { deactivated: true } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockDeactivateUser).toHaveBeenCalledWith(1, 7, true);
    expect(res._json).toEqual({ message: 'User deactivated' });
  });

  it('reactivates a user and returns reactivation message', async () => {
    mockDeactivateUser.mockResolvedValue(undefined);
    const req = mockReq({ params: { id: '7' }, body: { deactivated: false } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockDeactivateUser).toHaveBeenCalledWith(1, 7, false);
    expect(res._json).toEqual({ message: 'User reactivated' });
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('put', '/admin/users/:id/deactivate')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('Cannot deactivate self');
    mockDeactivateUser.mockRejectedValue(err);
    const req = mockReq({ params: { id: '1' }, body: { deactivated: true } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('PUT /admin/users/:id/password', () => {
  const handler = getHandler('put', '/admin/users/:id/password');

  it('resets user password and returns success message', async () => {
    mockResetUserPassword.mockResolvedValue(undefined);
    const req = mockReq({ params: { id: '5' }, body: { password: 'newpass123' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockResetUserPassword).toHaveBeenCalledWith(1, 5, 'newpass123');
    expect(res._json).toEqual({ message: 'Password reset' });
  });

  it('parses user ID from params as integer', async () => {
    mockResetUserPassword.mockResolvedValue(undefined);
    const req = mockReq({ params: { id: '99' }, body: { password: 'p4ssw0rd' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockResetUserPassword).toHaveBeenCalledWith(1, 99, 'p4ssw0rd');
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('put', '/admin/users/:id/password')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('User not found');
    mockResetUserPassword.mockRejectedValue(err);
    const req = mockReq({ params: { id: '999' }, body: { password: 'newpass' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('DELETE /admin/users/:id', () => {
  const handler = getHandler('delete', '/admin/users/:id');

  it('deletes user and returns success message', async () => {
    mockDeleteUser.mockResolvedValue(undefined);
    const req = mockReq({ params: { id: '5' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockDeleteUser).toHaveBeenCalledWith(1, 5);
    expect(res._json).toEqual({ message: 'User deleted' });
  });

  it('parses user ID from params as integer', async () => {
    mockDeleteUser.mockResolvedValue(undefined);
    const req = mockReq({
      user: { userId: 10, username: 'admin', role: 'admin' },
      params: { id: '42' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockDeleteUser).toHaveBeenCalledWith(10, 42);
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('delete', '/admin/users/:id')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('Cannot delete self');
    mockDeleteUser.mockRejectedValue(err);
    const req = mockReq({ params: { id: '1' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// STATS
// ============================================================================

describe('GET /admin/stats', () => {
  const handler = getHandler('get', '/admin/stats');

  it('returns server stats', async () => {
    const stats = { totalUsers: 100, totalMatches: 50, activeRooms: 3 };
    mockGetServerStats.mockResolvedValue(stats);
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual(stats);
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('get', '/admin/stats')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockGetServerStats.mockRejectedValue(err);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// MATCHES
// ============================================================================

describe('GET /admin/matches', () => {
  const handler = getHandler('get', '/admin/matches');

  it('returns paginated match history', async () => {
    const result = { matches: [{ id: 1 }], total: 1 };
    mockGetMatchHistory.mockResolvedValue(result);
    const req = mockReq({ query: { page: '2', limit: '10' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockGetMatchHistory).toHaveBeenCalledWith(2, 10);
    expect(res._json).toEqual(result);
  });

  it('defaults to page 1 and limit 20', async () => {
    mockGetMatchHistory.mockResolvedValue({ matches: [], total: 0 });
    const req = mockReq({ query: {} });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockGetMatchHistory).toHaveBeenCalledWith(1, 20);
  });

  it('does not have adminOnlyMiddleware (accessible to staff)', () => {
    expect(hasAdminOnly('get', '/admin/matches')).toBe(false);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockGetMatchHistory.mockRejectedValue(err);
    const req = mockReq({ query: {} });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('GET /admin/matches/:id', () => {
  const handler = getHandler('get', '/admin/matches/:id');

  it('returns match detail', async () => {
    const detail = { id: 5, mode: 'ffa', players: [] };
    mockGetMatchDetail.mockResolvedValue(detail);
    const req = mockReq({ params: { id: '5' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockGetMatchDetail).toHaveBeenCalledWith(5);
    expect(res._json).toEqual(detail);
  });

  it('parses match ID from params as integer', async () => {
    mockGetMatchDetail.mockResolvedValue({});
    const req = mockReq({ params: { id: '123' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockGetMatchDetail).toHaveBeenCalledWith(123);
  });

  it('does not have adminOnlyMiddleware (accessible to staff)', () => {
    expect(hasAdminOnly('get', '/admin/matches/:id')).toBe(false);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('Match not found');
    mockGetMatchDetail.mockRejectedValue(err);
    const req = mockReq({ params: { id: '999' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('DELETE /admin/matches/:id', () => {
  const handler = getHandler('delete', '/admin/matches/:id');

  it('deletes match, replay, and logs action', async () => {
    mockDeleteReplay.mockReturnValue(true);
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    const req = mockReq({ params: { id: '10' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockDeleteReplay).toHaveBeenCalledWith(10);
    expect(mockExecute).toHaveBeenCalledWith('DELETE FROM matches WHERE id = ?', [10]);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_actions'),
      expect.arrayContaining([1, 'delete_match', 'match', 10]),
    );
    expect(res._json).toEqual({ message: 'Match deleted' });
  });

  it('still succeeds even if replay does not exist', async () => {
    mockDeleteReplay.mockReturnValue(false);
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    const req = mockReq({ params: { id: '10' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual({ message: 'Match deleted' });
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('delete', '/admin/matches/:id')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockDeleteReplay.mockReturnValue(true);
    mockExecute.mockRejectedValue(err);
    const req = mockReq({ params: { id: '10' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('DELETE /admin/matches (bulk)', () => {
  const handler = getHandler('delete', '/admin/matches');

  it('deletes all matches with replay cleanup and returns count', async () => {
    mockGetMatchHistory.mockResolvedValue({
      matches: [{ id: 1 }, { id: 2 }, { id: 3 }],
      total: 3,
    });
    mockDeleteReplay.mockReturnValueOnce(true).mockReturnValueOnce(false).mockReturnValueOnce(true);
    mockExecute.mockResolvedValue({ affectedRows: 3 });
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockGetMatchHistory).toHaveBeenCalledWith(1, 100000);
    expect(mockDeleteReplay).toHaveBeenCalledTimes(3);
    expect(mockExecute).toHaveBeenCalledWith('DELETE FROM matches');
    expect(res._json).toEqual({ message: 'All matches deleted', count: 3, replaysCleaned: 2 });
  });

  it('logs admin action with match count and replays cleaned', async () => {
    mockGetMatchHistory.mockResolvedValue({
      matches: [{ id: 1 }],
      total: 1,
    });
    mockDeleteReplay.mockReturnValue(true);
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_actions'),
      expect.arrayContaining([1, 'delete_all_matches', 'match', 0]),
    );
  });

  it('handles empty match list gracefully', async () => {
    mockGetMatchHistory.mockResolvedValue({ matches: [], total: 0 });
    mockExecute.mockResolvedValue({ affectedRows: 0 });
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockDeleteReplay).not.toHaveBeenCalled();
    expect(res._json).toEqual({ message: 'All matches deleted', count: 0, replaysCleaned: 0 });
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('delete', '/admin/matches')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockGetMatchHistory.mockRejectedValue(err);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// ACTIVE ROOMS
// ============================================================================

describe('GET /admin/rooms', () => {
  const handler = getHandler('get', '/admin/rooms');

  it('returns active rooms list', async () => {
    const rooms = [{ id: 'room1', name: 'Test Room' }];
    mockGetActiveRooms.mockResolvedValue(rooms);
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual(rooms);
  });

  it('returns empty array when no rooms', async () => {
    mockGetActiveRooms.mockResolvedValue([]);
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual([]);
  });

  it('does not have adminOnlyMiddleware (accessible to staff)', () => {
    expect(hasAdminOnly('get', '/admin/rooms')).toBe(false);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('Registry error');
    mockGetActiveRooms.mockRejectedValue(err);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// ADMIN ACTION LOG
// ============================================================================

describe('GET /admin/actions', () => {
  const handler = getHandler('get', '/admin/actions');

  it('returns paginated admin actions', async () => {
    const result = { actions: [{ id: 1, action: 'create_user' }], total: 1 };
    mockGetAdminActions.mockResolvedValue(result);
    const req = mockReq({ query: { page: '1', limit: '20' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockGetAdminActions).toHaveBeenCalledWith(1, 20, undefined);
    expect(res._json).toEqual(result);
  });

  it('passes action filter parameter to service', async () => {
    mockGetAdminActions.mockResolvedValue({ actions: [], total: 0 });
    const req = mockReq({ query: { page: '1', limit: '10', action: 'delete_user' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockGetAdminActions).toHaveBeenCalledWith(1, 10, 'delete_user');
  });

  it('defaults to page 1 and limit 20 when not specified', async () => {
    mockGetAdminActions.mockResolvedValue({ actions: [], total: 0 });
    const req = mockReq({ query: {} });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockGetAdminActions).toHaveBeenCalledWith(1, 20, undefined);
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('get', '/admin/actions')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockGetAdminActions.mockRejectedValue(err);
    const req = mockReq({ query: {} });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// ANNOUNCEMENTS
// ============================================================================

describe('POST /admin/announcements/toast', () => {
  const handler = getHandler('post', '/admin/announcements/toast');

  it('sends toast and returns success message', async () => {
    mockSendToast.mockResolvedValue(undefined);
    const req = mockReq({ body: { message: 'Server maintenance in 10 minutes' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockSendToast).toHaveBeenCalledWith(1, 'Server maintenance in 10 minutes');
    expect(res._json).toEqual({ message: 'Toast sent' });
  });

  it('uses correct admin user ID', async () => {
    mockSendToast.mockResolvedValue(undefined);
    const req = mockReq({
      user: { userId: 42, username: 'superadmin', role: 'admin' },
      body: { message: 'Test toast' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockSendToast).toHaveBeenCalledWith(42, 'Test toast');
  });

  it('does not have adminOnlyMiddleware (accessible to staff)', () => {
    expect(hasAdminOnly('post', '/admin/announcements/toast')).toBe(false);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('IO error');
    mockSendToast.mockRejectedValue(err);
    const req = mockReq({ body: { message: 'toast' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('POST /admin/announcements/banner', () => {
  const handler = getHandler('post', '/admin/announcements/banner');

  it('sets banner and returns success message', async () => {
    mockSetBanner.mockResolvedValue(undefined);
    const req = mockReq({ body: { message: 'Scheduled downtime tonight at 2AM' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockSetBanner).toHaveBeenCalledWith(1, 'Scheduled downtime tonight at 2AM');
    expect(res._json).toEqual({ message: 'Banner set' });
  });

  it('uses correct admin user ID', async () => {
    mockSetBanner.mockResolvedValue(undefined);
    const req = mockReq({
      user: { userId: 99, username: 'superadmin', role: 'admin' },
      body: { message: 'New banner' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockSetBanner).toHaveBeenCalledWith(99, 'New banner');
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('post', '/admin/announcements/banner')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockSetBanner.mockRejectedValue(err);
    const req = mockReq({ body: { message: 'banner' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('DELETE /admin/announcements/banner', () => {
  const handler = getHandler('delete', '/admin/announcements/banner');

  it('clears banner and returns success message', async () => {
    mockClearBanner.mockResolvedValue(undefined);
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockClearBanner).toHaveBeenCalledWith(1);
    expect(res._json).toEqual({ message: 'Banner cleared' });
  });

  it('uses correct admin user ID', async () => {
    mockClearBanner.mockResolvedValue(undefined);
    const req = mockReq({ user: { userId: 50, username: 'admin', role: 'admin' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockClearBanner).toHaveBeenCalledWith(50);
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('delete', '/admin/announcements/banner')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockClearBanner.mockRejectedValue(err);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// REPLAYS
// ============================================================================

describe('GET /admin/replays', () => {
  const handler = getHandler('get', '/admin/replays');

  it('returns paginated replay list', async () => {
    const result = { replays: [{ matchId: 1 }], total: 1 };
    mockListReplays.mockResolvedValue(result);
    const req = mockReq({ query: { page: '1', limit: '10' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockListReplays).toHaveBeenCalledWith(1, 10);
    expect(res._json).toEqual(result);
  });

  it('defaults to page 1 and limit 20', async () => {
    mockListReplays.mockResolvedValue({ replays: [], total: 0 });
    const req = mockReq({ query: {} });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockListReplays).toHaveBeenCalledWith(1, 20);
  });

  it('does not have adminOnlyMiddleware (accessible to staff)', () => {
    expect(hasAdminOnly('get', '/admin/replays')).toBe(false);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('FS error');
    mockListReplays.mockRejectedValue(err);
    const req = mockReq({ query: {} });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('GET /admin/replays/:matchId', () => {
  const handler = getHandler('get', '/admin/replays/:matchId');

  it('returns replay data on success', async () => {
    const replay = { matchId: 5, frames: [] };
    mockGetReplay.mockResolvedValue(replay);
    const req = mockReq({ params: { matchId: '5' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockGetReplay).toHaveBeenCalledWith(5);
    expect(res._json).toEqual(replay);
  });

  it('returns 404 when replay not found', async () => {
    mockGetReplay.mockResolvedValue(null);
    const req = mockReq({ params: { matchId: '999' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: 'Replay not found' });
  });

  it('does not have adminOnlyMiddleware (accessible to staff)', () => {
    expect(hasAdminOnly('get', '/admin/replays/:matchId')).toBe(false);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('Decompress error');
    mockGetReplay.mockRejectedValue(err);
    const req = mockReq({ params: { matchId: '5' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('DELETE /admin/replays/:matchId', () => {
  const handler = getHandler('delete', '/admin/replays/:matchId');

  it('deletes replay and returns success message', async () => {
    mockDeleteReplay.mockReturnValue(true);
    const req = mockReq({ params: { matchId: '5' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockDeleteReplay).toHaveBeenCalledWith(5);
    expect(res._json).toEqual({ message: 'Replay deleted' });
  });

  it('returns 404 when replay not found', async () => {
    mockDeleteReplay.mockReturnValue(false);
    const req = mockReq({ params: { matchId: '999' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: 'Replay not found' });
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('delete', '/admin/replays/:matchId')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('FS error');
    mockDeleteReplay.mockImplementation(() => {
      throw err;
    });
    const req = mockReq({ params: { matchId: '5' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// SIMULATIONS
// ============================================================================

describe('GET /admin/simulations', () => {
  const handler = getHandler('get', '/admin/simulations');

  it('returns simulation history with pagination', () => {
    const history = { batches: [{ id: 'batch1' }], total: 1 };
    mockGetHistory.mockReturnValue(history);
    const req = mockReq({ query: { page: '2', limit: '10' } });
    const res = mockRes();
    handler(req, res, jest.fn());
    expect(mockGetHistory).toHaveBeenCalledWith(2, 10);
    expect(res._json).toEqual(history);
  });

  it('clamps page to minimum 1', () => {
    mockGetHistory.mockReturnValue({ batches: [], total: 0 });
    const req = mockReq({ query: { page: '0' } });
    const res = mockRes();
    handler(req, res, jest.fn());
    expect(mockGetHistory).toHaveBeenCalledWith(1, 20);
  });

  it('clamps limit to 1-100 range', () => {
    mockGetHistory.mockReturnValue({ batches: [], total: 0 });
    const req = mockReq({ query: { limit: '200' } });
    const res = mockRes();
    handler(req, res, jest.fn());
    expect(mockGetHistory).toHaveBeenCalledWith(1, 100);
  });

  it('treats limit 0 as falsy and falls back to default 20, then clamps to 20', () => {
    mockGetHistory.mockReturnValue({ batches: [], total: 0 });
    const req = mockReq({ query: { limit: '0' } });
    const res = mockRes();
    handler(req, res, jest.fn());
    // parseInt('0') is 0 which is falsy, so || 20 yields 20
    expect(mockGetHistory).toHaveBeenCalledWith(1, 20);
  });

  it('defaults to page 1, limit 20 on invalid input', () => {
    mockGetHistory.mockReturnValue({ batches: [], total: 0 });
    const req = mockReq({ query: { page: 'abc', limit: 'xyz' } });
    const res = mockRes();
    handler(req, res, jest.fn());
    expect(mockGetHistory).toHaveBeenCalledWith(1, 20);
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('get', '/admin/simulations')).toBe(true);
  });
});

describe('GET /admin/simulations/:batchId', () => {
  const handler = getHandler('get', '/admin/simulations/:batchId');

  it('returns batch results on success', () => {
    const data = { results: [{ winner: 'bot1' }], summary: { total: 1 } };
    mockGetBatchResults.mockReturnValue(data);
    const req = mockReq({ params: { batchId: 'batch-123' } });
    const res = mockRes();
    handler(req, res, jest.fn());
    expect(mockGetBatchResults).toHaveBeenCalledWith('batch-123');
    expect(res._json).toEqual(data);
  });

  it('returns 404 when batch not found', () => {
    mockGetBatchResults.mockReturnValue(null);
    const req = mockReq({ params: { batchId: 'nonexistent' } });
    const res = mockRes();
    handler(req, res, jest.fn());
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: 'Batch not found' });
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('get', '/admin/simulations/:batchId')).toBe(true);
  });
});

describe('GET /admin/simulations/:batchId/replay/:gameIndex', () => {
  const handler = getHandler('get', '/admin/simulations/:batchId/replay/:gameIndex');

  it('returns simulation replay on success', async () => {
    const replay = { matchId: 1, frames: [] };
    mockGetSimulationReplay.mockResolvedValue(replay);
    const req = mockReq({ params: { batchId: 'batch-1', gameIndex: '0' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockGetSimulationReplay).toHaveBeenCalledWith('batch-1', 0);
    expect(res._json).toEqual(replay);
  });

  it('returns 400 for invalid (NaN) game index', async () => {
    const req = mockReq({ params: { batchId: 'batch-1', gameIndex: 'abc' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: 'Invalid game index' });
  });

  it('returns 400 for negative game index', async () => {
    const req = mockReq({ params: { batchId: 'batch-1', gameIndex: '-1' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: 'Invalid game index' });
  });

  it('returns 404 when replay not found', async () => {
    mockGetSimulationReplay.mockResolvedValue(null);
    const req = mockReq({ params: { batchId: 'batch-1', gameIndex: '5' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: 'Replay not found' });
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('get', '/admin/simulations/:batchId/replay/:gameIndex')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('FS error');
    mockGetSimulationReplay.mockRejectedValue(err);
    const req = mockReq({ params: { batchId: 'batch-1', gameIndex: '0' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('POST /admin/simulations', () => {
  const handler = getHandler('post', '/admin/simulations');

  it('starts batch and returns 201 on success', () => {
    const result = { batchId: 'batch-123', totalGames: 10 };
    mockStartBatch.mockReturnValue(result);
    const req = mockReq({ body: { gameMode: 'ffa', botCount: 4 } });
    const res = mockRes();
    handler(req, res, jest.fn());
    expect(mockStartBatch).toHaveBeenCalledWith({ gameMode: 'ffa', botCount: 4 }, 1);
    expect(res._status).toBe(201);
    expect(res._json).toEqual(result);
  });

  it('returns 429 when queue is full', () => {
    const result = { error: 'Queue is full, maximum 10 batches' };
    mockStartBatch.mockReturnValue(result);
    const req = mockReq({ body: { gameMode: 'ffa', botCount: 4 } });
    const res = mockRes();
    handler(req, res, jest.fn());
    expect(res._status).toBe(429);
    expect(res._json).toEqual(result);
  });

  it('passes correct admin user ID to startBatch', () => {
    mockStartBatch.mockReturnValue({ batchId: 'b1' });
    const req = mockReq({
      user: { userId: 77, username: 'admin', role: 'admin' },
      body: { gameMode: 'teams' },
    });
    const res = mockRes();
    handler(req, res, jest.fn());
    expect(mockStartBatch).toHaveBeenCalledWith({ gameMode: 'teams' }, 77);
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('post', '/admin/simulations')).toBe(true);
  });
});

describe('DELETE /admin/simulations/:batchId', () => {
  const handler = getHandler('delete', '/admin/simulations/:batchId');

  it('cancels and deletes batch, returns success message', () => {
    mockCancelBatch.mockReturnValue(true);
    mockDeleteBatch.mockReturnValue(true);
    const req = mockReq({ params: { batchId: 'batch-123' } });
    const res = mockRes();
    handler(req, res, jest.fn());
    expect(mockCancelBatch).toHaveBeenCalledWith('batch-123');
    expect(mockDeleteBatch).toHaveBeenCalledWith('batch-123');
    expect(res._json).toEqual({ message: 'Batch deleted' });
  });

  it('returns 404 when batch not found for deletion', () => {
    mockCancelBatch.mockReturnValue(false);
    mockDeleteBatch.mockReturnValue(false);
    const req = mockReq({ params: { batchId: 'nonexistent' } });
    const res = mockRes();
    handler(req, res, jest.fn());
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: 'Batch not found' });
  });

  it('tries cancel even if batch is completed (not running)', () => {
    mockCancelBatch.mockReturnValue(false);
    mockDeleteBatch.mockReturnValue(true);
    const req = mockReq({ params: { batchId: 'completed-batch' } });
    const res = mockRes();
    handler(req, res, jest.fn());
    expect(mockCancelBatch).toHaveBeenCalledWith('completed-batch');
    expect(mockDeleteBatch).toHaveBeenCalledWith('completed-batch');
    expect(res._json).toEqual({ message: 'Batch deleted' });
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('delete', '/admin/simulations/:batchId')).toBe(true);
  });
});

// ============================================================================
// BOT AI MANAGEMENT
// ============================================================================

describe('GET /admin/ai', () => {
  const handler = getHandler('get', '/admin/ai');

  it('returns all AIs', async () => {
    const ais = [
      { id: '1', name: 'BuiltIn', isBuiltin: true },
      { id: '2', name: 'Custom', isBuiltin: false },
    ];
    mockListAllAIs.mockResolvedValue(ais);
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual({ ais });
  });

  it('returns empty array when no AIs exist', async () => {
    mockListAllAIs.mockResolvedValue([]);
    const req = mockReq();
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._json).toEqual({ ais: [] });
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('get', '/admin/ai')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('DB error');
    mockListAllAIs.mockRejectedValue(err);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('POST /admin/ai', () => {
  const handler = getHandler('post', '/admin/ai');

  it('uploads AI and returns 201 with entry on success', async () => {
    const entry = { id: 'ai-1', name: 'TestAI' };
    mockUploadAI.mockResolvedValue({ entry, errors: [] });
    const req = mockReq({
      file: {
        buffer: Buffer.from('// AI code'),
        originalname: 'test.ts',
      },
      body: { name: 'TestAI', description: 'A test AI' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockUploadAI).toHaveBeenCalledWith(
      'TestAI',
      'A test AI',
      Buffer.from('// AI code'),
      'test.ts',
      1,
    );
    expect(res._status).toBe(201);
    expect(res._json).toEqual({ ai: entry });
  });

  it('returns 400 when no file uploaded', async () => {
    const req = mockReq({ body: { name: 'TestAI' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: 'No file uploaded' });
  });

  it('returns 400 when name is missing', async () => {
    const req = mockReq({
      file: { buffer: Buffer.from('code'), originalname: 'test.ts' },
      body: { name: '' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: 'Name is required (1-100 characters)' });
  });

  it('returns 400 when name is too long', async () => {
    const req = mockReq({
      file: { buffer: Buffer.from('code'), originalname: 'test.ts' },
      body: { name: 'x'.repeat(101) },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: 'Name is required (1-100 characters)' });
  });

  it('returns 400 when compilation/validation fails', async () => {
    mockUploadAI.mockResolvedValue({
      entry: null,
      errors: ['Syntax error on line 5', 'Blocked import detected'],
    });
    const req = mockReq({
      file: { buffer: Buffer.from('bad code'), originalname: 'bad.ts' },
      body: { name: 'BadAI' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(400);
    expect(res._json).toEqual({
      error: 'Compilation/validation failed',
      errors: ['Syntax error on line 5', 'Blocked import detected'],
    });
  });

  it('uses empty string for description when not provided', async () => {
    mockUploadAI.mockResolvedValue({ entry: { id: 'ai-1' }, errors: [] });
    const req = mockReq({
      file: { buffer: Buffer.from('code'), originalname: 'test.ts' },
      body: { name: 'NoDesc' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockUploadAI).toHaveBeenCalledWith('NoDesc', '', expect.any(Buffer), 'test.ts', 1);
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('post', '/admin/ai')).toBe(true);
  });

  it('passes error to next() on unexpected failure', async () => {
    const err = new Error('Disk full');
    mockUploadAI.mockRejectedValue(err);
    const req = mockReq({
      file: { buffer: Buffer.from('code'), originalname: 'test.ts' },
      body: { name: 'TestAI' },
    });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('PUT /admin/ai/:id', () => {
  const handler = getHandler('put', '/admin/ai/:id');

  it('updates AI and returns success message', async () => {
    mockUpdateAI.mockResolvedValue(undefined);
    const req = mockReq({
      params: { id: 'ai-123' },
      body: { name: 'Updated AI', isActive: true },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockUpdateAI).toHaveBeenCalledWith('ai-123', { name: 'Updated AI', isActive: true }, 1);
    expect(res._json).toEqual({ message: 'AI updated' });
  });

  it('passes correct user ID from req.user', async () => {
    mockUpdateAI.mockResolvedValue(undefined);
    const req = mockReq({
      user: { userId: 55, username: 'admin', role: 'admin' },
      params: { id: 'ai-456' },
      body: { description: 'New description' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockUpdateAI).toHaveBeenCalledWith('ai-456', { description: 'New description' }, 55);
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('put', '/admin/ai/:id')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('AI not found');
    mockUpdateAI.mockRejectedValue(err);
    const req = mockReq({ params: { id: 'ai-bad' }, body: {} });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('PUT /admin/ai/:id/upload', () => {
  const handler = getHandler('put', '/admin/ai/:id/upload');

  it('reuploads AI source and returns success message', async () => {
    mockReuploadAI.mockResolvedValue({ success: true, errors: [] });
    const req = mockReq({
      params: { id: 'ai-123' },
      file: { buffer: Buffer.from('new code'), originalname: 'updated.ts' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockReuploadAI).toHaveBeenCalledWith('ai-123', Buffer.from('new code'), 'updated.ts', 1);
    expect(res._json).toEqual({ message: 'AI updated' });
  });

  it('returns 400 when no file uploaded', async () => {
    const req = mockReq({ params: { id: 'ai-123' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: 'No file uploaded' });
  });

  it('returns 400 when compilation/validation fails', async () => {
    mockReuploadAI.mockResolvedValue({
      success: false,
      errors: ['Type error on line 10'],
    });
    const req = mockReq({
      params: { id: 'ai-123' },
      file: { buffer: Buffer.from('bad'), originalname: 'bad.ts' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(400);
    expect(res._json).toEqual({
      error: 'Compilation/validation failed',
      errors: ['Type error on line 10'],
    });
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('put', '/admin/ai/:id/upload')).toBe(true);
  });

  it('passes error to next() on unexpected failure', async () => {
    const err = new Error('Disk full');
    mockReuploadAI.mockRejectedValue(err);
    const req = mockReq({
      params: { id: 'ai-123' },
      file: { buffer: Buffer.from('code'), originalname: 'test.ts' },
    });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('GET /admin/ai/:id/download', () => {
  const handler = getHandler('get', '/admin/ai/:id/download');

  it('returns source file with correct headers', async () => {
    const source = { filename: 'myai.ts', content: Buffer.from('// AI source') };
    mockDownloadSource.mockResolvedValue(source);
    const req = mockReq({ params: { id: 'ai-123' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockDownloadSource).toHaveBeenCalledWith('ai-123');
    expect(res._headers['Content-Type']).toBe('text/typescript');
    expect(res._headers['Content-Disposition']).toBe('attachment; filename="myai.ts"');
    expect(res._sent).toEqual(Buffer.from('// AI source'));
  });

  it('returns 404 when source not found', async () => {
    mockDownloadSource.mockResolvedValue(null);
    const req = mockReq({ params: { id: 'ai-nonexistent' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: 'AI source not found' });
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('get', '/admin/ai/:id/download')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('FS error');
    mockDownloadSource.mockRejectedValue(err);
    const req = mockReq({ params: { id: 'ai-123' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('DELETE /admin/ai/:id', () => {
  const handler = getHandler('delete', '/admin/ai/:id');

  it('deletes AI and returns success message', async () => {
    mockDeleteAI.mockResolvedValue(undefined);
    const req = mockReq({ params: { id: 'ai-123' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockDeleteAI).toHaveBeenCalledWith('ai-123', 1);
    expect(res._json).toEqual({ message: 'AI deleted' });
  });

  it('passes correct admin user ID', async () => {
    mockDeleteAI.mockResolvedValue(undefined);
    const req = mockReq({
      user: { userId: 33, username: 'admin', role: 'admin' },
      params: { id: 'ai-456' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockDeleteAI).toHaveBeenCalledWith('ai-456', 33);
  });

  it('has adminOnlyMiddleware in route stack', () => {
    expect(hasAdminOnly('delete', '/admin/ai/:id')).toBe(true);
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('Cannot delete builtin AI');
    mockDeleteAI.mockRejectedValue(err);
    const req = mockReq({ params: { id: 'ai-builtin' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// ACCOUNT CLEANUP ROUTES
// ============================================================================

describe('POST /admin/users/cleanup/preview', () => {
  const handler = getHandler('post', '/admin/users/cleanup/preview');

  it('returns count from previewCleanup', async () => {
    mockPreviewCleanup.mockResolvedValue({ count: 7 });
    const req = mockReq({ body: { type: 'unverified', days: 30 } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockPreviewCleanup).toHaveBeenCalledWith('unverified', 30);
    expect(res._json).toEqual({ count: 7 });
  });

  it('calls previewCleanup for deactivated type without days', async () => {
    mockPreviewCleanup.mockResolvedValue({ count: 3 });
    const req = mockReq({ body: { type: 'deactivated' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockPreviewCleanup).toHaveBeenCalledWith('deactivated', undefined);
    expect(res._json).toEqual({ count: 3 });
  });

  it('calls previewCleanup for inactive type', async () => {
    mockPreviewCleanup.mockResolvedValue({ count: 0 });
    const req = mockReq({ body: { type: 'inactive', days: 90 } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockPreviewCleanup).toHaveBeenCalledWith('inactive', 90);
    expect(res._json).toEqual({ count: 0 });
  });

  it('passes errors to next()', async () => {
    const err = new Error('db fail');
    mockPreviewCleanup.mockRejectedValue(err);
    const req = mockReq({ body: { type: 'unverified', days: 7 } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('has adminOnlyMiddleware', () => {
    expect(hasAdminOnly('post', '/admin/users/cleanup/preview')).toBe(true);
  });
});

describe('POST /admin/users/cleanup/execute', () => {
  const handler = getHandler('post', '/admin/users/cleanup/execute');

  it('returns deleted count from executeCleanup', async () => {
    mockExecuteCleanup.mockResolvedValue({ deleted: 5 });
    const req = mockReq({ body: { type: 'unverified', days: 30 } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockExecuteCleanup).toHaveBeenCalledWith(1, 'unverified', 30);
    expect(res._json).toEqual({ deleted: 5 });
  });

  it('passes adminId from req.user', async () => {
    mockExecuteCleanup.mockResolvedValue({ deleted: 2 });
    const req = mockReq({
      user: { userId: 42, username: 'superadmin', role: 'admin' },
      body: { type: 'inactive', days: 60 },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockExecuteCleanup).toHaveBeenCalledWith(42, 'inactive', 60);
  });

  it('handles deactivated cleanup without days', async () => {
    mockExecuteCleanup.mockResolvedValue({ deleted: 1 });
    const req = mockReq({ body: { type: 'deactivated' } });
    const res = mockRes();
    await handler(req, res, jest.fn());
    expect(mockExecuteCleanup).toHaveBeenCalledWith(1, 'deactivated', undefined);
  });

  it('passes errors to next()', async () => {
    const err = new Error('delete failed');
    mockExecuteCleanup.mockRejectedValue(err);
    const req = mockReq({ body: { type: 'deactivated' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('has adminOnlyMiddleware', () => {
    expect(hasAdminOnly('post', '/admin/users/cleanup/execute')).toBe(true);
  });
});

// ============================================================================
// MIDDLEWARE PRESENCE — Router-level use() and inline adminOnlyMiddleware
// ============================================================================

describe('Middleware presence', () => {
  it('router.use(authMiddleware, staffMiddleware) is present as non-route layers', () => {
    const stack = (adminRouter as any).stack as RouteLayer[];
    // The router.use() call creates non-route layers in the stack
    const useLayers = stack.filter((l) => !l.route);
    // authMiddleware and staffMiddleware should be among the use-layers
    const useHandles = useLayers.map((l) => l.handle);
    expect(useHandles).toContain(mockAuthMiddleware);
    expect(useHandles).toContain(mockStaffMiddleware);
  });

  it('public routes are defined before the use() middleware layer', () => {
    const stack = (adminRouter as any).stack as RouteLayer[];
    // Find the index of the authMiddleware use-layer
    const authUseIdx = stack.findIndex((l) => !l.route && l.handle === mockAuthMiddleware);
    expect(authUseIdx).toBeGreaterThan(-1);

    // These public routes should appear before the auth use-layer
    const publicRoutes = [
      { method: 'get', path: '/admin/settings/registration_enabled' },
      { method: 'get', path: '/admin/settings/recordings_enabled' },
      { method: 'get', path: '/admin/settings/game_defaults' },
      { method: 'get', path: '/admin/ai/active' },
      { method: 'get', path: '/admin/announcements/banner' },
    ];

    for (const { method, path } of publicRoutes) {
      const routeIdx = stack.findIndex((l) => l.route?.path === path && l.route!.methods[method]);
      expect(routeIdx).toBeGreaterThan(-1);
      expect(routeIdx).toBeLessThan(authUseIdx);
    }
  });

  it('admin-only routes have adminOnlyMiddleware in their route stack', () => {
    const adminOnlyRoutes = [
      { method: 'put', path: '/admin/settings/registration_enabled' },
      { method: 'put', path: '/admin/settings/recordings_enabled' },
      { method: 'put', path: '/admin/settings/game_defaults' },
      { method: 'put', path: '/admin/settings/simulation_defaults' },
      { method: 'get', path: '/admin/settings/email_settings' },
      { method: 'put', path: '/admin/settings/email_settings' },
      { method: 'post', path: '/admin/settings/email_settings/test' },
      { method: 'post', path: '/admin/users' },
      { method: 'put', path: '/admin/users/:id/role' },
      { method: 'put', path: '/admin/users/:id/deactivate' },
      { method: 'put', path: '/admin/users/:id/password' },
      { method: 'delete', path: '/admin/users/:id' },
      { method: 'post', path: '/admin/users/cleanup/preview' },
      { method: 'post', path: '/admin/users/cleanup/execute' },
      { method: 'get', path: '/admin/stats' },
      { method: 'delete', path: '/admin/matches/:id' },
      { method: 'delete', path: '/admin/matches' },
      { method: 'get', path: '/admin/actions' },
      { method: 'post', path: '/admin/announcements/banner' },
      { method: 'delete', path: '/admin/announcements/banner' },
      { method: 'delete', path: '/admin/replays/:matchId' },
      { method: 'get', path: '/admin/simulations' },
      { method: 'get', path: '/admin/simulations/:batchId' },
      { method: 'get', path: '/admin/simulations/:batchId/replay/:gameIndex' },
      { method: 'post', path: '/admin/simulations' },
      { method: 'delete', path: '/admin/simulations/:batchId' },
      { method: 'get', path: '/admin/ai' },
      { method: 'post', path: '/admin/ai' },
      { method: 'put', path: '/admin/ai/:id' },
      { method: 'put', path: '/admin/ai/:id/upload' },
      { method: 'get', path: '/admin/ai/:id/download' },
      { method: 'delete', path: '/admin/ai/:id' },
    ];

    for (const { method, path } of adminOnlyRoutes) {
      expect(hasAdminOnly(method, path)).toBe(true);
    }
  });

  it('staff-accessible routes do NOT have adminOnlyMiddleware in their route stack', () => {
    const staffRoutes = [
      { method: 'get', path: '/admin/users' },
      { method: 'get', path: '/admin/matches' },
      { method: 'get', path: '/admin/matches/:id' },
      { method: 'get', path: '/admin/rooms' },
      { method: 'post', path: '/admin/announcements/toast' },
      { method: 'get', path: '/admin/replays' },
      { method: 'get', path: '/admin/replays/:matchId' },
    ];

    for (const { method, path } of staffRoutes) {
      expect(hasAdminOnly(method, path)).toBe(false);
    }
  });
});

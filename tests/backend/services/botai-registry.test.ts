import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

// ── DB mock ─────────────────────────────────────────────────────────────────
const mockQuery = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
}));

// ── FS mock ─────────────────────────────────────────────────────────────────
const mockExistsSync = jest.fn<AnyFn>();
const mockReadFileSync = jest.fn<AnyFn>();
const mockMkdirSync = jest.fn<AnyFn>();
jest.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  },
}));

// ── Isolated runner mock ─────────────────────────────────────────────────────
// Untrusted custom AIs are now wrapped by IsolatedBotAI (runs in an isolated-vm isolate). Mock it
// so these unit tests exercise the registry's routing without loading the native addon or building
// isolates. (Mocking also avoids the `fs` mock breaking node-gyp-build's prebuild lookup.)
const MockIsolatedBotAI = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/IsolatedAIRunner', () => ({
  IsolatedBotAI: MockIsolatedBotAI,
  IsolatedEnemyAI: jest.fn(),
  disposeAI: jest.fn(),
}));

// ── Logger mock ─────────────────────────────────────────────────────────────
jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ── BotAI mock ──────────────────────────────────────────────────────────────
const MockBotAI = jest.fn<AnyFn>();
MockBotAI.prototype.generateInput = jest.fn();
jest.mock('../../../backend/src/game/BotAI', () => ({
  BotAI: MockBotAI,
  IBotAI: {},
}));

import { BotAIRegistry } from '../../../backend/src/services/botai-registry';

describe('BotAIRegistry', () => {
  let registry: BotAIRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new BotAIRegistry();
  });

  describe('constructor', () => {
    it('should register built-in BotAI on construction', () => {
      expect(registry.isLoaded('builtin')).toBe(true);
      expect(registry.getLoadedIds()).toContain('builtin');
    });
  });

  describe('initialize', () => {
    it('should create the AI base directory', async () => {
      mockQuery.mockResolvedValue([]);
      await registry.initialize();
      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('ai'), {
        recursive: true,
      });
    });

    it('should load active non-builtin AIs from the database', async () => {
      mockQuery.mockResolvedValue([
        { id: 'custom-1', name: 'Custom Bot', is_active: true, is_builtin: false },
        { id: 'custom-2', name: 'Another Bot', is_active: true, is_builtin: false },
      ]);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('compiled code');

      await registry.initialize();

      expect(registry.isLoaded('custom-1')).toBe(true);
      expect(registry.isLoaded('custom-2')).toBe(true);
      expect(registry.getLoadedIds()).toHaveLength(3); // builtin + 2 custom
    });

    it('should skip AIs whose compiled file is missing and continue with others', async () => {
      mockQuery.mockResolvedValue([
        { id: 'broken', name: 'Broken' },
        { id: 'good', name: 'Good' },
      ]);
      mockExistsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);
      mockReadFileSync.mockReturnValue('compiled code');

      await registry.initialize();

      expect(registry.isLoaded('broken')).toBe(false);
      expect(registry.isLoaded('good')).toBe(true);
    });

    it('should query only active non-builtin AIs', async () => {
      mockQuery.mockResolvedValue([]);
      await registry.initialize();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_active = TRUE AND is_builtin = FALSE'),
      );
    });
  });

  describe('loadAI', () => {
    it('should store the compiled code for an untrusted AI (no in-process eval)', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('var CustomBot = ...');

      registry.loadAI('custom-1');

      expect(mockExistsSync).toHaveBeenCalledWith(expect.stringContaining('compiled.js'));
      expect(mockReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining('compiled.js'),
        'utf-8',
      );
      expect(registry.isLoaded('custom-1')).toBe(true);
    });

    it('should throw when compiled file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(() => registry.loadAI('missing')).toThrow('Compiled AI file not found');
    });
  });

  describe('createInstance', () => {
    it('should create an isolate-backed instance for a loaded custom AI', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('CODE');

      registry.loadAI('custom-1');
      const instance = registry.createInstance('custom-1', 'hard', { width: 15, height: 15 });

      expect(instance).toBeDefined();
      // The registry passes the stored compiled code + ctor args to the isolated wrapper.
      expect(MockIsolatedBotAI).toHaveBeenCalledWith('CODE', 'hard', { width: 15, height: 15 });
      // The built-in must NOT be used for a successfully-loaded custom AI.
      expect(MockBotAI).not.toHaveBeenCalled();
    });

    it('should fall back to built-in BotAI if the isolate fails to build', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('CODE');
      MockIsolatedBotAI.mockImplementationOnce(() => {
        throw new Error('isolate boom');
      });

      registry.loadAI('custom-1');
      const instance = registry.createInstance('custom-1', 'normal', { width: 11, height: 11 });

      expect(instance).toBeDefined();
      expect(MockBotAI).toHaveBeenCalledWith('normal', { width: 11, height: 11 });
    });

    it('should fall back to built-in BotAI when requested AI is not found', () => {
      const instance = registry.createInstance('nonexistent', 'easy', { width: 11, height: 11 });
      expect(instance).toBeDefined();
      expect(MockBotAI).toHaveBeenCalledWith('easy', { width: 11, height: 11 });
    });

    it('should use builtin when aiId is undefined', () => {
      registry.createInstance(undefined, 'normal');
      expect(MockBotAI).toHaveBeenCalled();
    });
  });

  describe('unloadAI', () => {
    it('should remove a custom AI from the registry', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('CODE');

      registry.loadAI('custom-1');
      expect(registry.isLoaded('custom-1')).toBe(true);

      registry.unloadAI('custom-1');
      expect(registry.isLoaded('custom-1')).toBe(false);
    });
  });

  describe('reloadAI', () => {
    it('should unload and re-load the AI', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('CODE');

      registry.loadAI('custom-1');
      registry.reloadAI('custom-1');

      expect(registry.isLoaded('custom-1')).toBe(true);
      // re-read of compiled.js on reload (initial load + reload = 2)
      expect(mockReadFileSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('getLoadedIds', () => {
    it('should always include builtin even with no custom AIs loaded', () => {
      expect(registry.getLoadedIds()).toEqual(['builtin']);
    });

    it('should return builtin plus all custom loaded AI ids', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('CODE');

      registry.loadAI('custom-1');
      registry.loadAI('custom-2');

      const ids = registry.getLoadedIds();
      expect(ids).toHaveLength(3);
      expect(ids).toContain('builtin');
      expect(ids).toContain('custom-1');
      expect(ids).toContain('custom-2');
    });
  });
});

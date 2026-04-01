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

// ── Sandbox mock ────────────────────────────────────────────────────────────
const mockLoadBotAIInSandbox = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/botai-compiler', () => ({
  loadBotAIInSandbox: mockLoadBotAIInSandbox,
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

// ── Helper: mock bot AI class with generateInput() ──────────────────────────

function makeMockBotAIClass() {
  const MockClass = jest.fn<AnyFn>();
  MockClass.prototype.generateInput = jest.fn();
  return MockClass;
}

describe('BotAIRegistry', () => {
  let registry: BotAIRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new BotAIRegistry();
  });

  // ── constructor ────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('should register built-in BotAI on construction', () => {
      expect(registry.isLoaded('builtin')).toBe(true);
      expect(registry.getLoadedIds()).toContain('builtin');
    });
  });

  // ── initialize ─────────────────────────────────────────────────────────

  describe('initialize', () => {
    it('should create the AI base directory', async () => {
      mockQuery.mockResolvedValue([]);

      await registry.initialize();

      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('ai'), {
        recursive: true,
      });
    });

    it('should load active non-builtin AIs from the database', async () => {
      const MockClass = makeMockBotAIClass();
      mockQuery.mockResolvedValue([
        { id: 'custom-1', name: 'Custom Bot', is_active: true, is_builtin: false },
        { id: 'custom-2', name: 'Another Bot', is_active: true, is_builtin: false },
      ]);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('compiled code');
      mockLoadBotAIInSandbox.mockReturnValue({ default: MockClass });

      await registry.initialize();

      expect(registry.isLoaded('custom-1')).toBe(true);
      expect(registry.isLoaded('custom-2')).toBe(true);
      // builtin + 2 custom
      expect(registry.getLoadedIds()).toHaveLength(3);
    });

    it('should skip AIs that fail to load and continue with others', async () => {
      const MockClass = makeMockBotAIClass();
      mockQuery.mockResolvedValue([
        { id: 'broken', name: 'Broken' },
        { id: 'good', name: 'Good' },
      ]);
      // First AI: file not found, second AI: success
      mockExistsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);
      mockReadFileSync.mockReturnValue('compiled code');
      mockLoadBotAIInSandbox.mockReturnValue({ default: MockClass });

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

  // ── loadAI ─────────────────────────────────────────────────────────────

  describe('loadAI', () => {
    it('should load an AI from compiled.js via sandbox and register it', () => {
      const MockClass = makeMockBotAIClass();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('var CustomBot = ...');
      mockLoadBotAIInSandbox.mockReturnValue({ default: MockClass });

      registry.loadAI('custom-1');

      expect(mockExistsSync).toHaveBeenCalledWith(expect.stringContaining('compiled.js'));
      expect(mockLoadBotAIInSandbox).toHaveBeenCalledWith('var CustomBot = ...');
      expect(registry.isLoaded('custom-1')).toBe(true);
    });

    it('should throw when compiled file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      expect(() => registry.loadAI('missing')).toThrow('Compiled AI file not found');
    });

    it('should throw when no class with generateInput() is found in module', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('code');
      mockLoadBotAIInSandbox.mockReturnValue({ default: 'not a class' });

      expect(() => registry.loadAI('bad')).toThrow('No class with generateInput() found');
    });

    it('should find AI class as module.exports = Class (mod itself is constructor)', () => {
      const MockClass = makeMockBotAIClass();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('code');
      mockLoadBotAIInSandbox.mockReturnValue(MockClass);

      registry.loadAI('direct-export');

      expect(registry.isLoaded('direct-export')).toBe(true);
    });

    it('should find AI class from named exports when default is not a class', () => {
      const MockClass = makeMockBotAIClass();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('code');
      mockLoadBotAIInSandbox.mockReturnValue({ MyCustomBot: MockClass });

      registry.loadAI('named-export');

      expect(registry.isLoaded('named-export')).toBe(true);
    });
  });

  // ── createInstance ─────────────────────────────────────────────────────

  describe('createInstance', () => {
    it('should create an instance using the loaded constructor', () => {
      const MockClass = makeMockBotAIClass();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('code');
      mockLoadBotAIInSandbox.mockReturnValue({ default: MockClass });

      registry.loadAI('custom-1');
      const instance = registry.createInstance('custom-1', 'hard', { width: 15, height: 15 });

      expect(instance).toBeDefined();
      expect(MockClass).toHaveBeenCalledWith('hard', { width: 15, height: 15 });
    });

    it('should fall back to built-in BotAI when requested AI is not found', () => {
      const instance = registry.createInstance('nonexistent', 'easy', { width: 11, height: 11 });

      expect(instance).toBeDefined();
      expect(MockBotAI).toHaveBeenCalledWith('easy', { width: 11, height: 11 });
    });

    it('should use builtin when aiId is undefined', () => {
      registry.createInstance(undefined, 'normal');

      // Should use the builtin constructor (MockBotAI is registered as builtin)
      expect(MockBotAI).toHaveBeenCalled();
    });
  });

  // ── unloadAI ───────────────────────────────────────────────────────────

  describe('unloadAI', () => {
    it('should remove a custom AI from the registry', () => {
      const MockClass = makeMockBotAIClass();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('code');
      mockLoadBotAIInSandbox.mockReturnValue({ default: MockClass });

      registry.loadAI('custom-1');
      expect(registry.isLoaded('custom-1')).toBe(true);

      registry.unloadAI('custom-1');
      expect(registry.isLoaded('custom-1')).toBe(false);
    });

    it('should be a no-op when trying to unload builtin', () => {
      registry.unloadAI('builtin');

      // Builtin should still be loaded
      expect(registry.isLoaded('builtin')).toBe(true);
    });
  });

  // ── reloadAI ───────────────────────────────────────────────────────────

  describe('reloadAI', () => {
    it('should unload and re-load the AI', () => {
      const MockClass1 = makeMockBotAIClass();
      const MockClass2 = makeMockBotAIClass();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('code');
      mockLoadBotAIInSandbox
        .mockReturnValueOnce({ default: MockClass1 })
        .mockReturnValueOnce({ default: MockClass2 });

      registry.loadAI('custom-1');
      registry.reloadAI('custom-1');

      expect(registry.isLoaded('custom-1')).toBe(true);
      expect(mockLoadBotAIInSandbox).toHaveBeenCalledTimes(2);
    });
  });

  // ── getLoadedIds ───────────────────────────────────────────────────────

  describe('getLoadedIds', () => {
    it('should always include builtin even with no custom AIs loaded', () => {
      const ids = registry.getLoadedIds();

      expect(ids).toEqual(['builtin']);
    });

    it('should return builtin plus all custom loaded AI ids', () => {
      const MockClass = makeMockBotAIClass();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('code');
      mockLoadBotAIInSandbox.mockReturnValue({ default: MockClass });

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

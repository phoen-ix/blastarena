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

import { EnemyAIRegistry } from '../../../backend/src/services/enemyai-registry';

// ── Helper: mock enemy AI class with decide() ──────────────────────────────

function makeMockEnemyAIClass() {
  const MockClass = jest.fn<AnyFn>();
  MockClass.prototype.decide = jest.fn();
  return MockClass;
}

describe('EnemyAIRegistry', () => {
  let registry: EnemyAIRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new EnemyAIRegistry();
  });

  // ── initialize ─────────────────────────────────────────────────────────

  describe('initialize', () => {
    it('should create the enemy-ai base directory', async () => {
      mockQuery.mockResolvedValue([]);

      await registry.initialize();

      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('enemy-ai'), {
        recursive: true,
      });
    });

    it('should load all active enemy AIs from the database', async () => {
      const MockClass = makeMockEnemyAIClass();
      mockQuery.mockResolvedValue([
        { id: 'ai-1', name: 'Chaser', is_active: true },
        { id: 'ai-2', name: 'Patrol', is_active: true },
      ]);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('compiled code');
      mockLoadBotAIInSandbox.mockReturnValue({ default: MockClass });

      await registry.initialize();

      expect(registry.isLoaded('ai-1')).toBe(true);
      expect(registry.isLoaded('ai-2')).toBe(true);
      expect(registry.getLoadedIds()).toHaveLength(2);
    });

    it('should skip AIs that fail to load and continue with others', async () => {
      const MockClass = makeMockEnemyAIClass();
      mockQuery.mockResolvedValue([
        { id: 'broken-ai', name: 'Broken' },
        { id: 'good-ai', name: 'Good' },
      ]);
      // First AI: file not found, second AI: success
      mockExistsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);
      mockReadFileSync.mockReturnValue('compiled code');
      mockLoadBotAIInSandbox.mockReturnValue({ default: MockClass });

      await registry.initialize();

      expect(registry.isLoaded('broken-ai')).toBe(false);
      expect(registry.isLoaded('good-ai')).toBe(true);
    });
  });

  // ── loadAI ─────────────────────────────────────────────────────────────

  describe('loadAI', () => {
    it('should load an AI from compiled.js via sandbox and register it', () => {
      const MockClass = makeMockEnemyAIClass();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('var EnemyAI = ...');
      mockLoadBotAIInSandbox.mockReturnValue({ default: MockClass });

      registry.loadAI('ai-1');

      expect(mockExistsSync).toHaveBeenCalledWith(expect.stringContaining('compiled.js'));
      expect(mockReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining('compiled.js'),
        'utf-8',
      );
      expect(mockLoadBotAIInSandbox).toHaveBeenCalledWith('var EnemyAI = ...');
      expect(registry.isLoaded('ai-1')).toBe(true);
    });

    it('should throw when compiled file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      expect(() => registry.loadAI('missing-ai')).toThrow('Compiled enemy AI file not found');
    });

    it('should throw when no class with decide() is found in module', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('code');
      // Return a module with no decide() method
      mockLoadBotAIInSandbox.mockReturnValue({ default: 'not a class' });

      expect(() => registry.loadAI('bad-ai')).toThrow('No class with decide() found');
    });

    it('should find AI class as module.exports = Class (mod itself is constructor)', () => {
      const MockClass = makeMockEnemyAIClass();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('code');
      // mod itself is the constructor function with decide
      mockLoadBotAIInSandbox.mockReturnValue(MockClass);

      registry.loadAI('direct-export');

      expect(registry.isLoaded('direct-export')).toBe(true);
    });

    it('should find AI class from named exports when default is not a class', () => {
      const MockClass = makeMockEnemyAIClass();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('code');
      // No default export, but a named export with decide()
      mockLoadBotAIInSandbox.mockReturnValue({ SomeEnemyAI: MockClass });

      registry.loadAI('named-export');

      expect(registry.isLoaded('named-export')).toBe(true);
    });
  });

  // ── createInstance ─────────────────────────────────────────────────────

  describe('createInstance', () => {
    it('should create a new instance using the loaded constructor', () => {
      const MockClass = makeMockEnemyAIClass();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('code');
      mockLoadBotAIInSandbox.mockReturnValue({ default: MockClass });

      registry.loadAI('ai-1');
      const instance = registry.createInstance('ai-1', 'normal', { speed: 1 } as never);

      expect(instance).not.toBeNull();
      expect(MockClass).toHaveBeenCalledWith('normal', { speed: 1 });
    });

    it('should return null when the AI is not loaded', () => {
      const instance = registry.createInstance('nonexistent', 'hard', {} as never);

      expect(instance).toBeNull();
    });
  });

  // ── unloadAI ───────────────────────────────────────────────────────────

  describe('unloadAI', () => {
    it('should remove a loaded AI from the registry', () => {
      const MockClass = makeMockEnemyAIClass();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('code');
      mockLoadBotAIInSandbox.mockReturnValue({ default: MockClass });

      registry.loadAI('ai-1');
      expect(registry.isLoaded('ai-1')).toBe(true);

      registry.unloadAI('ai-1');
      expect(registry.isLoaded('ai-1')).toBe(false);
    });
  });

  // ── reloadAI ───────────────────────────────────────────────────────────

  describe('reloadAI', () => {
    it('should unload and re-load the AI', () => {
      const MockClass1 = makeMockEnemyAIClass();
      const MockClass2 = makeMockEnemyAIClass();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('code');
      mockLoadBotAIInSandbox
        .mockReturnValueOnce({ default: MockClass1 })
        .mockReturnValueOnce({ default: MockClass2 });

      registry.loadAI('ai-1');
      registry.reloadAI('ai-1');

      expect(registry.isLoaded('ai-1')).toBe(true);
      // Sandbox was called twice (initial load + reload)
      expect(mockLoadBotAIInSandbox).toHaveBeenCalledTimes(2);
    });
  });

  // ── getLoadedIds ───────────────────────────────────────────────────────

  describe('getLoadedIds', () => {
    it('should return empty array when nothing is loaded', () => {
      expect(registry.getLoadedIds()).toEqual([]);
    });

    it('should return all loaded AI ids', () => {
      const MockClass = makeMockEnemyAIClass();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('code');
      mockLoadBotAIInSandbox.mockReturnValue({ default: MockClass });

      registry.loadAI('ai-1');
      registry.loadAI('ai-2');

      const ids = registry.getLoadedIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain('ai-1');
      expect(ids).toContain('ai-2');
    });
  });
});

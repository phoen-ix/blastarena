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

// ── Sandbox mock (used to load TRUSTED seeded AIs in-process) ────────────────
const mockLoadBotAIInSandbox = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/botai-compiler', () => ({
  loadBotAIInSandbox: mockLoadBotAIInSandbox,
}));

// ── Isolated runner mock (used for UNTRUSTED uploads) ────────────────────────
const MockIsolatedEnemyAI = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/IsolatedAIRunner', () => ({
  IsolatedEnemyAI: MockIsolatedEnemyAI,
  IsolatedBotAI: jest.fn(),
  disposeAI: jest.fn(),
}));

// ── Logger mock ─────────────────────────────────────────────────────────────
jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { EnemyAIRegistry } from '../../../backend/src/services/enemyai-registry';

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

  describe('initialize', () => {
    it('should create the enemy-ai base directory', async () => {
      mockQuery.mockResolvedValue([]);
      await registry.initialize();
      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('enemy-ai'), {
        recursive: true,
      });
    });

    it('loads seeded AIs (uploaded_by NULL) in-process and uploads in isolates', async () => {
      const MockClass = makeMockEnemyAIClass();
      mockQuery.mockResolvedValue([
        { id: 'seed-1', name: 'Hunter', is_active: true, uploaded_by: null },
        { id: 'upload-1', name: 'Custom', is_active: true, uploaded_by: 7 },
      ]);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('compiled code');
      mockLoadBotAIInSandbox.mockReturnValue({ default: MockClass });

      await registry.initialize();

      expect(registry.isLoaded('seed-1')).toBe(true);
      expect(registry.isLoaded('upload-1')).toBe(true);
      expect(registry.getLoadedIds()).toHaveLength(2);
      // The trusted seed went through the in-process loader; the upload did NOT.
      expect(mockLoadBotAIInSandbox).toHaveBeenCalledTimes(1);
    });

    it('should skip AIs whose compiled file is missing and continue with others', async () => {
      mockQuery.mockResolvedValue([
        { id: 'broken-ai', name: 'Broken', uploaded_by: 1 },
        { id: 'good-ai', name: 'Good', uploaded_by: 1 },
      ]);
      mockExistsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);
      mockReadFileSync.mockReturnValue('compiled code');

      await registry.initialize();

      expect(registry.isLoaded('broken-ai')).toBe(false);
      expect(registry.isLoaded('good-ai')).toBe(true);
    });
  });

  describe('loadAI', () => {
    it('untrusted (default): stores compiled code without in-process eval', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('var EnemyAI = ...');

      registry.loadAI('upload-1');

      expect(mockReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining('compiled.js'),
        'utf-8',
      );
      expect(mockLoadBotAIInSandbox).not.toHaveBeenCalled();
      expect(registry.isLoaded('upload-1')).toBe(true);
    });

    it('trusted: loads the class in-process via the sandbox loader', () => {
      const MockClass = makeMockEnemyAIClass();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('var EnemyAI = ...');
      mockLoadBotAIInSandbox.mockReturnValue({ default: MockClass });

      registry.loadAI('seed-1', true);

      expect(mockLoadBotAIInSandbox).toHaveBeenCalledWith('var EnemyAI = ...');
      expect(registry.isLoaded('seed-1')).toBe(true);
    });

    it('should throw when compiled file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(() => registry.loadAI('missing-ai')).toThrow('Compiled enemy AI file not found');
    });

    it('trusted: throws when no class with decide() is found', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('code');
      mockLoadBotAIInSandbox.mockReturnValue({ default: 'not a class' });

      expect(() => registry.loadAI('bad-ai', true)).toThrow('No class with decide() found');
    });
  });

  describe('createInstance', () => {
    it('trusted: instantiates the in-process class', () => {
      const MockClass = makeMockEnemyAIClass();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('code');
      mockLoadBotAIInSandbox.mockReturnValue({ default: MockClass });

      registry.loadAI('seed-1', true);
      const instance = registry.createInstance('seed-1', 'normal', { speed: 1 } as never);

      expect(instance).not.toBeNull();
      expect(MockClass).toHaveBeenCalledWith('normal', { speed: 1 });
      expect(MockIsolatedEnemyAI).not.toHaveBeenCalled();
    });

    it('untrusted: creates an isolate-backed instance', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('CODE');

      registry.loadAI('upload-1'); // untrusted by default
      const instance = registry.createInstance('upload-1', 'hard', { speed: 2 } as never);

      expect(instance).not.toBeNull();
      expect(MockIsolatedEnemyAI).toHaveBeenCalledWith('CODE', 'hard', { speed: 2 });
    });

    it('untrusted: returns null if the isolate fails to build', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('CODE');
      MockIsolatedEnemyAI.mockImplementationOnce(() => {
        throw new Error('isolate boom');
      });

      registry.loadAI('upload-1');
      expect(registry.createInstance('upload-1', 'normal', {} as never)).toBeNull();
    });

    it('should return null when the AI is not loaded', () => {
      expect(registry.createInstance('nonexistent', 'hard', {} as never)).toBeNull();
    });
  });

  describe('unloadAI / reloadAI / getLoadedIds', () => {
    it('unloadAI removes a loaded AI', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('CODE');
      registry.loadAI('upload-1');
      expect(registry.isLoaded('upload-1')).toBe(true);
      registry.unloadAI('upload-1');
      expect(registry.isLoaded('upload-1')).toBe(false);
    });

    it('reloadAI re-reads the compiled file', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('CODE');
      registry.loadAI('upload-1');
      registry.reloadAI('upload-1');
      expect(registry.isLoaded('upload-1')).toBe(true);
      expect(mockReadFileSync).toHaveBeenCalledTimes(2);
    });

    it('getLoadedIds returns all loaded ids', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('CODE');
      registry.loadAI('a');
      registry.loadAI('b');
      const ids = registry.getLoadedIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
    });
  });
});

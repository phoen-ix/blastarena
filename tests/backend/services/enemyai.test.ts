import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

// ── DB mocks ────────────────────────────────────────────────────────────────
const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
}));

// ── Compiler mock ───────────────────────────────────────────────────────────
const mockCompileEnemyAI = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/enemyai-compiler', () => ({
  compileEnemyAI: mockCompileEnemyAI,
}));

// ── Registry mock ───────────────────────────────────────────────────────────
const mockLoadAI = jest.fn<AnyFn>();
const mockUnloadAI = jest.fn<AnyFn>();
const mockReloadAI = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/enemyai-registry', () => ({
  getEnemyAIRegistry: () => ({
    loadAI: mockLoadAI,
    unloadAI: mockUnloadAI,
    reloadAI: mockReloadAI,
  }),
}));

// ── FS mock ─────────────────────────────────────────────────────────────────
const mockMkdirSync = jest.fn<AnyFn>();
const mockWriteFileSync = jest.fn<AnyFn>();
const mockExistsSync = jest.fn<AnyFn>();
const mockRmSync = jest.fn<AnyFn>();
const mockReadFileSync = jest.fn<AnyFn>();
jest.mock('fs', () => ({
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  rmSync: (...args: unknown[]) => mockRmSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  default: {
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    rmSync: (...args: unknown[]) => mockRmSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  },
}));

// ── UUID mock ───────────────────────────────────────────────────────────────
const FIXED_UUID = 'test-uuid-123';
jest.mock('uuid', () => ({
  v4: () => FIXED_UUID,
}));

// ── Logger mock ─────────────────────────────────────────────────────────────
jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  listAllEnemyAIs,
  listActiveEnemyAIs,
  getEnemyAI,
  getEnemyAIByName,
  uploadEnemyAI,
  uploadEnemyAIFromSource,
  updateEnemyAI,
  reuploadEnemyAI,
  deleteEnemyAI,
  downloadEnemyAISource,
} from '../../../backend/src/services/enemyai';

// ── Helper factories ────────────────────────────────────────────────────────

function makeAIRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'enemy-ai-1',
    name: 'Test Enemy AI',
    description: 'A test enemy AI',
    filename: 'enemy.ts',
    is_active: true,
    uploaded_by: 1,
    uploader_username: 'admin',
    uploaded_at: new Date('2025-01-01T00:00:00Z'),
    version: 1,
    file_size: 200,
    ...overrides,
  };
}

describe('EnemyAI Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── rowToEntry mapping (tested via public functions) ────────────────────

  describe('rowToEntry mapping', () => {
    it('should map snake_case DB row to camelCase EnemyAIEntry', async () => {
      const row = makeAIRow();
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyAI('enemy-ai-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('enemy-ai-1');
      expect(result!.name).toBe('Test Enemy AI');
      expect(result!.description).toBe('A test enemy AI');
      expect(result!.filename).toBe('enemy.ts');
      expect(result!.isActive).toBe(true);
      expect(result!.uploadedBy).toBe('admin');
      expect(result!.uploadedAt).toBe('2025-01-01T00:00:00.000Z');
      expect(result!.version).toBe(1);
      expect(result!.fileSize).toBe(200);
    });

    it('should convert boolean-like is_active to boolean', async () => {
      const row = makeAIRow({ is_active: 1 });
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyAI('enemy-ai-1');
      expect(result!.isActive).toBe(true);
    });

    it('should convert falsy is_active to false', async () => {
      const row = makeAIRow({ is_active: 0 });
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyAI('enemy-ai-1');
      expect(result!.isActive).toBe(false);
    });

    it('should return null uploadedBy when uploader_username is missing', async () => {
      const row = makeAIRow({ uploader_username: undefined });
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyAI('enemy-ai-1');
      expect(result!.uploadedBy).toBeNull();
    });

    it('should handle null description by defaulting to empty string', async () => {
      const row = makeAIRow({ description: null });
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyAI('enemy-ai-1');
      expect(result!.description).toBe('');
    });

    it('should convert non-Date uploaded_at to string', async () => {
      const row = makeAIRow({ uploaded_at: '2025-06-15 12:00:00' });
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyAI('enemy-ai-1');
      expect(result!.uploadedAt).toBe('2025-06-15 12:00:00');
    });
  });

  // ── listAllEnemyAIs ────────────────────────────────────────────────────

  describe('listAllEnemyAIs', () => {
    it('should return mapped entries for all enemy AIs', async () => {
      const rows = [
        makeAIRow({ id: 'ai-1', name: 'Chaser AI' }),
        makeAIRow({ id: 'ai-2', name: 'Patrol AI' }),
      ];
      mockQuery.mockResolvedValue(rows);

      const result = await listAllEnemyAIs();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('ai-1');
      expect(result[1].id).toBe('ai-2');
    });

    it('should return empty array when no enemy AIs exist', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await listAllEnemyAIs();

      expect(result).toEqual([]);
    });

    it('should query with ORDER BY uploaded_at DESC', async () => {
      mockQuery.mockResolvedValue([]);

      await listAllEnemyAIs();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY ea.uploaded_at DESC'),
      );
    });
  });

  // ── listActiveEnemyAIs ─────────────────────────────────────────────────

  describe('listActiveEnemyAIs', () => {
    it('should return only active enemy AIs', async () => {
      const rows = [makeAIRow({ id: 'active-1', is_active: true })];
      mockQuery.mockResolvedValue(rows);

      const result = await listActiveEnemyAIs();

      expect(result).toHaveLength(1);
      expect(result[0].isActive).toBe(true);
    });

    it('should query with is_active = TRUE filter', async () => {
      mockQuery.mockResolvedValue([]);

      await listActiveEnemyAIs();

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE ea.is_active = TRUE'));
    });
  });

  // ── getEnemyAI ─────────────────────────────────────────────────────────

  describe('getEnemyAI', () => {
    it('should return entry when AI is found', async () => {
      const row = makeAIRow();
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyAI('enemy-ai-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('enemy-ai-1');
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE ea.id = ?'), [
        'enemy-ai-1',
      ]);
    });

    it('should return null when AI is not found', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getEnemyAI('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ── getEnemyAIByName ───────────────────────────────────────────────────

  describe('getEnemyAIByName', () => {
    it('should return entry when AI is found by name', async () => {
      const row = makeAIRow({ name: 'Chaser' });
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyAIByName('Chaser');

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Chaser');
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE ea.name = ?'), [
        'Chaser',
      ]);
    });

    it('should return null when no AI with that name exists', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getEnemyAIByName('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ── uploadEnemyAI ──────────────────────────────────────────────────────

  describe('uploadEnemyAI', () => {
    const source = 'export class TestEnemy { decide() { return { direction: null }; } }';
    const fileBuffer = Buffer.from(source);

    it('should compile, write files, insert DB, load registry, and audit log on success', async () => {
      mockCompileEnemyAI.mockResolvedValue({
        success: true,
        compiledCode: 'var TestEnemy = ...;',
        errors: [],
      });
      mockExecute.mockResolvedValue({});
      mockQuery.mockResolvedValue([makeAIRow({ id: FIXED_UUID, name: 'My Enemy' })]);

      const result = await uploadEnemyAI('My Enemy', 'desc', fileBuffer, 'enemy.ts', 1);

      expect(result.errors).toBeUndefined();
      expect(result.entry).not.toBeNull();
      expect(result.entry.id).toBe(FIXED_UUID);

      // Compiled
      expect(mockCompileEnemyAI).toHaveBeenCalledWith(source);

      // Created directory
      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining(FIXED_UUID), {
        recursive: true,
      });

      // Wrote source and compiled files
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
      expect(mockWriteFileSync).toHaveBeenCalledWith(expect.stringContaining('source.ts'), source);
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('compiled.js'),
        'var TestEnemy = ...;',
      );

      // Inserted DB row
      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO enemy_ais'), [
        FIXED_UUID,
        'My Enemy',
        'desc',
        'enemy.ts',
        1,
        Buffer.byteLength(source),
      ]);

      // Loaded into registry
      expect(mockLoadAI).toHaveBeenCalledWith(FIXED_UUID);

      // Audit logged
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admin_actions'),
        expect.arrayContaining([1, 'upload_enemy_ai', 'enemy_ai', 0]),
      );
    });

    it('should return errors without writing files when compilation fails', async () => {
      mockCompileEnemyAI.mockResolvedValue({
        success: false,
        errors: ['Syntax error', 'Missing export'],
      });

      const result = await uploadEnemyAI('Bad Enemy', 'desc', fileBuffer, 'bad.ts', 1);

      expect(result.errors).toEqual(['Syntax error', 'Missing export']);
      expect(result.entry).toBeNull();

      // Should not write files, insert DB, or load registry
      expect(mockMkdirSync).not.toHaveBeenCalled();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
      expect(mockLoadAI).not.toHaveBeenCalled();
    });

    it('should calculate file_size from source buffer byte length', async () => {
      const unicodeSource = 'export class AI { /* éàü */ decide() { return {}; } }';
      const unicodeBuffer = Buffer.from(unicodeSource);
      mockCompileEnemyAI.mockResolvedValue({
        success: true,
        compiledCode: 'compiled;',
        errors: [],
      });
      mockExecute.mockResolvedValue({});
      mockQuery.mockResolvedValue([makeAIRow({ id: FIXED_UUID })]);

      await uploadEnemyAI('AI', '', unicodeBuffer, 'f.ts', 1);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO enemy_ais'),
        expect.arrayContaining([Buffer.byteLength(unicodeSource)]),
      );
    });
  });

  // ── uploadEnemyAIFromSource ────────────────────────────────────────────

  describe('uploadEnemyAIFromSource', () => {
    const source = 'export class ImportedEnemy { decide() { return {}; } }';

    it('should compile from source string and create AI entry', async () => {
      mockCompileEnemyAI.mockResolvedValue({
        success: true,
        compiledCode: 'var ImportedEnemy = ...;',
        errors: [],
      });
      mockExecute.mockResolvedValue({});
      mockQuery.mockResolvedValue([makeAIRow({ id: FIXED_UUID, name: 'Imported' })]);

      const result = await uploadEnemyAIFromSource('Imported', 'from import', source, 'imp.ts', 2);

      expect(result.entry).not.toBeNull();
      expect(result.errors).toBeUndefined();
      expect(mockCompileEnemyAI).toHaveBeenCalledWith(source);
      expect(mockMkdirSync).toHaveBeenCalled();
      expect(mockWriteFileSync).toHaveBeenCalledWith(expect.stringContaining('source.ts'), source);
      expect(mockLoadAI).toHaveBeenCalledWith(FIXED_UUID);
    });

    it('should return null entry with errors when compilation fails', async () => {
      mockCompileEnemyAI.mockResolvedValue({
        success: false,
        errors: ['Invalid AI class'],
      });

      const result = await uploadEnemyAIFromSource('Bad', 'desc', source, 'f.ts', 2);

      expect(result.entry).toBeNull();
      expect(result.errors).toEqual(['Invalid AI class']);
      expect(mockMkdirSync).not.toHaveBeenCalled();
    });

    it('should include source:import in audit log details', async () => {
      mockCompileEnemyAI.mockResolvedValue({
        success: true,
        compiledCode: 'compiled;',
        errors: [],
      });
      mockExecute.mockResolvedValue({});
      mockQuery.mockResolvedValue([makeAIRow({ id: FIXED_UUID })]);

      await uploadEnemyAIFromSource('AI', 'desc', source, 'f.ts', 2);

      const auditCall = mockExecute.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('admin_actions'),
      );
      expect(auditCall).toBeDefined();
      const details = JSON.parse(auditCall![1][4] as string);
      expect(details.source).toBe('import');
    });
  });

  // ── updateEnemyAI ──────────────────────────────────────────────────────

  describe('updateEnemyAI', () => {
    it('should update name in DB and audit log', async () => {
      mockQuery.mockResolvedValue([makeAIRow()]);
      mockExecute.mockResolvedValue({});

      await updateEnemyAI('enemy-ai-1', { name: 'New Name' }, 1);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE enemy_ais SET name = ?'),
        ['New Name', 'enemy-ai-1'],
      );
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admin_actions'),
        expect.arrayContaining([1, 'update_enemy_ai', 'enemy_ai', 0]),
      );
    });

    it('should update description', async () => {
      mockQuery.mockResolvedValue([makeAIRow()]);
      mockExecute.mockResolvedValue({});

      await updateEnemyAI('enemy-ai-1', { description: 'New desc' }, 1);

      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('description = ?'), [
        'New desc',
        'enemy-ai-1',
      ]);
    });

    it('should load AI in registry when activating', async () => {
      mockQuery.mockResolvedValue([makeAIRow({ is_active: false })]);
      mockExecute.mockResolvedValue({});

      await updateEnemyAI('enemy-ai-1', { isActive: true }, 1);

      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('is_active = ?'), [
        true,
        'enemy-ai-1',
      ]);
      expect(mockLoadAI).toHaveBeenCalledWith('enemy-ai-1');
    });

    it('should unload AI from registry when deactivating', async () => {
      mockQuery.mockResolvedValue([makeAIRow({ is_active: true })]);
      mockExecute.mockResolvedValue({});

      await updateEnemyAI('enemy-ai-1', { isActive: false }, 1);

      expect(mockUnloadAI).toHaveBeenCalledWith('enemy-ai-1');
    });

    it('should throw when AI not found', async () => {
      mockQuery.mockResolvedValue([]);

      await expect(updateEnemyAI('nonexistent', { name: 'Nope' }, 1)).rejects.toThrow(
        'Enemy AI not found',
      );
    });

    it('should return early without DB update when no updates provided', async () => {
      mockQuery.mockResolvedValue([makeAIRow()]);

      await updateEnemyAI('enemy-ai-1', {}, 1);

      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should build SET clause with multiple fields', async () => {
      mockQuery.mockResolvedValue([makeAIRow()]);
      mockExecute.mockResolvedValue({});

      await updateEnemyAI('enemy-ai-1', { name: 'X', description: 'Y', isActive: true }, 1);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('name = ?, description = ?, is_active = ?'),
        ['X', 'Y', true, 'enemy-ai-1'],
      );
    });

    it('should catch and log error when loadAI fails on activate', async () => {
      mockQuery.mockResolvedValue([makeAIRow()]);
      mockExecute.mockResolvedValue({});
      mockLoadAI.mockImplementation(() => {
        throw new Error('load failed');
      });

      // Should not throw — error is caught internally
      await expect(updateEnemyAI('enemy-ai-1', { isActive: true }, 1)).resolves.not.toThrow();
    });
  });

  // ── reuploadEnemyAI ────────────────────────────────────────────────────

  describe('reuploadEnemyAI', () => {
    const source = 'export class ReEnemy { decide() { return {}; } }';
    const fileBuffer = Buffer.from(source);

    it('should recompile, write files, update DB version, and reload if active', async () => {
      mockQuery.mockResolvedValue([makeAIRow({ is_active: true })]);
      mockCompileEnemyAI.mockResolvedValue({
        success: true,
        compiledCode: 'var ReEnemy = ...;',
        errors: [],
      });
      mockExecute.mockResolvedValue({});

      const result = await reuploadEnemyAI('enemy-ai-1', fileBuffer, 'reenemy.ts', 1);

      expect(result.success).toBe(true);
      expect(result.errors).toBeUndefined();

      // Compiled
      expect(mockCompileEnemyAI).toHaveBeenCalledWith(source);

      // Wrote updated files
      expect(mockWriteFileSync).toHaveBeenCalledWith(expect.stringContaining('source.ts'), source);
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('compiled.js'),
        'var ReEnemy = ...;',
      );

      // Updated DB with version increment
      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('version = version + 1'), [
        'reenemy.ts',
        Buffer.byteLength(source),
        'enemy-ai-1',
      ]);

      // Reloaded because active
      expect(mockReloadAI).toHaveBeenCalledWith('enemy-ai-1');

      // Audit logged
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admin_actions'),
        expect.arrayContaining([1, 'reupload_enemy_ai', 'enemy_ai', 0]),
      );
    });

    it('should not reload registry when AI is inactive', async () => {
      mockQuery.mockResolvedValue([makeAIRow({ is_active: false })]);
      mockCompileEnemyAI.mockResolvedValue({
        success: true,
        compiledCode: 'compiled;',
        errors: [],
      });
      mockExecute.mockResolvedValue({});

      const result = await reuploadEnemyAI('enemy-ai-1', fileBuffer, 'f.ts', 1);

      expect(result.success).toBe(true);
      expect(mockReloadAI).not.toHaveBeenCalled();
    });

    it('should return errors when compilation fails', async () => {
      mockQuery.mockResolvedValue([makeAIRow()]);
      mockCompileEnemyAI.mockResolvedValue({
        success: false,
        errors: ['Type error at line 5'],
      });

      const result = await reuploadEnemyAI('enemy-ai-1', fileBuffer, 'f.ts', 1);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(['Type error at line 5']);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should throw when AI not found', async () => {
      mockQuery.mockResolvedValue([]);

      await expect(reuploadEnemyAI('nonexistent', fileBuffer, 'f.ts', 1)).rejects.toThrow(
        'Enemy AI not found',
      );
    });

    it('should catch and log error when reloadAI fails after re-upload', async () => {
      mockQuery.mockResolvedValue([makeAIRow({ is_active: true })]);
      mockCompileEnemyAI.mockResolvedValue({
        success: true,
        compiledCode: 'compiled;',
        errors: [],
      });
      mockExecute.mockResolvedValue({});
      mockReloadAI.mockImplementation(() => {
        throw new Error('reload failed');
      });

      // Should not throw — error is caught internally
      const result = await reuploadEnemyAI('enemy-ai-1', fileBuffer, 'f.ts', 1);
      expect(result.success).toBe(true);
    });
  });

  // ── deleteEnemyAI ──────────────────────────────────────────────────────

  describe('deleteEnemyAI', () => {
    it('should unload registry, delete files, delete DB row, and audit log', async () => {
      mockQuery.mockResolvedValue([makeAIRow({ name: 'Doomed Enemy' })]);
      mockExistsSync.mockReturnValue(true);
      mockExecute.mockResolvedValue({});

      await deleteEnemyAI('enemy-ai-1', 1);

      // Unloaded from registry
      expect(mockUnloadAI).toHaveBeenCalledWith('enemy-ai-1');

      // Checked and removed directory
      expect(mockExistsSync).toHaveBeenCalledWith(expect.stringContaining('enemy-ai-1'));
      expect(mockRmSync).toHaveBeenCalledWith(expect.stringContaining('enemy-ai-1'), {
        recursive: true,
        force: true,
      });

      // Deleted DB row
      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM enemy_ais'), [
        'enemy-ai-1',
      ]);

      // Audit logged
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admin_actions'),
        expect.arrayContaining([1, 'delete_enemy_ai', 'enemy_ai', 0]),
      );
    });

    it('should skip rmSync when AI directory does not exist', async () => {
      mockQuery.mockResolvedValue([makeAIRow()]);
      mockExistsSync.mockReturnValue(false);
      mockExecute.mockResolvedValue({});

      await deleteEnemyAI('enemy-ai-1', 1);

      expect(mockRmSync).not.toHaveBeenCalled();
    });

    it('should throw when AI not found', async () => {
      mockQuery.mockResolvedValue([]);

      await expect(deleteEnemyAI('nonexistent', 1)).rejects.toThrow('Enemy AI not found');
    });

    it('should include AI name in audit log details', async () => {
      mockQuery.mockResolvedValue([makeAIRow({ name: 'NamedEnemy' })]);
      mockExistsSync.mockReturnValue(false);
      mockExecute.mockResolvedValue({});

      await deleteEnemyAI('enemy-ai-1', 1);

      const auditCall = mockExecute.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('admin_actions'),
      );
      expect(auditCall).toBeDefined();
      const details = JSON.parse(auditCall![1][4] as string);
      expect(details.name).toBe('NamedEnemy');
    });
  });

  // ── downloadEnemyAISource ──────────────────────────────────────────────

  describe('downloadEnemyAISource', () => {
    it('should return filename and content when AI and source file exist', async () => {
      mockQuery.mockResolvedValue([makeAIRow({ filename: 'custom-enemy.ts' })]);
      const sourceContent = Buffer.from('// Enemy AI source');
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(sourceContent);

      const result = await downloadEnemyAISource('enemy-ai-1');

      expect(result).not.toBeNull();
      expect(result!.filename).toBe('custom-enemy.ts');
      expect(result!.content).toBe(sourceContent);
      expect(mockExistsSync).toHaveBeenCalledWith(expect.stringContaining('source.ts'));
    });

    it('should return null when AI not found', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await downloadEnemyAISource('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null when source file is missing on disk', async () => {
      mockQuery.mockResolvedValue([makeAIRow()]);
      mockExistsSync.mockReturnValue(false);

      const result = await downloadEnemyAISource('enemy-ai-1');

      expect(result).toBeNull();
    });
  });
});

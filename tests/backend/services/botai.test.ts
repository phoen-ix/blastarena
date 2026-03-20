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
const mockCompileBotAI = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/botai-compiler', () => ({
  compileBotAI: mockCompileBotAI,
}));

// ── Registry mock ───────────────────────────────────────────────────────────
const mockLoadAI = jest.fn<AnyFn>();
const mockUnloadAI = jest.fn<AnyFn>();
const mockReloadAI = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/botai-registry', () => ({
  getBotAIRegistry: () => ({
    loadAI: mockLoadAI,
    unloadAI: mockUnloadAI,
    reloadAI: mockReloadAI,
  }),
}));

// ── FS mock ─────────────────────────────────────────────────────────────────
const mockMkdirSync = jest.fn<AnyFn>();
const mockWriteFileSync = jest.fn<AnyFn>();
const mockExistsSync = jest.fn<AnyFn>();
const mockReadFileSync = jest.fn<AnyFn>();
const mockRmSync = jest.fn<AnyFn>();
jest.mock('fs', () => ({
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  rmSync: (...args: unknown[]) => mockRmSync(...args),
  default: {
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    rmSync: (...args: unknown[]) => mockRmSync(...args),
  },
}));

// ── UUID mock ───────────────────────────────────────────────────────────────
const FIXED_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
jest.mock('uuid', () => ({
  v4: () => FIXED_UUID,
}));

// ── Logger mock ─────────────────────────────────────────────────────────────
jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import {
  listAllAIs,
  listActiveAIs,
  getAI,
  uploadAI,
  updateAI,
  reuploadAI,
  deleteAI,
  downloadSource,
} from '../../../backend/src/services/botai';

// ── Helper factories ────────────────────────────────────────────────────────

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uuid-1',
    name: 'Test AI',
    description: 'A test bot AI',
    filename: 'test.ts',
    is_builtin: false,
    is_active: true,
    uploaded_by: 1,
    uploader_username: 'admin',
    uploaded_at: new Date('2025-01-01T00:00:00Z'),
    version: 1,
    file_size: 100,
    ...overrides,
  };
}

describe('BotAI Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── rowToEntry mapping (tested via public functions) ────────────────────

  describe('rowToEntry mapping', () => {
    it('should map snake_case DB row to camelCase BotAIEntry', async () => {
      const row = makeRow();
      mockQuery.mockResolvedValue([row]);

      const result = await getAI('uuid-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('uuid-1');
      expect(result!.name).toBe('Test AI');
      expect(result!.description).toBe('A test bot AI');
      expect(result!.filename).toBe('test.ts');
      expect(result!.isBuiltin).toBe(false);
      expect(result!.isActive).toBe(true);
      expect(result!.uploadedBy).toBe('admin');
      expect(result!.uploadedAt).toBe('2025-01-01T00:00:00.000Z');
      expect(result!.version).toBe(1);
      expect(result!.fileSize).toBe(100);
    });

    it('should convert boolean-like is_builtin to boolean', async () => {
      const row = makeRow({ is_builtin: 1 });
      mockQuery.mockResolvedValue([row]);

      const result = await getAI('uuid-1');
      expect(result!.isBuiltin).toBe(true);
    });

    it('should convert falsy is_builtin to false', async () => {
      const row = makeRow({ is_builtin: 0 });
      mockQuery.mockResolvedValue([row]);

      const result = await getAI('uuid-1');
      expect(result!.isBuiltin).toBe(false);
    });

    it('should use uploader_username for uploadedBy field', async () => {
      const row = makeRow({ uploader_username: 'someuser' });
      mockQuery.mockResolvedValue([row]);

      const result = await getAI('uuid-1');
      expect(result!.uploadedBy).toBe('someuser');
    });

    it('should return null uploadedBy when uploader_username is missing', async () => {
      const row = makeRow({ uploader_username: undefined });
      mockQuery.mockResolvedValue([row]);

      const result = await getAI('uuid-1');
      expect(result!.uploadedBy).toBeNull();
    });

    it('should handle empty description by defaulting to empty string', async () => {
      const row = makeRow({ description: '' });
      mockQuery.mockResolvedValue([row]);

      const result = await getAI('uuid-1');
      expect(result!.description).toBe('');
    });

    it('should handle null description by defaulting to empty string', async () => {
      const row = makeRow({ description: null });
      mockQuery.mockResolvedValue([row]);

      const result = await getAI('uuid-1');
      expect(result!.description).toBe('');
    });

    it('should convert non-Date uploaded_at to string', async () => {
      const row = makeRow({ uploaded_at: '2025-06-15 12:00:00' });
      mockQuery.mockResolvedValue([row]);

      const result = await getAI('uuid-1');
      expect(result!.uploadedAt).toBe('2025-06-15 12:00:00');
    });
  });

  // ── listAllAIs ──────────────────────────────────────────────────────────

  describe('listAllAIs', () => {
    it('should return mapped entries for all AIs', async () => {
      const rows = [
        makeRow({ id: 'builtin-1', name: 'Built-in', is_builtin: true }),
        makeRow({ id: 'custom-1', name: 'Custom AI' }),
      ];
      mockQuery.mockResolvedValue(rows);

      const result = await listAllAIs();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('builtin-1');
      expect(result[0].isBuiltin).toBe(true);
      expect(result[1].id).toBe('custom-1');
      expect(result[1].isBuiltin).toBe(false);
    });

    it('should return empty array when no AIs exist', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await listAllAIs();

      expect(result).toEqual([]);
    });

    it('should query with correct ORDER BY', async () => {
      mockQuery.mockResolvedValue([]);

      await listAllAIs();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY ba.is_builtin DESC, ba.uploaded_at DESC'),
      );
    });
  });

  // ── listActiveAIs ───────────────────────────────────────────────────────

  describe('listActiveAIs', () => {
    it('should return only active AIs', async () => {
      const rows = [makeRow({ id: 'active-1', is_active: true })];
      mockQuery.mockResolvedValue(rows);

      const result = await listActiveAIs();

      expect(result).toHaveLength(1);
      expect(result[0].isActive).toBe(true);
    });

    it('should query with is_active = TRUE filter', async () => {
      mockQuery.mockResolvedValue([]);

      await listActiveAIs();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE ba.is_active = TRUE'),
      );
    });

    it('should return empty array when no active AIs', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await listActiveAIs();

      expect(result).toEqual([]);
    });
  });

  // ── getAI ───────────────────────────────────────────────────────────────

  describe('getAI', () => {
    it('should return entry when AI is found', async () => {
      const row = makeRow();
      mockQuery.mockResolvedValue([row]);

      const result = await getAI('uuid-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('uuid-1');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE ba.id = ?'),
        ['uuid-1'],
      );
    });

    it('should return null when AI is not found', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getAI('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ── uploadAI ────────────────────────────────────────────────────────────

  describe('uploadAI', () => {
    const source = 'export class TestAI { generateInput() { return null; } }';
    const fileBuffer = Buffer.from(source);

    it('should compile, write files, insert DB, load registry, and audit log on success', async () => {
      mockCompileBotAI.mockResolvedValue({
        success: true,
        compiledCode: 'var TestAI = ...;',
        errors: [],
      });
      mockExecute.mockResolvedValue({});
      // getAI call after insert
      mockQuery.mockResolvedValue([makeRow({ id: FIXED_UUID, name: 'My Bot' })]);

      const result = await uploadAI('My Bot', 'desc', fileBuffer, 'bot.ts', 1);

      expect(result.errors).toBeUndefined();
      expect(result.entry).not.toBeNull();
      expect(result.entry.id).toBe(FIXED_UUID);

      // Compiled
      expect(mockCompileBotAI).toHaveBeenCalledWith(source);

      // Created directory
      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining(FIXED_UUID),
        { recursive: true },
      );

      // Wrote source and compiled files
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('source.ts'),
        source,
      );
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('compiled.js'),
        'var TestAI = ...;',
      );

      // Inserted DB row
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO bot_ais'),
        [FIXED_UUID, 'My Bot', 'desc', 'bot.ts', 1, Buffer.byteLength(source)],
      );

      // Loaded into registry
      expect(mockLoadAI).toHaveBeenCalledWith(FIXED_UUID);

      // Audit logged
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admin_actions'),
        expect.arrayContaining([1, 'upload_ai', 'bot_ai', 0]),
      );
    });

    it('should return errors without writing files when compilation fails', async () => {
      mockCompileBotAI.mockResolvedValue({
        success: false,
        errors: ['Syntax error', 'Missing export'],
      });

      const result = await uploadAI('Bad Bot', 'desc', fileBuffer, 'bad.ts', 1);

      expect(result.errors).toEqual(['Syntax error', 'Missing export']);
      expect(result.entry).toBeNull();

      // Should not write files, insert DB, or load registry
      expect(mockMkdirSync).not.toHaveBeenCalled();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
      expect(mockLoadAI).not.toHaveBeenCalled();
    });

    it('should use generated UUID for the AI id', async () => {
      mockCompileBotAI.mockResolvedValue({
        success: true,
        compiledCode: 'compiled;',
        errors: [],
      });
      mockExecute.mockResolvedValue({});
      mockQuery.mockResolvedValue([makeRow({ id: FIXED_UUID })]);

      await uploadAI('Bot', '', fileBuffer, 'f.ts', 1);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO bot_ais'),
        expect.arrayContaining([FIXED_UUID]),
      );
    });

    it('should calculate file_size from source buffer byte length', async () => {
      const unicodeSource = 'export class AI { /* \u00e9\u00e0\u00fc */ generateInput() { return null; } }';
      const unicodeBuffer = Buffer.from(unicodeSource);
      mockCompileBotAI.mockResolvedValue({
        success: true,
        compiledCode: 'compiled;',
        errors: [],
      });
      mockExecute.mockResolvedValue({});
      mockQuery.mockResolvedValue([makeRow({ id: FIXED_UUID })]);

      await uploadAI('Bot', '', unicodeBuffer, 'f.ts', 1);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO bot_ais'),
        expect.arrayContaining([Buffer.byteLength(unicodeSource)]),
      );
    });
  });

  // ── updateAI ────────────────────────────────────────────────────────────

  describe('updateAI', () => {
    it('should update name in DB and audit log', async () => {
      mockQuery.mockResolvedValue([makeRow()]);
      mockExecute.mockResolvedValue({});

      await updateAI('uuid-1', { name: 'New Name' }, 1);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE bot_ais SET name = ?'),
        ['New Name', 'uuid-1'],
      );
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admin_actions'),
        expect.arrayContaining([1, 'update_ai', 'bot_ai', 0]),
      );
    });

    it('should update description', async () => {
      mockQuery.mockResolvedValue([makeRow()]);
      mockExecute.mockResolvedValue({});

      await updateAI('uuid-1', { description: 'New desc' }, 1);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('description = ?'),
        ['New desc', 'uuid-1'],
      );
    });

    it('should load AI in registry when activating a non-builtin AI', async () => {
      mockQuery.mockResolvedValue([makeRow({ is_builtin: false, is_active: false })]);
      mockExecute.mockResolvedValue({});

      await updateAI('uuid-1', { isActive: true }, 1);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('is_active = ?'),
        [true, 'uuid-1'],
      );
      expect(mockLoadAI).toHaveBeenCalledWith('uuid-1');
    });

    it('should unload AI from registry when deactivating a non-builtin AI', async () => {
      mockQuery.mockResolvedValue([makeRow({ is_builtin: false, is_active: true })]);
      mockExecute.mockResolvedValue({});

      await updateAI('uuid-1', { isActive: false }, 1);

      expect(mockUnloadAI).toHaveBeenCalledWith('uuid-1');
    });

    it('should not toggle registry for builtin AI when isActive changes', async () => {
      mockQuery.mockResolvedValue([makeRow({ is_builtin: true })]);
      mockExecute.mockResolvedValue({});

      await updateAI('uuid-1', { isActive: false }, 1);

      expect(mockLoadAI).not.toHaveBeenCalled();
      expect(mockUnloadAI).not.toHaveBeenCalled();
    });

    it('should throw when AI not found', async () => {
      mockQuery.mockResolvedValue([]);

      await expect(updateAI('nonexistent', { name: 'Nope' }, 1)).rejects.toThrow('AI not found');
    });

    it('should return early without DB update when no updates provided', async () => {
      mockQuery.mockResolvedValue([makeRow()]);

      await updateAI('uuid-1', {}, 1);

      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should build SET clause with multiple fields', async () => {
      mockQuery.mockResolvedValue([makeRow()]);
      mockExecute.mockResolvedValue({});

      await updateAI('uuid-1', { name: 'X', description: 'Y', isActive: true }, 1);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('name = ?, description = ?, is_active = ?'),
        ['X', 'Y', true, 'uuid-1'],
      );
    });

    it('should catch and log error when loadAI fails on activate', async () => {
      mockQuery.mockResolvedValue([makeRow({ is_builtin: false })]);
      mockExecute.mockResolvedValue({});
      mockLoadAI.mockImplementation(() => {
        throw new Error('load failed');
      });

      // Should not throw — error is caught internally
      await expect(updateAI('uuid-1', { isActive: true }, 1)).resolves.not.toThrow();
    });
  });

  // ── reuploadAI ──────────────────────────────────────────────────────────

  describe('reuploadAI', () => {
    const source = 'export class ReBot { generateInput() { return null; } }';
    const fileBuffer = Buffer.from(source);

    it('should recompile, write files, update DB version, and reload if active', async () => {
      mockQuery.mockResolvedValue([makeRow({ is_active: true, is_builtin: false })]);
      mockCompileBotAI.mockResolvedValue({
        success: true,
        compiledCode: 'var ReBot = ...;',
        errors: [],
      });
      mockExecute.mockResolvedValue({});

      const result = await reuploadAI('uuid-1', fileBuffer, 'rebot.ts', 1);

      expect(result.success).toBe(true);
      expect(result.errors).toBeUndefined();

      // Compiled
      expect(mockCompileBotAI).toHaveBeenCalledWith(source);

      // Wrote updated files
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('source.ts'),
        source,
      );
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('compiled.js'),
        'var ReBot = ...;',
      );

      // Updated DB with version increment
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('version = version + 1'),
        ['rebot.ts', Buffer.byteLength(source), 'uuid-1'],
      );

      // Reloaded because active
      expect(mockReloadAI).toHaveBeenCalledWith('uuid-1');

      // Audit logged
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admin_actions'),
        expect.arrayContaining([1, 'reupload_ai', 'bot_ai', 0]),
      );
    });

    it('should not reload registry when AI is inactive', async () => {
      mockQuery.mockResolvedValue([makeRow({ is_active: false, is_builtin: false })]);
      mockCompileBotAI.mockResolvedValue({
        success: true,
        compiledCode: 'compiled;',
        errors: [],
      });
      mockExecute.mockResolvedValue({});

      const result = await reuploadAI('uuid-1', fileBuffer, 'f.ts', 1);

      expect(result.success).toBe(true);
      expect(mockReloadAI).not.toHaveBeenCalled();
    });

    it('should return errors when compilation fails', async () => {
      mockQuery.mockResolvedValue([makeRow({ is_builtin: false })]);
      mockCompileBotAI.mockResolvedValue({
        success: false,
        errors: ['Type error at line 5'],
      });

      const result = await reuploadAI('uuid-1', fileBuffer, 'f.ts', 1);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(['Type error at line 5']);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should throw when trying to re-upload builtin AI', async () => {
      mockQuery.mockResolvedValue([makeRow({ is_builtin: true })]);

      await expect(reuploadAI('uuid-1', fileBuffer, 'f.ts', 1)).rejects.toThrow(
        'Cannot re-upload built-in AI',
      );
    });

    it('should throw when AI not found', async () => {
      mockQuery.mockResolvedValue([]);

      await expect(reuploadAI('nonexistent', fileBuffer, 'f.ts', 1)).rejects.toThrow(
        'AI not found',
      );
    });

    it('should catch and log error when reloadAI fails after re-upload', async () => {
      mockQuery.mockResolvedValue([makeRow({ is_active: true, is_builtin: false })]);
      mockCompileBotAI.mockResolvedValue({
        success: true,
        compiledCode: 'compiled;',
        errors: [],
      });
      mockExecute.mockResolvedValue({});
      mockReloadAI.mockImplementation(() => {
        throw new Error('reload failed');
      });

      // Should not throw — error is caught internally
      const result = await reuploadAI('uuid-1', fileBuffer, 'f.ts', 1);
      expect(result.success).toBe(true);
    });
  });

  // ── deleteAI ────────────────────────────────────────────────────────────

  describe('deleteAI', () => {
    it('should unload registry, delete files, delete DB row, and audit log', async () => {
      mockQuery.mockResolvedValue([makeRow({ name: 'Doomed Bot' })]);
      mockExistsSync.mockReturnValue(true);
      mockExecute.mockResolvedValue({});

      await deleteAI('uuid-1', 1);

      // Unloaded from registry
      expect(mockUnloadAI).toHaveBeenCalledWith('uuid-1');

      // Checked and removed directory
      expect(mockExistsSync).toHaveBeenCalledWith(expect.stringContaining('uuid-1'));
      expect(mockRmSync).toHaveBeenCalledWith(expect.stringContaining('uuid-1'), {
        recursive: true,
        force: true,
      });

      // Deleted DB row
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM bot_ais'),
        ['uuid-1'],
      );

      // Audit logged
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admin_actions'),
        expect.arrayContaining([1, 'delete_ai', 'bot_ai', 0]),
      );
    });

    it('should skip rmSync when AI directory does not exist', async () => {
      mockQuery.mockResolvedValue([makeRow()]);
      mockExistsSync.mockReturnValue(false);
      mockExecute.mockResolvedValue({});

      await deleteAI('uuid-1', 1);

      expect(mockRmSync).not.toHaveBeenCalled();
    });

    it('should throw when trying to delete builtin AI', async () => {
      mockQuery.mockResolvedValue([makeRow({ is_builtin: true })]);

      await expect(deleteAI('uuid-1', 1)).rejects.toThrow('Cannot delete built-in AI');
    });

    it('should throw when AI not found', async () => {
      mockQuery.mockResolvedValue([]);

      await expect(deleteAI('nonexistent', 1)).rejects.toThrow('AI not found');
    });

    it('should include AI name in audit log details', async () => {
      mockQuery.mockResolvedValue([makeRow({ name: 'NamedBot' })]);
      mockExistsSync.mockReturnValue(false);
      mockExecute.mockResolvedValue({});

      await deleteAI('uuid-1', 1);

      const auditCall = mockExecute.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('admin_actions'),
      );
      expect(auditCall).toBeDefined();
      const details = JSON.parse(auditCall![1][4] as string);
      expect(details.name).toBe('NamedBot');
    });
  });

  // ── downloadSource ──────────────────────────────────────────────────────

  describe('downloadSource', () => {
    it('should return null when AI not found', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await downloadSource('nonexistent');

      expect(result).toBeNull();
    });

    it('should read primary path for builtin AI when it exists', async () => {
      mockQuery.mockResolvedValue([makeRow({ is_builtin: true })]);
      const builtinContent = Buffer.from('// Built-in AI source');
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(builtinContent);

      const result = await downloadSource('builtin-id');

      expect(result).not.toBeNull();
      expect(result!.filename).toBe('BotAI.ts');
      expect(result!.content).toBe(builtinContent);
      // Should have checked primary path first and found it
      expect(mockExistsSync).toHaveBeenCalled();
      expect(mockReadFileSync).toHaveBeenCalled();
    });

    it('should fall back to secondary path for builtin AI when primary does not exist', async () => {
      mockQuery.mockResolvedValue([makeRow({ is_builtin: true })]);
      const builtinContent = Buffer.from('// Fallback source');
      // First call (primary) returns false, second (fallback) returns true
      mockExistsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);
      mockReadFileSync.mockReturnValue(builtinContent);

      const result = await downloadSource('builtin-id');

      expect(result).not.toBeNull();
      expect(result!.filename).toBe('BotAI.ts');
      expect(result!.content).toBe(builtinContent);
      expect(mockExistsSync).toHaveBeenCalledTimes(2);
    });

    it('should return null for builtin AI when neither path exists', async () => {
      mockQuery.mockResolvedValue([makeRow({ is_builtin: true })]);
      mockExistsSync.mockReturnValue(false);

      const result = await downloadSource('builtin-id');

      expect(result).toBeNull();
    });

    it('should read custom AI source from AI directory', async () => {
      mockQuery.mockResolvedValue([makeRow({ is_builtin: false, filename: 'custom.ts' })]);
      const customContent = Buffer.from('// Custom AI');
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(customContent);

      const result = await downloadSource('uuid-1');

      expect(result).not.toBeNull();
      expect(result!.filename).toBe('custom.ts');
      expect(result!.content).toBe(customContent);
      expect(mockExistsSync).toHaveBeenCalledWith(expect.stringContaining('source.ts'));
    });

    it('should return null for custom AI when source file is missing', async () => {
      mockQuery.mockResolvedValue([makeRow({ is_builtin: false })]);
      mockExistsSync.mockReturnValue(false);

      const result = await downloadSource('uuid-1');

      expect(result).toBeNull();
    });
  });
});

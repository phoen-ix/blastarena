import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { BotAIEntry } from '@blast-arena/shared';
import { query, execute } from '../db/connection';
import { BotAIRow } from '../db/types';
import { compileBotAI } from './botai-compiler';
import { getBotAIRegistry } from './botai-registry';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

const AI_BASE_DIR = path.join(process.cwd(), 'ai');
const BUILTIN_SOURCE_PATH = path.join(__dirname, '../game/BotAI.ts');
// In compiled dist, source is at a different location — try both
const BUILTIN_SOURCE_FALLBACK = path.resolve(process.cwd(), 'src/game/BotAI.ts');

function rowToEntry(row: BotAIRow): BotAIEntry {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    filename: row.filename,
    isBuiltin: !!row.is_builtin,
    isActive: !!row.is_active,
    uploadedBy: row.uploader_username || null,
    uploadedAt:
      row.uploaded_at instanceof Date ? row.uploaded_at.toISOString() : String(row.uploaded_at),
    version: row.version,
    fileSize: row.file_size,
  };
}

export async function listAllAIs(): Promise<BotAIEntry[]> {
  const rows = await query<BotAIRow[]>(
    `SELECT ba.*, u.username as uploader_username
     FROM bot_ais ba
     LEFT JOIN users u ON ba.uploaded_by = u.id
     ORDER BY ba.is_builtin DESC, ba.uploaded_at DESC`,
  );
  return rows.map(rowToEntry);
}

export async function listActiveAIs(): Promise<BotAIEntry[]> {
  const rows = await query<BotAIRow[]>(
    `SELECT ba.*, u.username as uploader_username
     FROM bot_ais ba
     LEFT JOIN users u ON ba.uploaded_by = u.id
     WHERE ba.is_active = TRUE
     ORDER BY ba.is_builtin DESC, ba.name ASC`,
  );
  return rows.map(rowToEntry);
}

export async function getAI(id: string): Promise<BotAIEntry | null> {
  const rows = await query<BotAIRow[]>(
    `SELECT ba.*, u.username as uploader_username
     FROM bot_ais ba
     LEFT JOIN users u ON ba.uploaded_by = u.id
     WHERE ba.id = ?`,
    [id],
  );
  return rows.length > 0 ? rowToEntry(rows[0]) : null;
}

export async function uploadAI(
  name: string,
  description: string,
  fileBuffer: Buffer,
  filename: string,
  uploadedBy: number,
): Promise<{ entry: BotAIEntry; errors?: string[] }> {
  const source = fileBuffer.toString('utf-8');

  // Compile and validate
  const result = await compileBotAI(source);
  if (!result.success) {
    return {
      entry: null as unknown as BotAIEntry,
      errors: result.errors,
    };
  }

  const id = uuidv4();
  const aiDir = path.join(AI_BASE_DIR, id);
  fs.mkdirSync(aiDir, { recursive: true });

  // Write source and compiled files
  fs.writeFileSync(path.join(aiDir, 'source.ts'), source);
  fs.writeFileSync(path.join(aiDir, 'compiled.js'), result.compiledCode!);

  // Insert DB row
  await execute(
    `INSERT INTO bot_ais (id, name, description, filename, is_builtin, is_active, uploaded_by, version, file_size)
     VALUES (?, ?, ?, ?, FALSE, TRUE, ?, 1, ?)`,
    [id, name, description, filename, uploadedBy, Buffer.byteLength(source)],
  );

  // Load into registry
  getBotAIRegistry().loadAI(id);

  // Log
  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [uploadedBy, 'upload_ai', 'bot_ai', 0, JSON.stringify({ aiId: id, name, filename })],
  );

  logger.info({ aiId: id, name }, 'Custom BotAI uploaded');

  const entry = await getAI(id);
  return { entry: entry! };
}

export async function updateAI(
  id: string,
  updates: { name?: string; description?: string; isActive?: boolean },
  adminId: number,
): Promise<void> {
  // Check if exists
  const rows = await query<BotAIRow[]>('SELECT * FROM bot_ais WHERE id = ?', [id]);
  if (rows.length === 0) throw new AppError('AI not found', 404, 'AI_NOT_FOUND');

  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    setClauses.push('name = ?');
    params.push(updates.name);
  }
  if (updates.description !== undefined) {
    setClauses.push('description = ?');
    params.push(updates.description);
  }
  if (updates.isActive !== undefined) {
    setClauses.push('is_active = ?');
    params.push(updates.isActive);
  }

  if (setClauses.length === 0) return;

  params.push(id);
  await execute(`UPDATE bot_ais SET ${setClauses.join(', ')} WHERE id = ?`, params);

  // Load/unload from registry if toggling active
  if (updates.isActive !== undefined && !rows[0].is_builtin) {
    if (updates.isActive) {
      try {
        getBotAIRegistry().loadAI(id);
      } catch (err: unknown) {
        logger.warn(
          { aiId: id, error: err instanceof Error ? err.message : String(err) },
          'Failed to load AI on activate',
        );
      }
    } else {
      getBotAIRegistry().unloadAI(id);
    }
  }

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'update_ai', 'bot_ai', 0, JSON.stringify({ aiId: id, updates })],
  );
}

export async function reuploadAI(
  id: string,
  fileBuffer: Buffer,
  filename: string,
  adminId: number,
): Promise<{ success: boolean; errors?: string[] }> {
  const rows = await query<BotAIRow[]>('SELECT * FROM bot_ais WHERE id = ?', [id]);
  if (rows.length === 0) throw new AppError('AI not found', 404, 'AI_NOT_FOUND');
  if (rows[0].is_builtin) throw new AppError('Cannot re-upload built-in AI', 400, 'AI_BUILTIN');

  const source = fileBuffer.toString('utf-8');
  const result = await compileBotAI(source);
  if (!result.success) {
    return { success: false, errors: result.errors };
  }

  const aiDir = path.join(AI_BASE_DIR, id);
  fs.writeFileSync(path.join(aiDir, 'source.ts'), source);
  fs.writeFileSync(path.join(aiDir, 'compiled.js'), result.compiledCode!);

  await execute(
    'UPDATE bot_ais SET filename = ?, version = version + 1, file_size = ? WHERE id = ?',
    [filename, Buffer.byteLength(source), id],
  );

  // Reload in registry if active
  if (rows[0].is_active) {
    try {
      getBotAIRegistry().reloadAI(id);
    } catch (_err: unknown) {
      logger.warn({ aiId: id }, 'Failed to reload AI after re-upload');
    }
  }

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'reupload_ai', 'bot_ai', 0, JSON.stringify({ aiId: id, filename })],
  );

  return { success: true };
}

export async function deleteAI(id: string, adminId: number): Promise<void> {
  const rows = await query<BotAIRow[]>('SELECT * FROM bot_ais WHERE id = ?', [id]);
  if (rows.length === 0) throw new AppError('AI not found', 404, 'AI_NOT_FOUND');
  if (rows[0].is_builtin) throw new AppError('Cannot delete built-in AI', 400, 'AI_BUILTIN');

  // Unload from registry
  getBotAIRegistry().unloadAI(id);

  // Delete files
  const aiDir = path.join(AI_BASE_DIR, id);
  if (fs.existsSync(aiDir)) {
    fs.rmSync(aiDir, { recursive: true, force: true });
  }

  // Delete DB row
  await execute('DELETE FROM bot_ais WHERE id = ?', [id]);

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'delete_ai', 'bot_ai', 0, JSON.stringify({ aiId: id, name: rows[0].name })],
  );

  logger.info({ aiId: id, name: rows[0].name }, 'Custom BotAI deleted');
}

export async function downloadSource(
  id: string,
): Promise<{ filename: string; content: Buffer } | null> {
  const rows = await query<BotAIRow[]>('SELECT * FROM bot_ais WHERE id = ?', [id]);
  if (rows.length === 0) return null;

  if (rows[0].is_builtin) {
    // Read the built-in BotAI.ts source file
    let sourcePath = BUILTIN_SOURCE_PATH;
    if (!fs.existsSync(sourcePath)) {
      sourcePath = BUILTIN_SOURCE_FALLBACK;
    }
    if (!fs.existsSync(sourcePath)) {
      return null;
    }
    return {
      filename: 'BotAI.ts',
      content: fs.readFileSync(sourcePath),
    };
  }

  const sourcePath = path.join(AI_BASE_DIR, id, 'source.ts');
  if (!fs.existsSync(sourcePath)) return null;

  return {
    filename: rows[0].filename,
    content: fs.readFileSync(sourcePath),
  };
}

import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { EnemyAIEntry } from '@blast-arena/shared';
import { query, execute } from '../db/connection';
import { EnemyAIRow } from '../db/types';
import { compileEnemyAI } from './enemyai-compiler';
import { getEnemyAIRegistry } from './enemyai-registry';
import { logger } from '../utils/logger';

const ENEMY_AI_BASE_DIR = path.join(process.cwd(), 'enemy-ai');

function rowToEntry(row: EnemyAIRow): EnemyAIEntry {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    filename: row.filename,
    isActive: !!row.is_active,
    uploadedBy: row.uploader_username || null,
    uploadedAt:
      row.uploaded_at instanceof Date ? row.uploaded_at.toISOString() : String(row.uploaded_at),
    version: row.version,
    fileSize: row.file_size,
  };
}

export async function listAllEnemyAIs(): Promise<EnemyAIEntry[]> {
  const rows = await query<EnemyAIRow[]>(
    `SELECT ea.*, u.username as uploader_username
     FROM enemy_ais ea
     LEFT JOIN users u ON ea.uploaded_by = u.id
     ORDER BY ea.uploaded_at DESC`,
  );
  return rows.map(rowToEntry);
}

export async function listActiveEnemyAIs(): Promise<EnemyAIEntry[]> {
  const rows = await query<EnemyAIRow[]>(
    `SELECT ea.*, u.username as uploader_username
     FROM enemy_ais ea
     LEFT JOIN users u ON ea.uploaded_by = u.id
     WHERE ea.is_active = TRUE
     ORDER BY ea.name ASC`,
  );
  return rows.map(rowToEntry);
}

export async function getEnemyAI(id: string): Promise<EnemyAIEntry | null> {
  const rows = await query<EnemyAIRow[]>(
    `SELECT ea.*, u.username as uploader_username
     FROM enemy_ais ea
     LEFT JOIN users u ON ea.uploaded_by = u.id
     WHERE ea.id = ?`,
    [id],
  );
  return rows.length > 0 ? rowToEntry(rows[0]) : null;
}

export async function getEnemyAIByName(name: string): Promise<EnemyAIEntry | null> {
  const rows = await query<EnemyAIRow[]>(
    `SELECT ea.*, u.username as uploader_username
     FROM enemy_ais ea
     LEFT JOIN users u ON ea.uploaded_by = u.id
     WHERE ea.name = ?`,
    [name],
  );
  return rows.length > 0 ? rowToEntry(rows[0]) : null;
}

export async function uploadEnemyAI(
  name: string,
  description: string,
  fileBuffer: Buffer,
  filename: string,
  uploadedBy: number,
): Promise<{ entry: EnemyAIEntry; errors?: string[] }> {
  const source = fileBuffer.toString('utf-8');

  const result = await compileEnemyAI(source);
  if (!result.success) {
    return {
      entry: null as unknown as EnemyAIEntry,
      errors: result.errors,
    };
  }

  const id = uuidv4();
  const aiDir = path.join(ENEMY_AI_BASE_DIR, id);
  fs.mkdirSync(aiDir, { recursive: true });

  fs.writeFileSync(path.join(aiDir, 'source.ts'), source);
  fs.writeFileSync(path.join(aiDir, 'compiled.js'), result.compiledCode!);

  await execute(
    `INSERT INTO enemy_ais (id, name, description, filename, is_active, uploaded_by, version, file_size)
     VALUES (?, ?, ?, ?, TRUE, ?, 1, ?)`,
    [id, name, description, filename, uploadedBy, Buffer.byteLength(source)],
  );

  getEnemyAIRegistry().loadAI(id);

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [uploadedBy, 'upload_enemy_ai', 'enemy_ai', 0, JSON.stringify({ aiId: id, name, filename })],
  );

  logger.info({ aiId: id, name }, 'Custom EnemyAI uploaded');

  const entry = await getEnemyAI(id);
  return { entry: entry! };
}

/**
 * Upload enemy AI from source string (used during import).
 */
export async function uploadEnemyAIFromSource(
  name: string,
  description: string,
  source: string,
  filename: string,
  uploadedBy: number,
): Promise<{ entry: EnemyAIEntry | null; errors?: string[] }> {
  const result = await compileEnemyAI(source);
  if (!result.success) {
    return { entry: null, errors: result.errors };
  }

  const id = uuidv4();
  const aiDir = path.join(ENEMY_AI_BASE_DIR, id);
  fs.mkdirSync(aiDir, { recursive: true });

  fs.writeFileSync(path.join(aiDir, 'source.ts'), source);
  fs.writeFileSync(path.join(aiDir, 'compiled.js'), result.compiledCode!);

  await execute(
    `INSERT INTO enemy_ais (id, name, description, filename, is_active, uploaded_by, version, file_size)
     VALUES (?, ?, ?, ?, TRUE, ?, 1, ?)`,
    [id, name, description, filename, uploadedBy, Buffer.byteLength(source)],
  );

  getEnemyAIRegistry().loadAI(id);

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [
      uploadedBy,
      'upload_enemy_ai',
      'enemy_ai',
      0,
      JSON.stringify({ aiId: id, name, filename, source: 'import' }),
    ],
  );

  const entry = await getEnemyAI(id);
  return { entry };
}

export async function updateEnemyAI(
  id: string,
  updates: { name?: string; description?: string; isActive?: boolean },
  adminId: number,
): Promise<void> {
  const rows = await query<EnemyAIRow[]>('SELECT * FROM enemy_ais WHERE id = ?', [id]);
  if (rows.length === 0) throw new Error('Enemy AI not found');

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
  await execute(`UPDATE enemy_ais SET ${setClauses.join(', ')} WHERE id = ?`, params);

  if (updates.isActive !== undefined) {
    if (updates.isActive) {
      try {
        getEnemyAIRegistry().loadAI(id);
      } catch (err: unknown) {
        logger.warn(
          { aiId: id, error: err instanceof Error ? err.message : String(err) },
          'Failed to load enemy AI on activate',
        );
      }
    } else {
      getEnemyAIRegistry().unloadAI(id);
    }
  }

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'update_enemy_ai', 'enemy_ai', 0, JSON.stringify({ aiId: id, updates })],
  );
}

export async function reuploadEnemyAI(
  id: string,
  fileBuffer: Buffer,
  filename: string,
  adminId: number,
): Promise<{ success: boolean; errors?: string[] }> {
  const rows = await query<EnemyAIRow[]>('SELECT * FROM enemy_ais WHERE id = ?', [id]);
  if (rows.length === 0) throw new Error('Enemy AI not found');

  const source = fileBuffer.toString('utf-8');
  const result = await compileEnemyAI(source);
  if (!result.success) {
    return { success: false, errors: result.errors };
  }

  const aiDir = path.join(ENEMY_AI_BASE_DIR, id);
  fs.writeFileSync(path.join(aiDir, 'source.ts'), source);
  fs.writeFileSync(path.join(aiDir, 'compiled.js'), result.compiledCode!);

  await execute(
    'UPDATE enemy_ais SET filename = ?, version = version + 1, file_size = ? WHERE id = ?',
    [filename, Buffer.byteLength(source), id],
  );

  if (rows[0].is_active) {
    try {
      getEnemyAIRegistry().reloadAI(id);
    } catch (_err: unknown) {
      logger.warn({ aiId: id }, 'Failed to reload enemy AI after re-upload');
    }
  }

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'reupload_enemy_ai', 'enemy_ai', 0, JSON.stringify({ aiId: id, filename })],
  );

  return { success: true };
}

export async function deleteEnemyAI(id: string, adminId: number): Promise<void> {
  const rows = await query<EnemyAIRow[]>('SELECT * FROM enemy_ais WHERE id = ?', [id]);
  if (rows.length === 0) throw new Error('Enemy AI not found');

  getEnemyAIRegistry().unloadAI(id);

  const aiDir = path.join(ENEMY_AI_BASE_DIR, id);
  if (fs.existsSync(aiDir)) {
    fs.rmSync(aiDir, { recursive: true, force: true });
  }

  await execute('DELETE FROM enemy_ais WHERE id = ?', [id]);

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'delete_enemy_ai', 'enemy_ai', 0, JSON.stringify({ aiId: id, name: rows[0].name })],
  );

  logger.info({ aiId: id, name: rows[0].name }, 'Custom EnemyAI deleted');
}

export async function downloadEnemyAISource(
  id: string,
): Promise<{ filename: string; content: Buffer } | null> {
  const rows = await query<EnemyAIRow[]>('SELECT * FROM enemy_ais WHERE id = ?', [id]);
  if (rows.length === 0) return null;

  const sourcePath = path.join(ENEMY_AI_BASE_DIR, id, 'source.ts');
  if (!fs.existsSync(sourcePath)) return null;

  return {
    filename: rows[0].filename,
    content: fs.readFileSync(sourcePath),
  };
}

import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { RowDataPacket } from 'mysql2';
import { compileEnemyAI } from '../../services/enemyai-compiler';
import { getEnemyAIRegistry } from '../../services/enemyai-registry';
import { query, execute } from '../../db/connection';
import { logger } from '../../utils/logger';
import { BUILTIN_ENEMY_AIS, BuiltinEnemyAIDef } from './sources';

const ENEMY_AI_BASE_DIR = path.join(process.cwd(), 'enemy-ai');

interface BuiltinRow extends RowDataPacket {
  id: string;
  is_active: boolean | number;
}

/**
 * Compile a built-in from the repository source and load it in-process. Built-ins never run code
 * read back from the (writable) data directory.
 */
export async function loadBuiltinEnemyAI(id: string, key: string): Promise<boolean> {
  const def = BUILTIN_ENEMY_AIS.find((d) => d.key === key);
  if (!def) return false;
  const result = await compileEnemyAI(def.source);
  if (!result.success) {
    logger.error({ key, errors: result.errors }, 'Failed to compile built-in enemy AI');
    return false;
  }
  getEnemyAIRegistry().loadBuiltin(id, result.compiledCode!);
  return true;
}

/** Keep the stored copy (download/export) in step with the repository source. */
function writeBuiltinFiles(id: string, def: BuiltinEnemyAIDef): void {
  const aiDir = path.join(ENEMY_AI_BASE_DIR, id);
  fs.mkdirSync(aiDir, { recursive: true });
  fs.writeFileSync(path.join(aiDir, 'source.ts'), def.source);
}

/**
 * Create any missing built-in enemy AIs and load every active one from the repository source.
 * Runs at startup after the registry has loaded the uploaded (isolated) AIs.
 */
export async function seedDefaultEnemyAIs(): Promise<void> {
  let seeded = 0;

  for (const def of BUILTIN_ENEMY_AIS) {
    try {
      const rows = await query<BuiltinRow[]>(
        'SELECT id, is_active FROM enemy_ais WHERE builtin_key = ?',
        [def.key],
      );
      let id: string;
      let active = true;
      if (rows.length > 0) {
        id = rows[0].id;
        active = !!rows[0].is_active;
      } else {
        id = uuidv4();
        await execute(
          `INSERT INTO enemy_ais (id, name, description, filename, is_active, uploaded_by, version, file_size, builtin_key)
           VALUES (?, ?, ?, ?, TRUE, NULL, 1, ?, ?)`,
          [id, def.name, def.description, def.filename, Buffer.byteLength(def.source), def.key],
        );
        seeded++;
        logger.info({ aiId: id, name: def.name }, 'Seeded default enemy AI');
      }

      writeBuiltinFiles(id, def);
      if (active) await loadBuiltinEnemyAI(id, def.key);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ name: def.name, error: msg }, 'Error seeding default enemy AI');
    }
  }

  if (seeded > 0) {
    logger.info({ count: seeded }, 'Seeded default enemy AIs');
  }
}

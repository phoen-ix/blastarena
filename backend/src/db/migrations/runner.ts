import fs from 'fs';
import path from 'path';
import { getPool } from '../connection';
import { logger } from '../../utils/logger';

/** Resolve to source directory since SQL files aren't compiled */
function getMigrationsDir(): string {
  return path.resolve(__dirname, '..', '..', '..', 'src', 'db', 'migrations');
}

/**
 * Parse a SQL file into individual executable statements.
 * Splits on semicolons, trims whitespace, and filters out empty/comment-only fragments.
 */
function parseSqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function runMigrations(): Promise<void> {
  const pool = getPool();

  // Create migrations tracking table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Get already-executed migrations
  const [executed] = await pool.execute<any[]>('SELECT name FROM _migrations ORDER BY name');
  const executedNames = new Set(executed.map((r: any) => r.name));

  // Find migration files
  const migrationsDir = getMigrationsDir();
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (executedNames.has(file)) {
      logger.debug(`Migration ${file} already applied, skipping`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const statements = parseSqlStatements(sql);
      for (const statement of statements) {
        await conn.execute(statement);
      }

      await conn.execute('INSERT INTO _migrations (name) VALUES (?)', [file]);
      await conn.commit();
      logger.info(`Migration ${file} applied successfully`);
    } catch (err) {
      await conn.rollback();
      logger.error({ err, file }, `Migration ${file} failed`);
      throw err;
    } finally {
      conn.release();
    }
  }
}

/**
 * Returns the list of applied migration names, ordered alphabetically.
 */
export async function getAppliedMigrations(): Promise<string[]> {
  const pool = getPool();

  // Ensure the tracking table exists before querying
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const [rows] = await pool.execute<any[]>('SELECT name FROM _migrations ORDER BY name');
  return rows.map((r: any) => r.name);
}

/**
 * Roll back the last N applied migrations by executing their corresponding
 * down SQL files and removing them from the _migrations tracking table.
 *
 * @param steps - Number of migrations to roll back (default: 1)
 * @returns Array of rolled-back migration file names
 */
export async function rollbackMigration(steps: number = 1): Promise<string[]> {
  const pool = getPool();

  // Ensure the tracking table exists
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Fetch the last N applied migrations in reverse order
  const [rows] = await pool.execute<any[]>(
    'SELECT name FROM _migrations ORDER BY name DESC LIMIT ?',
    [steps]
  );

  if (rows.length === 0) {
    logger.info('No migrations to roll back');
    return [];
  }

  const migrationsDir = getMigrationsDir();
  const downDir = path.join(migrationsDir, 'down');
  const rolledBack: string[] = [];

  for (const row of rows) {
    const migrationName: string = row.name;
    // Convert "001_initial.sql" -> "001_initial.down.sql"
    const downFileName = migrationName.replace(/\.sql$/, '.down.sql');
    const downFilePath = path.join(downDir, downFileName);

    if (!fs.existsSync(downFilePath)) {
      throw new Error(
        `Down migration file not found for ${migrationName}: expected ${downFilePath}`
      );
    }

    const sql = fs.readFileSync(downFilePath, 'utf-8');
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const statements = parseSqlStatements(sql);
      for (const statement of statements) {
        await conn.execute(statement);
      }

      await conn.execute('DELETE FROM _migrations WHERE name = ?', [migrationName]);
      await conn.commit();
      rolledBack.push(migrationName);
      logger.info(`Migration ${migrationName} rolled back successfully`);
    } catch (err) {
      await conn.rollback();
      logger.error({ err, file: migrationName }, `Rollback of ${migrationName} failed`);
      throw err;
    } finally {
      conn.release();
    }
  }

  return rolledBack;
}

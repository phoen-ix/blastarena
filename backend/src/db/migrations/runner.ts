import fs from 'fs';
import path from 'path';
import type { RowDataPacket } from 'mysql2';
import type { Pool } from 'mysql2/promise';
import { getPool } from '../connection';
import { getConfig } from '../../config';
import { logger } from '../../utils/logger';

/** Row shape returned by `SELECT name FROM _migrations` queries */
interface MigrationRow extends RowDataPacket {
  name: string;
}

/**
 * How long to wait for another process to finish migrating before giving up. Generous: the whole
 * set applies in seconds on an empty database, so anything approaching this means the other side
 * is wedged, not slow.
 */
const MIGRATION_LOCK_TIMEOUT_SEC = 60;

/**
 * MariaDB advisory locks are namespaced per *server*, not per database, so include the database
 * name — otherwise two schemas on one server (a dev stack and a test database, say) would
 * serialise against each other for no reason. Lock names are capped at 64 characters.
 */
function migrationLockName(): string {
  return `blast_arena_migrations_${getConfig().DB_NAME}`.slice(0, 64);
}

/** Resolve to source directory since SQL files aren't compiled */
function getMigrationsDir(): string {
  return path.resolve(__dirname, '..', '..', '..', 'src', 'db', 'migrations');
}

/**
 * Parse a SQL file into individual executable statements.
 *
 * A statement ends at a top-level `;`. Semicolons inside comments, string literals or quoted
 * identifiers are content, not separators.
 *
 * This used to be `sql.split(';')`. Migration 039 carried a semicolon inside a `--` comment, so
 * the comment was cut in half and the fragment executed as SQL — `ER_PARSE_ERROR`, a failed
 * migration and a crash-looping backend on deploy. The old implementation also did not do what its
 * own doc comment claimed: it filtered empty fragments but not comment-only ones, so a trailing
 * comment after the final `;` would have been sent to the server as a statement.
 *
 * Comments are preserved in the returned text rather than stripped, so MySQL's version-gated
 * executable comments — the `slash-star-bang` form — still reach the server.
 * (audit MIGRATION-PARSER-1)
 */
export function parseSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  /** Does the fragment hold anything the server would act on, as opposed to only comments? */
  let hasExecutable = false;
  let i = 0;

  const pushCurrent = (): void => {
    if (hasExecutable) statements.push(current.trim());
    current = '';
    hasExecutable = false;
  };

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Line comment: `#` anywhere, or `--` followed by whitespace or end of input. MySQL requires
    // that whitespace, so `1--2` is arithmetic rather than a comment.
    const isDashComment =
      ch === '-' && next === '-' && (i + 2 >= sql.length || /\s/.test(sql[i + 2]));
    if (ch === '#' || isDashComment) {
      const newline = sql.indexOf('\n', i);
      const stop = newline === -1 ? sql.length : newline;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // Block comment. `/*!` is an executable comment — MySQL runs its contents — so it counts as
    // something the server acts on.
    if (ch === '/' && next === '*') {
      const close = sql.indexOf('*/', i + 2);
      const stop = close === -1 ? sql.length : close + 2;
      if (sql[i + 2] === '!') hasExecutable = true;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // String literal or quoted identifier. Backticks take no backslash escapes; '' and "" and ``
    // all self-escape by doubling.
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < sql.length) {
        if (quote !== '`' && sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      current += sql.slice(i, j);
      hasExecutable = true;
      i = j;
      continue;
    }

    if (ch === ';') {
      pushCurrent();
      i += 1;
      continue;
    }

    current += ch;
    if (!/\s/.test(ch)) hasExecutable = true;
    i += 1;
  }

  // Trailing statement with no closing semicolon.
  pushCurrent();
  return statements;
}

/**
 * Apply every migration that has not been recorded in `_migrations` yet.
 *
 * Serialised across processes by a MariaDB advisory lock (same approach as reclaim's runner).
 * Without it, two backends that start together — a rolling restart, a second replica — both read
 * the applied-set below, both conclude the same file is pending, and both run it. The visible
 * symptom is one of them dying on `Duplicate entry '0NN_….sql' for key 'name'` (and crash-looping
 * on restart), but the real damage is the migration BODY executing twice: guarded DDL survives
 * that, the data migrations (e.g. 030's email hashing) do not.
 *
 * The applied-set is deliberately read INSIDE the lock. Reading it outside would hand the waiter a
 * snapshot taken before the holder's work, so it would wake up and redo everything it had just
 * waited for — the same race with extra steps.
 */
export async function runMigrations(): Promise<void> {
  const pool = getPool();
  const lockName = migrationLockName();
  const lock = await pool.getConnection();

  try {
    const [rows] = await lock.query<RowDataPacket[]>('SELECT GET_LOCK(?, ?) AS acquired', [
      lockName,
      MIGRATION_LOCK_TIMEOUT_SEC,
    ]);
    // GET_LOCK: 1 = acquired, 0 = timed out, NULL = error (e.g. killed session).
    const acquired = rows[0]?.acquired;
    if (acquired === null || acquired === undefined) {
      throw new Error(`Could not acquire migration lock "${lockName}": GET_LOCK returned an error`);
    }
    if (Number(acquired) !== 1) {
      throw new Error(
        `Timed out after ${MIGRATION_LOCK_TIMEOUT_SEC}s waiting for migration lock "${lockName}" — ` +
          'another process is still migrating, or one died holding it.',
      );
    }

    await applyPendingMigrations(pool);
  } finally {
    // Release BEFORE returning the connection to the pool. A pooled connection that goes back
    // still holding the lock would block every later migration run in this process.
    try {
      await lock.query('SELECT RELEASE_LOCK(?)', [lockName]);
      lock.release();
    } catch (err) {
      logger.error(
        { err, lockName },
        'Failed to release migration lock; discarding the connection',
      );
      lock.destroy();
    }
  }
}

async function applyPendingMigrations(pool: Pool): Promise<void> {
  // Create migrations tracking table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Get already-executed migrations
  const [executed] = await pool.execute<MigrationRow[]>(
    'SELECT name FROM _migrations ORDER BY name',
  );
  const executedNames = new Set(executed.map((r) => r.name));

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
 * Migrations whose down script cannot restore the data they dropped. Rolling these back is
 * permanently destructive, so it is refused unless the caller explicitly opts in with `force`.
 *
 * 030 drops the plaintext email columns after data has been migrated to one-way HMAC hashes
 * (email_hash). The down migration only re-adds empty columns — the original emails are
 * unrecoverable. See audit finding DMIG-1.
 */
const IRREVERSIBLE_MIGRATIONS = new Set<string>(['030_finalize_email_hashing.sql']);

/**
 * Roll back the last N applied migrations by executing their corresponding
 * down SQL files and removing them from the _migrations tracking table.
 *
 * @param steps - Number of migrations to roll back (default: 1)
 * @param options.force - Allow rolling back migrations marked irreversible (data loss). Default false.
 * @returns Array of rolled-back migration file names
 */
export async function rollbackMigration(
  steps: number = 1,
  options: { force?: boolean } = {},
): Promise<string[]> {
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
  const [rows] = await pool.execute<MigrationRow[]>(
    'SELECT name FROM _migrations ORDER BY name DESC LIMIT ?',
    [steps],
  );

  if (rows.length === 0) {
    logger.info('No migrations to roll back');
    return [];
  }

  // Refuse to roll back irreversible (data-destroying) migrations unless explicitly forced.
  if (!options.force) {
    const irreversible = rows
      .map((r) => r.name)
      .filter((name) => IRREVERSIBLE_MIGRATIONS.has(name));
    if (irreversible.length > 0) {
      throw new Error(
        `Refusing to roll back irreversible migration(s): ${irreversible.join(', ')}. ` +
          `These permanently destroy data (e.g. plaintext emails dropped after hashing) and ` +
          `cannot be restored by their down script. Re-run with { force: true } only if you ` +
          `accept the data loss.`,
      );
    }
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
        `Down migration file not found for ${migrationName}: expected ${downFilePath}`,
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

/**
 * The migration runner against a real MariaDB — the only suite here that is not mocked. It runs
 * when REQUIRE_DB_TESTS=1 (CI and fleet set it, with a MariaDB service and the DB_* settings) and
 * is skipped otherwise. Locally, against any throwaway MariaDB:
 *   REQUIRE_DB_TESTS=1 DB_PORT=3317 DB_PASSWORD=… npx jest --config tests/backend/jest.config.ts migrationLock
 *
 * runMigrations() holds a GET_LOCK advisory lock while it reads the applied-set and applies what
 * is missing. Without it, two backends starting together both saw the same file as pending and
 * both ran it; one then died on the duplicate `_migrations` row (or, here, on CREATE TABLE of a
 * table the other had just created).
 *
 * The runner is handed throwaway migrations instead of the real 0NN files: fs.readdirSync and
 * fs.readFileSync are stubbed for the migrations directory only. Their bodies are deliberately not
 * idempotent, so running any of them twice is visible.
 */
import { describe, it, expect, jest, beforeAll, afterAll, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { loadConfig, getConfig } from '../../../backend/src/config';
import { createPool, getPool, query, execute } from '../../../backend/src/db/connection';
import { runMigrations } from '../../../backend/src/db/migrations/runner';

const describeDb = process.env.REQUIRE_DB_TESTS === '1' ? describe : describe.skip;

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../backend/src/db/migrations');
const TAG = randomBytes(4).toString('hex');
const TABLE = `locktest_${TAG}`;
const FAKE: Record<string, string> = {
  [`900_locktest_${TAG}_a.sql`]: `-- creates the probe table; not idempotent on purpose
CREATE TABLE ${TABLE} (id INT AUTO_INCREMENT PRIMARY KEY, file CHAR(1) NOT NULL);
INSERT INTO ${TABLE} (file) VALUES ('a');`,
  [`901_locktest_${TAG}_b.sql`]: `INSERT INTO ${TABLE} (file) VALUES ('b');`,
  [`902_locktest_${TAG}_c.sql`]: `INSERT INTO ${TABLE} (file) VALUES ('c');`,
};

type AnyFn = (...args: unknown[]) => unknown;

/** Make the runner see only the throwaway migrations. */
function stubMigrationFiles(): void {
  const readdir = fs.readdirSync as unknown as AnyFn;
  const readFile = fs.readFileSync as unknown as AnyFn;
  jest
    .spyOn(fs, 'readdirSync')
    .mockImplementation(((dir: unknown, ...rest: unknown[]) =>
      path.resolve(String(dir)) === MIGRATIONS_DIR
        ? Object.keys(FAKE)
        : readdir(dir, ...rest)) as unknown as typeof fs.readdirSync);
  jest.spyOn(fs, 'readFileSync').mockImplementation(((file: unknown, ...rest: unknown[]) => {
    const name = path.relative(MIGRATIONS_DIR, path.resolve(String(file)));
    return name in FAKE ? FAKE[name] : readFile(file, ...rest);
  }) as unknown as typeof fs.readFileSync);
}

/** An independent session, never a pooled connection, so it cannot hide a leaked lock. */
function newConnection() {
  const c = getConfig();
  return mysql.createConnection({
    host: c.DB_HOST,
    port: c.DB_PORT,
    user: c.DB_USER,
    password: c.DB_PASSWORD,
    database: c.DB_NAME,
  });
}

describeDb('migration runner lock (MariaDB)', () => {
  let lockName = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_HOST ??= '127.0.0.1';
    process.env.DB_PASSWORD ??= 'ci_pass_pw';
    process.env.JWT_SECRET ??= 'test_jwt_secret_at_least_thirty_two_chars_long';
    process.env.EMAIL_PEPPER ??= 'test_email_pepper_at_least_thirty_two_chars_long';
    process.env.TOTP_ENCRYPTION_KEY ??= 'ab'.repeat(32);
    loadConfig();
    await createPool();
    lockName = `blast_arena_migrations_${getConfig().DB_NAME}`.slice(0, 64);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await execute(`DROP TABLE IF EXISTS ${TABLE}`);
    await execute('DELETE FROM _migrations WHERE name LIKE ?', [`%locktest_${TAG}%`]);
    await getPool().end();
  });

  it('applies each migration exactly once when two runs start together', async () => {
    stubMigrationFiles();

    const results = await Promise.allSettled([runMigrations(), runMigrations()]);
    expect(results.map((r) => (r.status === 'rejected' ? String(r.reason) : r.status))).toEqual([
      'fulfilled',
      'fulfilled',
    ]);

    const bodies = await query<RowDataPacket[]>(
      `SELECT file, COUNT(*) AS n FROM ${TABLE} GROUP BY file ORDER BY file`,
    );
    expect(bodies.map((r) => [r.file, Number(r.n)])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 1],
    ]);
    const recorded = await query<RowDataPacket[]>(
      'SELECT name FROM _migrations WHERE name LIKE ? ORDER BY name',
      [`%locktest_${TAG}%`],
    );
    expect(recorded.map((r) => r.name)).toEqual(Object.keys(FAKE));
  });

  it('waits while another session holds the lock', async () => {
    stubMigrationFiles(); // all applied by now: nothing runs, only the lock is contended
    const holder = await newConnection();
    try {
      const [got] = await holder.query<RowDataPacket[]>('SELECT GET_LOCK(?, 10) AS acquired', [
        lockName,
      ]);
      expect(Number(got[0].acquired)).toBe(1);

      let settled = false;
      const running = runMigrations().then(() => {
        settled = true;
      });
      await new Promise((r) => setTimeout(r, 500));
      expect(settled).toBe(false);

      await holder.query('SELECT RELEASE_LOCK(?)', [lockName]);
      await running;
      expect(settled).toBe(true);
    } finally {
      await holder.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
      await holder.end();
    }
  }, 20_000);

  it('releases the lock before the connection goes back to the pool', async () => {
    stubMigrationFiles();
    await runMigrations();
    const probe = await newConnection();
    try {
      const [rows] = await probe.query<RowDataPacket[]>('SELECT GET_LOCK(?, 10) AS acquired', [
        lockName,
      ]);
      expect(Number(rows[0].acquired)).toBe(1);
    } finally {
      await probe.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
      await probe.end();
    }
  }, 20_000);
});

import mysql from 'mysql2/promise';
import { getConfig } from '../config';
import { logger } from '../utils/logger';

let pool: mysql.Pool;

export async function createPool(): Promise<mysql.Pool> {
  const config = getConfig();

  pool = mysql.createPool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 50,
    queueLimit: 100,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  });

  // Test connection with retry
  let retries = 10;
  while (retries > 0) {
    try {
      const conn = await pool.getConnection();
      conn.release();
      logger.info('Database connection established');
      return pool;
    } catch (err) {
      retries--;
      if (retries === 0) throw err;
      logger.warn(`Database connection failed, retrying... (${retries} attempts left)`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return pool;
}

export function getPool(): mysql.Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call createPool() first.');
  }
  return pool;
}

/**
 * Statement parameter values accepted by mysql2's execute(), derived from the driver
 * signature (mysql2 does not re-export its ExecuteValues type). Callers pass `unknown[]`
 * at this boundary; the single assertion below converts to the driver type, and mysql2
 * validates the actual values at runtime.
 */
type SqlParams = Parameters<mysql.Pool['execute']>[1];

export async function query<T extends mysql.RowDataPacket[]>(
  sql: string,
  params?: unknown[],
): Promise<T> {
  const [rows] = await getPool().execute<T>(sql, params as SqlParams);
  return rows;
}

export async function execute(sql: string, params?: unknown[]): Promise<mysql.ResultSetHeader> {
  const [result] = await getPool().execute<mysql.ResultSetHeader>(sql, params as SqlParams);
  return result;
}

/**
 * True when `err` is MySQL's unique-key violation (ER_DUP_ENTRY, errno 1062).
 *
 * The check-then-write pattern on unique columns (username, email_hash) leaves a window in which a
 * concurrent duplicate reaches the INSERT/UPDATE and surfaces as a driver error — a 500 — instead
 * of the 409 the preceding SELECT was meant to produce. Callers catch this and rethrow the same
 * AppError they would have thrown had the SELECT seen the row. (audit B13)
 */
export function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; errno?: unknown };
  return e.code === 'ER_DUP_ENTRY' || e.errno === 1062;
}

/**
 * Execute a function within a database transaction.
 * Automatically commits on success, rolls back on error.
 */
export async function withTransaction<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

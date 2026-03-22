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
    connectionLimit: 20,
    queueLimit: 50,
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

export async function query<T extends mysql.RowDataPacket[]>(
  sql: string,
  params?: any[],
): Promise<T> {
  const [rows] = await getPool().execute<T>(sql, params);
  return rows;
}

export async function execute(sql: string, params?: any[]): Promise<mysql.ResultSetHeader> {
  const [result] = await getPool().execute<mysql.ResultSetHeader>(sql, params);
  return result;
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

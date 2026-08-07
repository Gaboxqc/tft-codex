/**
 * Postgres connection pool.
 *
 * Thin on purpose — no ORM. The queries in this codebase are either simple
 * entity reads or bulk upserts, and hand-written SQL keeps the ingestion path
 * (the part that matters for rate-limit budget and throughput) legible.
 */
import pg from 'pg';

const { Pool } = pg;

export type Database = pg.Pool;

export function createPostgresPool(connectionString: string): Database {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // An unhandled 'error' event on an idle client crashes the process by
  // default. Log and let the pool replace the client instead.
  pool.on('error', (error) => {
    console.error('[postgres] idle client error', error);
  });

  return pool;
}

/** Runs `fn` inside a transaction, rolling back on any throw. */
export async function withTransaction<T>(
  db: Database,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Migration runner.
 *
 * Plain `.sql` files applied in filename order, each in its own transaction,
 * recorded in `schema_migrations`. A migration tool would be more capable; this
 * is enough for a schema this size and keeps the SQL readable as SQL — which
 * matters here because `001_initial.sql` documents compliance decisions
 * (the augment-stats grant boundary) that a generated schema would bury.
 *
 * Usage: `npm run migrate --workspace @tft-codex/api`
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config.js';
import { createPostgresPool, withTransaction, type Database } from './postgres.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

async function ensureMigrationsTable(db: Database): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function runMigrations(db: Database): Promise<string[]> {
  await ensureMigrationsTable(db);

  const { rows } = await db.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));

  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await withTransaction(db, async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    newlyApplied.push(file);
  }

  return newlyApplied;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createPostgresPool(config.postgres.connectionString);
  try {
    const applied = await runMigrations(db);
    if (applied.length === 0) {
      console.warn('[migrate] schema already up to date');
    } else {
      for (const name of applied) console.warn(`[migrate] applied ${name}`);
    }
  } finally {
    await db.end();
  }
}

// Only run when invoked directly, so tests can import `runMigrations`.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  main().catch((error: unknown) => {
    console.error('[migrate] failed', error);
    process.exitCode = 1;
  });
}

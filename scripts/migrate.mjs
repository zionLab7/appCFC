import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, 'packages/database/migrations');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://gpcfc:gpcfc_dev_only@localhost:5432/gpcfc' });
await client.connect();
try {
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  // One migration runner holds the database lock; each file and its version entry commit together.
  await client.query('SELECT pg_advisory_lock(654388017)');
  try {
    for (const file of (await readdir(dir)).filter(x => /^\d+_.*\.sql$/.test(x)).sort()) {
      if ((await client.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [file])).rowCount) continue;
      await client.query('BEGIN');
      try {
        await client.query(await readFile(resolve(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        process.stdout.write(`Applied ${file}\n`);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally { await client.query('SELECT pg_advisory_unlock(654388017)'); }
} finally { await client.end(); }

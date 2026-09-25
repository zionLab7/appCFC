import { readFile } from 'node:fs/promises';
import pg from 'pg';
const client = new pg.Client({connectionString:process.env.DATABASE_URL ?? 'postgres://gpcfc:gpcfc_dev_only@localhost:5432/gpcfc'});
await client.connect();
try { await client.query(await readFile(new URL('../packages/database/seeds/dev.sql', import.meta.url), 'utf8')); process.stdout.write('Development seed applied\n'); }
finally { await client.end(); }

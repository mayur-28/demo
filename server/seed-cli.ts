// Resets the database file and loads demo data: `npm run seed`
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb } from './db.ts';
import { seed } from './seed.ts';

const file = resolve(process.env.DATABASE_FILE ?? 'data/fuelform.db');
for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) unlinkSync(f);
seed(openDb(file));
console.log(`Demo data written to ${file}`);

import { resolve } from 'node:path';
import { createApp } from './app.ts';
import { openDb, get } from './db.ts';
import { seed } from './seed.ts';

const port = Number(process.env.PORT ?? 3001);
const dbFile = resolve(process.env.DATABASE_FILE ?? 'data/fuelform.db');
const db = openDb(dbFile);

if (!get(db, 'SELECT id FROM users LIMIT 1')) {
  seed(db);
  console.log('Seeded demo data. Sign in as coach@demo.app or alex@demo.app (password: demo1234).');
}

const app = createApp(db, { staticDir: process.env.NODE_ENV === 'production' ? resolve('dist') : undefined });
app.listen(port, () => console.log(`FuelForm API listening on http://localhost:${port} (db: ${dbFile})`));

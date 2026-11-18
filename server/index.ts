import { resolve } from 'node:path';
import { createApp } from './app.ts';
import { openDb, get } from './db.ts';
import { seed } from './seed.ts';
import { registerSchema } from '../shared/schemas.ts';

const port = Number(process.env.PORT ?? 3001);
const dbFile = resolve(process.env.DATABASE_FILE ?? 'data/fuelform.db');
const db = openDb(dbFile);

// First start: load the libraries and templates. Demo users are on unless SEED_DEMO=false.
if (!get(db, 'SELECT id FROM users LIMIT 1')) {
  const demoUsers = process.env.SEED_DEMO !== 'false';
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  let admin;
  if (ADMIN_EMAIL || ADMIN_PASSWORD) {
    const parsed = registerSchema.safeParse({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME || 'Coach' });
    if (!parsed.success) {
      console.error(`Invalid ADMIN_EMAIL / ADMIN_PASSWORD: ${parsed.error.issues[0].message}`);
      process.exit(1);
    }
    admin = parsed.data;
  } else if (!demoUsers) {
    console.error('SEED_DEMO=false needs ADMIN_EMAIL and ADMIN_PASSWORD so a coach account exists.');
    process.exit(1);
  }
  seed(db, undefined, { demoUsers, admin });
  console.log(demoUsers
    ? 'Seeded demo data. Sign in as coach@demo.app or alex@demo.app (password: demo1234).'
    : `Created coach account ${admin!.email} with the exercise and food libraries and plan templates.`);
}

const app = createApp(db, { staticDir: process.env.NODE_ENV === 'production' ? resolve('dist') : undefined });
app.listen(port, () => console.log(`FuelForm listening on port ${port} (db: ${dbFile})`));

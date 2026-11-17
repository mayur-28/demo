import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

// Loaded via require so bundlers/test runners that don't know the newer
// `node:sqlite` builtin leave it alone.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
import { dirname } from 'node:path';

export type DB = DatabaseSyncType;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- A profile row exists once onboarding is complete.
CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age INTEGER NOT NULL CHECK (age BETWEEN 16 AND 100),
  height_cm REAL NOT NULL CHECK (height_cm BETWEEN 100 AND 250),
  weight_kg REAL NOT NULL CHECK (weight_kg BETWEEN 30 AND 300),
  sex TEXT NOT NULL DEFAULT 'unspecified',
  units TEXT NOT NULL DEFAULT 'metric',
  activity_level TEXT NOT NULL,
  goal TEXT NOT NULL,
  dietary_preference TEXT NOT NULL DEFAULT 'none',
  allergies TEXT NOT NULL DEFAULT '[]',
  other_allergies TEXT NOT NULL DEFAULT '',
  equipment TEXT NOT NULL DEFAULT '[]',
  custom_targets TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  muscle_group TEXT NOT NULL,
  training_type TEXT NOT NULL,
  equipment TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS foods (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  serving_size REAL NOT NULL CHECK (serving_size > 0),
  serving_unit TEXT NOT NULL,
  calories REAL NOT NULL CHECK (calories >= 0),
  protein REAL NOT NULL CHECK (protein >= 0),
  carbs REAL NOT NULL CHECK (carbs >= 0),
  fat REAL NOT NULL CHECK (fat >= 0),
  allergens TEXT NOT NULL DEFAULT '[]',
  diet_tags TEXT NOT NULL DEFAULT '[]',
  is_approximate INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- kind = 'template' (shared, coach-owned, owner_id NULL) or 'personal' (a user's private copy).
CREATE TABLE IF NOT EXISTS workout_plans (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('template','personal')),
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  source_plan_id INTEGER REFERENCES workout_plans(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((kind = 'template' AND owner_id IS NULL) OR (kind = 'personal' AND owner_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS workout_days (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES workout_plans(id) ON DELETE CASCADE,
  day_index INTEGER NOT NULL CHECK (day_index BETWEEN 0 AND 6),
  name TEXT NOT NULL,
  focus TEXT,
  training_type TEXT,
  UNIQUE (plan_id, day_index)
);

CREATE TABLE IF NOT EXISTS workout_items (
  id INTEGER PRIMARY KEY,
  day_id INTEGER NOT NULL REFERENCES workout_days(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  position INTEGER NOT NULL,
  sets INTEGER NOT NULL CHECK (sets BETWEEN 1 AND 20),
  reps INTEGER CHECK (reps IS NULL OR reps > 0),
  duration_sec INTEGER CHECK (duration_sec IS NULL OR duration_sec > 0),
  rest_sec INTEGER NOT NULL DEFAULT 60 CHECK (rest_sec >= 0),
  weight_kg REAL CHECK (weight_kg IS NULL OR weight_kg >= 0),
  notes TEXT NOT NULL DEFAULT '',
  CHECK (reps IS NOT NULL OR duration_sec IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS diet_plans (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('template','personal')),
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  source_plan_id INTEGER REFERENCES diet_plans(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((kind = 'template' AND owner_id IS NULL) OR (kind = 'personal' AND owner_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS diet_items (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES diet_plans(id) ON DELETE CASCADE,
  day_index INTEGER NOT NULL CHECK (day_index BETWEEN 0 AND 6),
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
  food_id INTEGER NOT NULL REFERENCES foods(id),
  servings REAL NOT NULL CHECK (servings > 0 AND servings <= 20),
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workout_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES workout_plans(id) ON DELETE SET NULL,
  day_index INTEGER,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workout_log_entries (
  id INTEGER PRIMARY KEY,
  log_id INTEGER NOT NULL REFERENCES workout_logs(id) ON DELETE CASCADE,
  exercise_id INTEGER REFERENCES exercises(id) ON DELETE SET NULL,
  exercise_name TEXT NOT NULL,
  position INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workout_log_sets (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES workout_log_entries(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL,
  reps INTEGER CHECK (reps IS NULL OR reps >= 0),
  weight_kg REAL CHECK (weight_kg IS NULL OR weight_kg >= 0),
  duration_sec INTEGER CHECK (duration_sec IS NULL OR duration_sec >= 0)
);

-- Food logs snapshot the food's per-serving nutrition so history stays stable if a
-- coach later corrects a library entry. Totals are always servings x snapshot.
CREATE TABLE IF NOT EXISTS food_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
  food_id INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  food_name TEXT NOT NULL,
  serving_size REAL NOT NULL CHECK (serving_size > 0),
  serving_unit TEXT NOT NULL,
  servings REAL NOT NULL CHECK (servings > 0 AND servings <= 20),
  calories_per_serving REAL NOT NULL CHECK (calories_per_serving >= 0),
  protein_per_serving REAL NOT NULL CHECK (protein_per_serving >= 0),
  carbs_per_serving REAL NOT NULL CHECK (carbs_per_serving >= 0),
  fat_per_serving REAL NOT NULL CHECK (fat_per_serving >= 0),
  is_approximate INTEGER NOT NULL DEFAULT 1,
  allergens TEXT NOT NULL DEFAULT '[]',
  diet_tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weight_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  weight_kg REAL NOT NULL CHECK (weight_kg BETWEEN 30 AND 300),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_food_logs_user_date ON food_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_workout_logs_user_date ON workout_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_workout_plans_owner ON workout_plans(owner_id, kind);
CREATE INDEX IF NOT EXISTS idx_diet_plans_owner ON diet_plans(owner_id, kind);
CREATE INDEX IF NOT EXISTS idx_workout_items_day ON workout_items(day_id);
CREATE INDEX IF NOT EXISTS idx_diet_items_plan ON diet_items(plan_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

export function openDb(file = ':memory:'): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/** Run `fn` inside a transaction; rolls back on any thrown error. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export type Row = Record<string, unknown>;

export function all<T = Row>(db: DB, sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}
export function get<T = Row>(db: DB, sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}
export function run(db: DB, sql: string, ...params: unknown[]): { id: number; changes: number } {
  const r = db.prepare(sql).run(...(params as never[]));
  return { id: Number(r.lastInsertRowid), changes: Number(r.changes) };
}

export const parseJson = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

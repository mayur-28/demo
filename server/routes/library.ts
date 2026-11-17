import { Router } from 'express';
import { all, get, run, type DB } from '../db.ts';
import { requireAdmin } from '../auth.ts';
import { h, idParam, notFound, validate } from '../http.ts';
import { exerciseSchema, foodSchema } from '../../shared/schemas.ts';
import { EQUIPMENT, MUSCLE_GROUPS, TRAINING_TYPES } from '../../shared/constants.ts';
import { mapExercise, mapFood } from '../services.ts';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

export function libraryRoutes(db: DB) {
  const r = Router();

  // ------------------------------------------------ exercises
  r.get('/exercises', h((req) => {
    const where: string[] = [];
    const params: unknown[] = [];
    const q = str(req.query.q);
    if (q) { where.push("(name LIKE ? ESCAPE '\\' OR instructions LIKE ? ESCAPE '\\')"); params.push(like(q), like(q)); }
    const mg = str(req.query.muscleGroup);
    if ((MUSCLE_GROUPS as readonly string[]).includes(mg)) { where.push('muscle_group = ?'); params.push(mg); }
    const tt = str(req.query.trainingType);
    if ((TRAINING_TYPES as readonly string[]).includes(tt)) { where.push('training_type = ?'); params.push(tt); }
    const eq = str(req.query.equipment).split(',').filter((e) => (EQUIPMENT as readonly string[]).includes(e));
    if (eq.length) { where.push(`equipment IN (${eq.map(() => '?').join(',')})`); params.push(...eq); }
    if (!(req.user!.role === 'admin' && req.query.includeArchived === '1')) where.push('archived = 0');
    const rows = all(db, `SELECT * FROM exercises ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name LIMIT 300`, ...params);
    return rows.map(mapExercise);
  }));

  r.get('/exercises/:id', h((req) => {
    const row = get(db, 'SELECT * FROM exercises WHERE id = ?', idParam(req));
    if (!row) throw notFound('Exercise');
    return mapExercise(row);
  }));

  r.post('/exercises', requireAdmin, h((req, res) => {
    const e = validate(exerciseSchema, req.body);
    const { id } = run(db, 'INSERT INTO exercises (name, muscle_group, training_type, equipment, instructions, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      e.name, e.muscleGroup, e.trainingType, e.equipment, e.instructions, req.user!.id);
    res.status(201);
    return mapExercise(get(db, 'SELECT * FROM exercises WHERE id = ?', id)!);
  }));

  r.put('/exercises/:id', requireAdmin, h((req) => {
    const id = idParam(req);
    const e = validate(exerciseSchema, req.body);
    const { changes } = run(db, 'UPDATE exercises SET name = ?, muscle_group = ?, training_type = ?, equipment = ?, instructions = ?, archived = 0 WHERE id = ?',
      e.name, e.muscleGroup, e.trainingType, e.equipment, e.instructions, id);
    if (!changes) throw notFound('Exercise');
    return mapExercise(get(db, 'SELECT * FROM exercises WHERE id = ?', id)!);
  }));

  /** Archives exercises that plans or logs still reference; deletes unused ones. */
  r.delete('/exercises/:id', requireAdmin, h((req) => {
    const id = idParam(req);
    if (!get(db, 'SELECT id FROM exercises WHERE id = ?', id)) throw notFound('Exercise');
    const used = get(db, 'SELECT 1 FROM workout_items WHERE exercise_id = ? UNION SELECT 1 FROM workout_log_entries WHERE exercise_id = ? LIMIT 1', id, id);
    if (used) {
      run(db, 'UPDATE exercises SET archived = 1 WHERE id = ?', id);
      return { archived: true };
    }
    run(db, 'DELETE FROM exercises WHERE id = ?', id);
    return { deleted: true };
  }));

  // ------------------------------------------------ foods
  r.get('/foods', h((req) => {
    const where: string[] = [];
    const params: unknown[] = [];
    const q = str(req.query.q);
    if (q) { where.push("(name LIKE ? ESCAPE '\\' OR brand LIKE ? ESCAPE '\\')"); params.push(like(q), like(q)); }
    if (!(req.user!.role === 'admin' && req.query.includeArchived === '1')) where.push('archived = 0');
    const rows = all(db, `SELECT * FROM foods ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name LIMIT 300`, ...params);
    return rows.map(mapFood);
  }));

  r.get('/foods/:id', h((req) => {
    const row = get(db, 'SELECT * FROM foods WHERE id = ?', idParam(req));
    if (!row) throw notFound('Food');
    return mapFood(row);
  }));

  r.post('/foods', requireAdmin, h((req, res) => {
    const f = validate(foodSchema, req.body);
    const { id } = run(db,
      `INSERT INTO foods (name, brand, serving_size, serving_unit, calories, protein, carbs, fat, allergens, diet_tags, is_approximate, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      f.name, f.brand, f.servingSize, f.servingUnit, f.calories, f.protein, f.carbs, f.fat,
      JSON.stringify(f.allergens), JSON.stringify(f.dietTags), f.isApproximate ? 1 : 0, req.user!.id);
    res.status(201);
    return mapFood(get(db, 'SELECT * FROM foods WHERE id = ?', id)!);
  }));

  // Editing a food updates plans (they reference it live) but never past food logs (they hold a snapshot).
  r.put('/foods/:id', requireAdmin, h((req) => {
    const id = idParam(req);
    const f = validate(foodSchema, req.body);
    const { changes } = run(db,
      `UPDATE foods SET name = ?, brand = ?, serving_size = ?, serving_unit = ?, calories = ?, protein = ?, carbs = ?, fat = ?,
         allergens = ?, diet_tags = ?, is_approximate = ?, archived = 0, updated_at = datetime('now') WHERE id = ?`,
      f.name, f.brand, f.servingSize, f.servingUnit, f.calories, f.protein, f.carbs, f.fat,
      JSON.stringify(f.allergens), JSON.stringify(f.dietTags), f.isApproximate ? 1 : 0, id);
    if (!changes) throw notFound('Food');
    return mapFood(get(db, 'SELECT * FROM foods WHERE id = ?', id)!);
  }));

  r.delete('/foods/:id', requireAdmin, h((req) => {
    const id = idParam(req);
    if (!get(db, 'SELECT id FROM foods WHERE id = ?', id)) throw notFound('Food');
    const used = get(db, 'SELECT 1 FROM diet_items WHERE food_id = ? UNION SELECT 1 FROM food_logs WHERE food_id = ? LIMIT 1', id, id);
    if (used) {
      run(db, 'UPDATE foods SET archived = 1 WHERE id = ?', id);
      return { archived: true };
    }
    run(db, 'DELETE FROM foods WHERE id = ?', id);
    return { deleted: true };
  }));

  return r;
}

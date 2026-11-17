import { Router } from 'express';
import { all, get, run, type DB } from '../db.ts';
import { requireAdmin } from '../auth.ts';
import { h, HttpError, idParam, notFound, validate } from '../http.ts';
import { foodLogSchema, foodLogUpdateSchema, isoDate, weightLogSchema, workoutLogSchema } from '../../shared/schemas.ts';
import { MEAL_TYPES } from '../../shared/constants.ts';
import { addDays, dateRange, localToday, weekdayIndex } from '../../shared/dates.ts';
import { sumMacros } from '../../shared/nutrition.ts';
import { z } from 'zod';
import {
  activePlanId, daySummary, foodLogsForRange, getProfile, loadDietItems, loadPlanMeta, loadWorkoutDays, loadWorkoutLogs,
  mapFoodLog, summarizeDay, targetsFor, weekSummary, writeWorkoutLog,
} from '../services.ts';
import type { AdminUserRow, Dashboard, ExerciseTrend, Progress } from '../../shared/types.ts';

const dateQuery = (v: unknown, fallback = localToday()) => (v === undefined || v === '' ? fallback : validate(isoDate, v));

export function trackingRoutes(db: DB) {
  const r = Router();

  // ------------------------------------------------ food logs
  r.get('/food-logs', h((req) => daySummary(db, req.user!.id, dateQuery(req.query.date))));

  r.get('/food-logs/range', h((req) => {
    const end = dateQuery(req.query.end);
    const start = dateQuery(req.query.start, addDays(end, -6));
    if (start > end) throw new HttpError(400, 'Start date must be before end date');
    if (dateRange(start, end).length > 92) throw new HttpError(400, 'Range is limited to 92 days');
    const logs = foodLogsForRange(db, req.user!.id, start, end);
    return dateRange(start, end).map((d) => summarizeDay(d, logs.filter((l) => l.date === d)));
  }));

  r.post('/food-logs', h((req, res) => {
    const input = validate(foodLogSchema, req.body);
    const food = get(db, 'SELECT * FROM foods WHERE id = ? AND archived = 0', input.foodId);
    if (!food) throw new HttpError(400, 'That food is not available');
    const { id } = run(db,
      `INSERT INTO food_logs (user_id, date, meal_type, food_id, food_name, serving_size, serving_unit, servings,
         calories_per_serving, protein_per_serving, carbs_per_serving, fat_per_serving, is_approximate, allergens, diet_tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      req.user!.id, input.date, input.mealType, food.id, food.name, food.serving_size, food.serving_unit, input.servings,
      food.calories, food.protein, food.carbs, food.fat, food.is_approximate, food.allergens, food.diet_tags);
    res.status(201);
    return mapFoodLog(get(db, 'SELECT * FROM food_logs WHERE id = ?', id)!);
  }));

  /** Log every item of one planned meal (or the whole day) from the user's diet plan. */
  r.post('/food-logs/from-plan', h((req, res) => {
    const input = validate(z.object({
      date: isoDate,
      planId: z.number().int().positive(),
      mealType: z.enum(MEAL_TYPES).nullable().default(null),
    }), req.body);
    loadPlanMeta(db, 'diet_plans', input.planId, { kind: 'personal', ownerId: req.user!.id });
    const items = loadDietItems(db, input.planId, weekdayIndex(input.date))
      .filter((i) => !input.mealType || i.mealType === input.mealType)
      .filter((i) => !i.food.archived);
    if (!items.length) throw new HttpError(400, 'Nothing is planned for that meal');
    for (const i of items) {
      run(db,
        `INSERT INTO food_logs (user_id, date, meal_type, food_id, food_name, serving_size, serving_unit, servings,
           calories_per_serving, protein_per_serving, carbs_per_serving, fat_per_serving, is_approximate, allergens, diet_tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        req.user!.id, input.date, i.mealType, i.food.id, i.food.name, i.food.servingSize, i.food.servingUnit, i.servings,
        i.food.calories, i.food.protein, i.food.carbs, i.food.fat, i.food.isApproximate ? 1 : 0,
        JSON.stringify(i.food.allergens), JSON.stringify(i.food.dietTags));
    }
    res.status(201);
    return daySummary(db, req.user!.id, input.date);
  }));

  r.patch('/food-logs/:id', h((req) => {
    const id = idParam(req);
    const input = validate(foodLogUpdateSchema, req.body);
    const existing = get(db, 'SELECT * FROM food_logs WHERE id = ? AND user_id = ?', id, req.user!.id);
    if (!existing) throw notFound('Log entry');
    run(db, "UPDATE food_logs SET servings = ?, meal_type = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      input.servings ?? existing.servings, input.mealType ?? existing.meal_type, id, req.user!.id);
    return mapFoodLog(get(db, 'SELECT * FROM food_logs WHERE id = ?', id)!);
  }));

  r.delete('/food-logs/:id', h((req) => {
    const { changes } = run(db, 'DELETE FROM food_logs WHERE id = ? AND user_id = ?', idParam(req), req.user!.id);
    if (!changes) throw notFound('Log entry');
    return { deleted: true };
  }));

  // ------------------------------------------------ workout logs
  r.get('/workout-logs', h((req) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    return loadWorkoutLogs(db, req.user!.id, { limit });
  }));

  r.get('/workout-logs/:id', h((req) => {
    const [log] = loadWorkoutLogs(db, req.user!.id, { id: idParam(req) });
    if (!log) throw notFound('Workout');
    return log;
  }));

  r.post('/workout-logs', h((req, res) => {
    const id = writeWorkoutLog(db, req.user!.id, validate(workoutLogSchema, req.body));
    res.status(201);
    return loadWorkoutLogs(db, req.user!.id, { id })[0];
  }));

  r.put('/workout-logs/:id', h((req) => {
    const id = idParam(req);
    if (!get(db, 'SELECT id FROM workout_logs WHERE id = ? AND user_id = ?', id, req.user!.id)) throw notFound('Workout');
    writeWorkoutLog(db, req.user!.id, validate(workoutLogSchema, req.body), id);
    return loadWorkoutLogs(db, req.user!.id, { id })[0];
  }));

  r.delete('/workout-logs/:id', h((req) => {
    const { changes } = run(db, 'DELETE FROM workout_logs WHERE id = ? AND user_id = ?', idParam(req), req.user!.id);
    if (!changes) throw notFound('Workout');
    return { deleted: true };
  }));

  // ------------------------------------------------ body weight
  r.get('/weights', h((req) => all(db, 'SELECT id, date, weight_kg AS weightKg FROM weight_logs WHERE user_id = ? ORDER BY date DESC LIMIT 120', req.user!.id)));

  r.post('/weights', h((req, res) => {
    const w = validate(weightLogSchema, req.body);
    run(db, 'INSERT INTO weight_logs (user_id, date, weight_kg) VALUES (?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg',
      req.user!.id, w.date, w.weightKg);
    res.status(201);
    return get(db, 'SELECT id, date, weight_kg AS weightKg FROM weight_logs WHERE user_id = ? AND date = ?', req.user!.id, w.date);
  }));

  r.delete('/weights/:id', h((req) => {
    const { changes } = run(db, 'DELETE FROM weight_logs WHERE id = ? AND user_id = ?', idParam(req), req.user!.id);
    if (!changes) throw notFound('Weight entry');
    return { deleted: true };
  }));

  // ------------------------------------------------ dashboard & progress
  r.get('/dashboard', h((req): Dashboard => {
    const uid = req.user!.id;
    const date = dateQuery(req.query.date);
    const dow = weekdayIndex(date);
    const wpId = activePlanId(db, 'workout_plans', uid);
    const dpId = activePlanId(db, 'diet_plans', uid);
    const wp = wpId ? get(db, 'SELECT id, name FROM workout_plans WHERE id = ?', wpId) : undefined;
    const dp = dpId ? get(db, 'SELECT id, name FROM diet_plans WHERE id = ?', dpId) : undefined;
    return {
      date,
      targets: targetsFor(getProfile(db, uid)),
      today: daySummary(db, uid, date),
      workout: {
        plan: wp ? { id: Number(wp.id), name: String(wp.name) } : null,
        day: wpId ? loadWorkoutDays(db, wpId).find((d) => d.dayIndex === dow) ?? null : null,
        loggedToday: loadWorkoutLogs(db, uid, { start: date, end: date }),
      },
      meals: {
        plan: dp ? { id: Number(dp.id), name: String(dp.name) } : null,
        items: dpId ? loadDietItems(db, dpId, dow) : [],
      },
      week: weekSummary(db, uid, date),
    };
  }));

  r.get('/progress', h((req): Progress => {
    const uid = req.user!.id;
    const end = dateQuery(req.query.end);
    const span = Math.min(90, Math.max(7, Number(req.query.days) || 7));
    const start = addDays(end, -(span - 1));
    const food = foodLogsForRange(db, uid, start, end);
    const workouts = loadWorkoutLogs(db, uid, { start, end, limit: 200 });
    const days = dateRange(start, end).map((d) => {
      const entries = food.filter((f) => f.date === d);
      return { date: d, ...sumMacros(entries.map((e) => e.nutrition)), workouts: workouts.filter((w) => w.date === d).length, logged: entries.length > 0 };
    });

    // Strength trend: best weight per session, first vs latest, for most-logged exercises (last 90 days).
    const sets = all(db,
      `SELECT e.exercise_id, e.exercise_name, l.date, MAX(s.weight_kg) AS best
       FROM workout_log_sets s JOIN workout_log_entries e ON e.id = s.entry_id JOIN workout_logs l ON l.id = e.log_id
       WHERE l.user_id = ? AND e.completed = 1 AND s.weight_kg > 0 AND l.date BETWEEN ? AND ?
       GROUP BY e.exercise_id, l.id ORDER BY l.date`, uid, addDays(end, -89), end);
    const byEx = new Map<number, typeof sets>();
    for (const s of sets) {
      if (s.exercise_id === null) continue;
      const k = Number(s.exercise_id);
      byEx.set(k, [...(byEx.get(k) ?? []), s]);
    }
    const exerciseTrends: ExerciseTrend[] = [...byEx.entries()]
      .map(([id, rows]) => ({
        exerciseId: id,
        name: String(rows[rows.length - 1].exercise_name),
        sessions: rows.length,
        firstBestKg: Number(rows[0].best),
        latestBestKg: Number(rows[rows.length - 1].best),
        firstDate: String(rows[0].date),
        latestDate: String(rows[rows.length - 1].date),
      }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 6);

    return {
      days,
      week: weekSummary(db, uid, end),
      weights: all<{ date: string; weightKg: number }>(db,
        'SELECT date, weight_kg AS weightKg FROM weight_logs WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date', uid, addDays(end, -89), end),
      exerciseTrends,
      targets: targetsFor(getProfile(db, uid)),
    };
  }));

  // ------------------------------------------------ admin: who can plans be assigned to
  r.get('/admin/users', requireAdmin, h((): AdminUserRow[] =>
    all(db,
      `SELECT u.id, u.name, u.email, u.role, (p.user_id IS NOT NULL) AS onboarded,
         (SELECT name FROM workout_plans w WHERE w.owner_id = u.id AND w.active = 1 LIMIT 1) AS awp,
         (SELECT name FROM diet_plans d WHERE d.owner_id = u.id AND d.active = 1 LIMIT 1) AS adp
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id ORDER BY u.role, u.name`,
    ).map((u) => ({
      id: Number(u.id), name: String(u.name), email: String(u.email), role: u.role as AdminUserRow['role'], onboarded: Boolean(u.onboarded),
      activeWorkoutPlan: (u.awp as string) ?? null, activeDietPlan: (u.adp as string) ?? null,
    }))));

  return r;
}

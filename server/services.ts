// Data access and domain logic shared by the route handlers.
import { all, get, parseJson, run, tx, type DB, type Row } from './db.ts';
import { HttpError, notFound } from './http.ts';
import { MEAL_TYPES, type MealType } from '../shared/constants.ts';
import { addDays, dateRange, startOfWeek, weekdayIndex } from '../shared/dates.ts';
import { estimateTargets } from '../shared/goals.ts';
import { scaleNutrition, sumMacros, ZERO_MACROS, type Macros } from '../shared/nutrition.ts';
import type { DietPlanInput, ProfileInput, WorkoutLogInput, WorkoutPlanInput } from '../shared/schemas.ts';
import type {
  DaySummary, DietItem, DietPlan, DietPlanSummary, Exercise, Food, FoodLogEntry, PlanKind, PlanMeta, Profile, Targets,
  WeekSummary, WorkoutDay, WorkoutLog, WorkoutPlan, WorkoutPlanSummary,
} from '../shared/types.ts';

// ---------------------------------------------------------------- mappers
export const mapExercise = (r: Row): Exercise => ({
  id: Number(r.id),
  name: String(r.name),
  muscleGroup: r.muscle_group as Exercise['muscleGroup'],
  trainingType: r.training_type as Exercise['trainingType'],
  equipment: r.equipment as Exercise['equipment'],
  instructions: String(r.instructions ?? ''),
  archived: Boolean(r.archived),
});

export const mapFood = (r: Row): Food => ({
  id: Number(r.id),
  name: String(r.name),
  brand: String(r.brand ?? ''),
  servingSize: Number(r.serving_size),
  servingUnit: r.serving_unit as Food['servingUnit'],
  calories: Number(r.calories),
  protein: Number(r.protein),
  carbs: Number(r.carbs),
  fat: Number(r.fat),
  allergens: parseJson(r.allergens, []),
  dietTags: parseJson(r.diet_tags, []),
  isApproximate: Boolean(r.is_approximate),
  archived: Boolean(r.archived),
});

export const mapFoodLog = (r: Row): FoodLogEntry => {
  const perServing: Macros = {
    calories: Number(r.calories_per_serving),
    protein: Number(r.protein_per_serving),
    carbs: Number(r.carbs_per_serving),
    fat: Number(r.fat_per_serving),
  };
  const servings = Number(r.servings);
  return {
    id: Number(r.id),
    date: String(r.date),
    mealType: r.meal_type as MealType,
    foodId: r.food_id === null ? null : Number(r.food_id),
    foodName: String(r.food_name),
    servingSize: Number(r.serving_size),
    servingUnit: r.serving_unit as FoodLogEntry['servingUnit'],
    servings,
    perServing,
    nutrition: scaleNutrition(perServing, servings),
    isApproximate: Boolean(r.is_approximate),
    allergens: parseJson(r.allergens, []),
    dietTags: parseJson(r.diet_tags, []),
  };
};

const mapPlanMeta = (r: Row): PlanMeta => ({
  id: Number(r.id),
  kind: r.kind as PlanKind,
  ownerId: r.owner_id === null ? null : Number(r.owner_id),
  ownerName: (r.owner_name as string) ?? null,
  sourcePlanId: r.source_plan_id === null ? null : Number(r.source_plan_id),
  sourcePlanName: (r.source_name as string) ?? null,
  name: String(r.name),
  description: String(r.description ?? ''),
  active: Boolean(r.active),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

// ---------------------------------------------------------------- profile & targets
export function getProfile(db: DB, userId: number): Profile | null {
  const r = get(db, 'SELECT p.*, u.name FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?', userId);
  if (!r) return null;
  return {
    name: String(r.name),
    age: Number(r.age),
    heightCm: Number(r.height_cm),
    weightKg: Number(r.weight_kg),
    sex: r.sex as Profile['sex'],
    units: r.units as Profile['units'],
    activityLevel: r.activity_level as Profile['activityLevel'],
    goal: r.goal as Profile['goal'],
    dietaryPreference: r.dietary_preference as Profile['dietaryPreference'],
    allergies: parseJson(r.allergies, []),
    otherAllergies: String(r.other_allergies ?? ''),
    equipment: parseJson(r.equipment, []),
    customTargets: parseJson(r.custom_targets, null),
  };
}

export function targetsFor(profile: Profile | null): Targets | null {
  if (!profile) return null;
  const est = estimateTargets(profile);
  if (profile.customTargets) return { ...profile.customTargets, isCustom: true, maintenance: est.maintenance };
  return { calories: est.calories, protein: est.protein, carbs: est.carbs, fat: est.fat, isCustom: false, maintenance: est.maintenance };
}

export function saveProfile(db: DB, userId: number, p: ProfileInput): void {
  tx(db, () => {
    run(db, 'UPDATE users SET name = ? WHERE id = ?', p.name, userId);
    run(
      db,
      `INSERT INTO profiles (user_id, age, height_cm, weight_kg, sex, units, activity_level, goal, dietary_preference,
         allergies, other_allergies, equipment, custom_targets, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET age=excluded.age, height_cm=excluded.height_cm, weight_kg=excluded.weight_kg,
         sex=excluded.sex, units=excluded.units, activity_level=excluded.activity_level, goal=excluded.goal,
         dietary_preference=excluded.dietary_preference, allergies=excluded.allergies, other_allergies=excluded.other_allergies,
         equipment=excluded.equipment, custom_targets=excluded.custom_targets, updated_at=excluded.updated_at`,
      userId, p.age, p.heightCm, p.weightKg, p.sex, p.units, p.activityLevel, p.goal, p.dietaryPreference,
      JSON.stringify(p.allergies), p.otherAllergies, JSON.stringify(p.equipment),
      p.customTargets ? JSON.stringify(p.customTargets) : null,
    );
  });
}

// ---------------------------------------------------------------- plans (generic)
type PlanTable = 'workout_plans' | 'diet_plans';

const planMetaSql = (table: PlanTable) => `
  SELECT p.*, o.name AS owner_name, s.name AS source_name
  FROM ${table} p
  LEFT JOIN users o ON o.id = p.owner_id
  LEFT JOIN ${table} s ON s.id = p.source_plan_id`;

/** Load a plan's metadata, enforcing kind and (for personal plans) ownership. 404 otherwise. */
export function loadPlanMeta(db: DB, table: PlanTable, id: number, access: { kind: PlanKind; ownerId?: number }): PlanMeta {
  const r = get(db, `${planMetaSql(table)} WHERE p.id = ? AND p.kind = ?`, id, access.kind);
  if (!r) throw notFound('Plan');
  if (access.kind === 'personal' && Number(r.owner_id) !== access.ownerId) throw notFound('Plan');
  return mapPlanMeta(r);
}

export function setActivePlan(db: DB, table: PlanTable, ownerId: number, planId: number) {
  tx(db, () => {
    run(db, `UPDATE ${table} SET active = 0 WHERE owner_id = ? AND kind = 'personal'`, ownerId);
    run(db, `UPDATE ${table} SET active = 1 WHERE id = ? AND owner_id = ?`, planId, ownerId);
  });
}

// ---------------------------------------------------------------- workout plans
export function listWorkoutPlans(db: DB, filter: { kind: PlanKind; ownerId?: number }): WorkoutPlanSummary[] {
  const where = filter.kind === 'template' ? "p.kind = 'template'" : "p.kind = 'personal' AND p.owner_id = ?";
  const params = filter.kind === 'template' ? [] : [filter.ownerId];
  const rows = all(
    db,
    `SELECT p.*, o.name AS owner_name, s.name AS source_name,
       (SELECT COUNT(*) FROM workout_days d WHERE d.plan_id = p.id) AS day_count,
       (SELECT COUNT(*) FROM workout_items i JOIN workout_days d ON d.id = i.day_id WHERE d.plan_id = p.id) AS exercise_count
     FROM workout_plans p LEFT JOIN users o ON o.id = p.owner_id LEFT JOIN workout_plans s ON s.id = p.source_plan_id
     WHERE ${where} ORDER BY p.active DESC, p.updated_at DESC, p.id DESC`,
    ...params,
  );
  return rows.map((r) => ({ ...mapPlanMeta(r), dayCount: Number(r.day_count), exerciseCount: Number(r.exercise_count) }));
}

export function loadWorkoutDays(db: DB, planId: number): WorkoutDay[] {
  const days = all(db, 'SELECT * FROM workout_days WHERE plan_id = ? ORDER BY day_index', planId);
  const items = all(
    db,
    `SELECT i.*, e.name AS e_name, e.muscle_group, e.training_type, e.equipment, e.instructions, e.archived
     FROM workout_items i JOIN workout_days d ON d.id = i.day_id JOIN exercises e ON e.id = i.exercise_id
     WHERE d.plan_id = ? ORDER BY i.position, i.id`,
    planId,
  );
  return days.map((d) => ({
    id: Number(d.id),
    dayIndex: Number(d.day_index),
    name: String(d.name),
    focus: (d.focus as WorkoutDay['focus']) ?? null,
    trainingType: (d.training_type as WorkoutDay['trainingType']) ?? null,
    items: items
      .filter((i) => i.day_id === d.id)
      .map((i) => ({
        id: Number(i.id),
        exerciseId: Number(i.exercise_id),
        exercise: mapExercise({ ...i, id: i.exercise_id, name: i.e_name }),
        position: Number(i.position),
        sets: Number(i.sets),
        reps: i.reps === null ? null : Number(i.reps),
        durationSec: i.duration_sec === null ? null : Number(i.duration_sec),
        restSec: Number(i.rest_sec),
        weightKg: i.weight_kg === null ? null : Number(i.weight_kg),
        notes: String(i.notes ?? ''),
      })),
  }));
}

export function getWorkoutPlan(db: DB, id: number, access: { kind: PlanKind; ownerId?: number }): WorkoutPlan {
  const meta = loadPlanMeta(db, 'workout_plans', id, access);
  return { ...meta, days: loadWorkoutDays(db, id) };
}

function assertExercisesExist(db: DB, ids: number[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const found = all(db, `SELECT id FROM exercises WHERE id IN (${unique.map(() => '?').join(',')})`, ...unique);
  if (found.length !== unique.length) throw new HttpError(400, 'One or more exercises no longer exist');
}

/** Replace a plan's days and items with `input` (inside caller's transaction). */
function writeWorkoutStructure(db: DB, planId: number, input: Pick<WorkoutPlanInput, 'days'>) {
  assertExercisesExist(db, input.days.flatMap((d) => d.items.map((i) => i.exerciseId)));
  run(db, 'DELETE FROM workout_days WHERE plan_id = ?', planId);
  for (const day of input.days) {
    const { id: dayId } = run(
      db,
      'INSERT INTO workout_days (plan_id, day_index, name, focus, training_type) VALUES (?, ?, ?, ?, ?)',
      planId, day.dayIndex, day.name, day.focus, day.trainingType,
    );
    day.items.forEach((it, position) => {
      run(
        db,
        `INSERT INTO workout_items (day_id, exercise_id, position, sets, reps, duration_sec, rest_sec, weight_kg, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        dayId, it.exerciseId, position, it.sets, it.reps, it.durationSec, it.restSec, it.weightKg, it.notes,
      );
    });
  }
}

export function createWorkoutPlan(
  db: DB,
  input: WorkoutPlanInput,
  opts: { kind: PlanKind; ownerId: number | null; createdBy: number; sourcePlanId?: number | null; active?: boolean },
): number {
  return tx(db, () => {
    const { id } = run(
      db,
      `INSERT INTO workout_plans (kind, owner_id, source_plan_id, name, description, active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      opts.kind, opts.ownerId, opts.sourcePlanId ?? null, input.name, input.description, opts.active ? 1 : 0, opts.createdBy,
    );
    writeWorkoutStructure(db, id, input);
    if (opts.active && opts.ownerId) {
      run(db, "UPDATE workout_plans SET active = 0 WHERE owner_id = ? AND kind = 'personal' AND id != ?", opts.ownerId, id);
    }
    return id;
  });
}

export function updateWorkoutPlan(db: DB, id: number, input: WorkoutPlanInput) {
  tx(db, () => {
    run(db, "UPDATE workout_plans SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?", input.name, input.description, id);
    writeWorkoutStructure(db, id, input);
  });
}

/** Snapshot a plan as plain input (used for duplicate/assign). */
export function workoutPlanToInput(plan: WorkoutPlan): WorkoutPlanInput {
  return {
    name: plan.name,
    description: plan.description,
    days: plan.days.map((d) => ({
      dayIndex: d.dayIndex,
      name: d.name,
      focus: d.focus,
      trainingType: d.trainingType,
      items: d.items.map((i) => ({
        exerciseId: i.exerciseId, sets: i.sets, reps: i.reps, durationSec: i.durationSec, restSec: i.restSec, weightKg: i.weightKg, notes: i.notes,
      })),
    })),
  };
}

// ---------------------------------------------------------------- diet plans
export function listDietPlans(db: DB, filter: { kind: PlanKind; ownerId?: number }): DietPlanSummary[] {
  const where = filter.kind === 'template' ? "p.kind = 'template'" : "p.kind = 'personal' AND p.owner_id = ?";
  const params = filter.kind === 'template' ? [] : [filter.ownerId];
  const rows = all(
    db,
    `SELECT p.*, o.name AS owner_name, s.name AS source_name,
       (SELECT COUNT(*) FROM diet_items i WHERE i.plan_id = p.id) AS item_count,
       (SELECT COUNT(DISTINCT day_index) FROM diet_items i WHERE i.plan_id = p.id) AS day_count,
       (SELECT COALESCE(SUM(i.servings * f.calories), 0) FROM diet_items i JOIN foods f ON f.id = i.food_id WHERE i.plan_id = p.id) AS total_cal
     FROM diet_plans p LEFT JOIN users o ON o.id = p.owner_id LEFT JOIN diet_plans s ON s.id = p.source_plan_id
     WHERE ${where} ORDER BY p.active DESC, p.updated_at DESC, p.id DESC`,
    ...params,
  );
  return rows.map((r) => ({
    ...mapPlanMeta(r),
    itemCount: Number(r.item_count),
    avgDailyCalories: Number(r.day_count) ? Math.round(Number(r.total_cal) / Number(r.day_count)) : 0,
  }));
}

export function loadDietItems(db: DB, planId: number, dayIndex?: number): DietItem[] {
  const rows = all(
    db,
    `SELECT i.id AS item_id, i.day_index, i.meal_type, i.servings, i.position, f.*
     FROM diet_items i JOIN foods f ON f.id = i.food_id
     WHERE i.plan_id = ? ${dayIndex === undefined ? '' : 'AND i.day_index = ?'}
     ORDER BY i.day_index, CASE i.meal_type WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 ELSE 3 END, i.position, i.id`,
    ...(dayIndex === undefined ? [planId] : [planId, dayIndex]),
  );
  return rows.map((r) => {
    const food = mapFood(r);
    const servings = Number(r.servings);
    return {
      id: Number(r.item_id),
      dayIndex: Number(r.day_index),
      mealType: r.meal_type as MealType,
      foodId: food.id,
      food,
      servings,
      position: Number(r.position),
      nutrition: scaleNutrition(food, servings),
    };
  });
}

export function getDietPlan(db: DB, id: number, access: { kind: PlanKind; ownerId?: number }): DietPlan {
  const meta = loadPlanMeta(db, 'diet_plans', id, access);
  const items = loadDietItems(db, id);
  const dayTotals: Record<number, Macros> = {};
  for (let d = 0; d < 7; d++) dayTotals[d] = sumMacros(items.filter((i) => i.dayIndex === d).map((i) => i.nutrition));
  return { ...meta, items, dayTotals };
}

function writeDietItems(db: DB, planId: number, input: Pick<DietPlanInput, 'items'>) {
  const ids = [...new Set(input.items.map((i) => i.foodId))];
  if (ids.length) {
    const found = all(db, `SELECT id FROM foods WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
    if (found.length !== ids.length) throw new HttpError(400, 'One or more foods no longer exist');
  }
  run(db, 'DELETE FROM diet_items WHERE plan_id = ?', planId);
  input.items.forEach((it, position) => {
    run(db, 'INSERT INTO diet_items (plan_id, day_index, meal_type, food_id, servings, position) VALUES (?, ?, ?, ?, ?, ?)',
      planId, it.dayIndex, it.mealType, it.foodId, it.servings, position);
  });
}

export function createDietPlan(
  db: DB,
  input: DietPlanInput,
  opts: { kind: PlanKind; ownerId: number | null; createdBy: number; sourcePlanId?: number | null; active?: boolean },
): number {
  return tx(db, () => {
    const { id } = run(
      db,
      `INSERT INTO diet_plans (kind, owner_id, source_plan_id, name, description, active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      opts.kind, opts.ownerId, opts.sourcePlanId ?? null, input.name, input.description, opts.active ? 1 : 0, opts.createdBy,
    );
    writeDietItems(db, id, input);
    if (opts.active && opts.ownerId) {
      run(db, "UPDATE diet_plans SET active = 0 WHERE owner_id = ? AND kind = 'personal' AND id != ?", opts.ownerId, id);
    }
    return id;
  });
}

export function updateDietPlan(db: DB, id: number, input: DietPlanInput) {
  tx(db, () => {
    run(db, "UPDATE diet_plans SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?", input.name, input.description, id);
    writeDietItems(db, id, input);
  });
}

export function dietPlanToInput(plan: DietPlan): DietPlanInput {
  return {
    name: plan.name,
    description: plan.description,
    items: plan.items.map((i) => ({ dayIndex: i.dayIndex, mealType: i.mealType, foodId: i.foodId, servings: i.servings })),
  };
}

// ---------------------------------------------------------------- food logs
export function foodLogsForRange(db: DB, userId: number, start: string, end: string): FoodLogEntry[] {
  return all(db, 'SELECT * FROM food_logs WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date, id', userId, start, end).map(mapFoodLog);
}

export function summarizeDay(date: string, entries: FoodLogEntry[]): DaySummary {
  const byMeal = Object.fromEntries(
    MEAL_TYPES.map((m) => [m, sumMacros(entries.filter((e) => e.mealType === m).map((e) => e.nutrition))]),
  ) as Record<MealType, Macros>;
  return {
    date,
    entries,
    totals: sumMacros(entries.map((e) => e.nutrition)),
    byMeal,
    hasApproximate: entries.some((e) => e.isApproximate),
  };
}

export function daySummary(db: DB, userId: number, date: string): DaySummary {
  return summarizeDay(date, foodLogsForRange(db, userId, date, date));
}

// ---------------------------------------------------------------- workout logs
export function loadWorkoutLogs(db: DB, userId: number, opts: { id?: number; start?: string; end?: string; limit?: number }): WorkoutLog[] {
  const where = ['l.user_id = ?'];
  const params: unknown[] = [userId];
  if (opts.id) { where.push('l.id = ?'); params.push(opts.id); }
  if (opts.start) { where.push('l.date >= ?'); params.push(opts.start); }
  if (opts.end) { where.push('l.date <= ?'); params.push(opts.end); }
  const logs = all(db, `SELECT * FROM workout_logs l WHERE ${where.join(' AND ')} ORDER BY l.date DESC, l.id DESC LIMIT ?`, ...params, opts.limit ?? 200);
  if (!logs.length) return [];
  const ids = logs.map((l) => l.id);
  const marks = ids.map(() => '?').join(',');
  const entries = all(db, `SELECT * FROM workout_log_entries WHERE log_id IN (${marks}) ORDER BY position`, ...ids);
  const entryIds = entries.map((e) => e.id);
  const sets = entryIds.length
    ? all(db, `SELECT * FROM workout_log_sets WHERE entry_id IN (${entryIds.map(() => '?').join(',')}) ORDER BY set_number`, ...entryIds)
    : [];
  return logs.map((l) => {
    const es = entries.filter((e) => e.log_id === l.id).map((e) => ({
      id: Number(e.id),
      exerciseId: e.exercise_id === null ? null : Number(e.exercise_id),
      exerciseName: String(e.exercise_name),
      position: Number(e.position),
      completed: Boolean(e.completed),
      sets: sets.filter((s) => s.entry_id === e.id).map((s) => ({
        reps: s.reps === null ? null : Number(s.reps),
        weightKg: s.weight_kg === null ? null : Number(s.weight_kg),
        durationSec: s.duration_sec === null ? null : Number(s.duration_sec),
      })),
    }));
    const volume = es.filter((e) => e.completed).flatMap((e) => e.sets).reduce((acc, s) => acc + (s.reps ?? 0) * (s.weightKg ?? 0), 0);
    return {
      id: Number(l.id),
      date: String(l.date),
      title: String(l.title),
      planId: l.plan_id === null ? null : Number(l.plan_id),
      dayIndex: l.day_index === null ? null : Number(l.day_index),
      notes: String(l.notes ?? ''),
      createdAt: String(l.created_at),
      entries: es,
      completedCount: es.filter((e) => e.completed).length,
      totalVolumeKg: Math.round(volume),
    };
  });
}

export function writeWorkoutLog(db: DB, userId: number, input: WorkoutLogInput, existingId?: number): number {
  return tx(db, () => {
    if (input.planId !== null) {
      const plan = get(db, "SELECT id FROM workout_plans WHERE id = ? AND kind = 'personal' AND owner_id = ?", input.planId, userId);
      if (!plan) throw new HttpError(400, 'That plan is not one of your plans');
    }
    const ids = [...new Set(input.entries.map((e) => e.exerciseId))];
    const exercises = all(db, `SELECT id, name FROM exercises WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
    if (exercises.length !== ids.length) throw new HttpError(400, 'One or more exercises no longer exist');
    const nameOf = new Map(exercises.map((e) => [Number(e.id), String(e.name)]));

    let logId = existingId;
    if (logId) {
      run(db, 'UPDATE workout_logs SET date = ?, title = ?, plan_id = ?, day_index = ?, notes = ? WHERE id = ? AND user_id = ?',
        input.date, input.title, input.planId, input.dayIndex, input.notes, logId, userId);
      run(db, 'DELETE FROM workout_log_entries WHERE log_id = ?', logId);
    } else {
      logId = run(db, 'INSERT INTO workout_logs (user_id, plan_id, day_index, date, title, notes) VALUES (?, ?, ?, ?, ?, ?)',
        userId, input.planId, input.dayIndex, input.date, input.title, input.notes).id;
    }
    input.entries.forEach((e, position) => {
      const { id: entryId } = run(db, 'INSERT INTO workout_log_entries (log_id, exercise_id, exercise_name, position, completed) VALUES (?, ?, ?, ?, ?)',
        logId, e.exerciseId, nameOf.get(e.exerciseId), position, e.completed ? 1 : 0);
      // Only keep sets that actually contain work.
      e.sets
        .filter((s) => (s.reps ?? 0) > 0 || (s.durationSec ?? 0) > 0)
        .forEach((s, i) => run(db, 'INSERT INTO workout_log_sets (entry_id, set_number, reps, weight_kg, duration_sec) VALUES (?, ?, ?, ?, ?)',
          entryId, i + 1, s.reps, s.weightKg, s.durationSec));
    });
    return logId;
  });
}

// ---------------------------------------------------------------- summaries
export function activePlanId(db: DB, table: PlanTable, userId: number): number | null {
  const r = get(db, `SELECT id FROM ${table} WHERE owner_id = ? AND kind = 'personal' AND active = 1 ORDER BY id DESC LIMIT 1`, userId);
  return r ? Number(r.id) : null;
}

export function weekSummary(db: DB, userId: number, anyDateInWeek: string): WeekSummary {
  const start = startOfWeek(anyDateInWeek);
  const end = addDays(start, 6);
  const planId = activePlanId(db, 'workout_plans', userId);
  const planned = planId
    ? Number(get(db, 'SELECT COUNT(*) AS c FROM workout_days d WHERE d.plan_id = ? AND EXISTS (SELECT 1 FROM workout_items i WHERE i.day_id = d.id)', planId)?.c ?? 0)
    : 0;
  const completed = Number(get(db, 'SELECT COUNT(DISTINCT date) AS c FROM workout_logs WHERE user_id = ? AND date BETWEEN ? AND ?', userId, start, end)?.c ?? 0);
  const logs = foodLogsForRange(db, userId, start, end);
  const daysLogged = dateRange(start, end).filter((d) => logs.some((l) => l.date === d));
  // Average completed days only: the reference day (usually today) is still in progress.
  const avgDays = daysLogged.filter((d) => d !== anyDateInWeek);
  const total = sumMacros(logs.filter((l) => avgDays.includes(l.date)).map((l) => l.nutrition));
  const n = avgDays.length || 1;
  const avg = avgDays.length
    ? { calories: Math.round(total.calories / n), protein: Math.round(total.protein / n), carbs: Math.round(total.carbs / n), fat: Math.round(total.fat / n) }
    : { ...ZERO_MACROS };
  return { start, end, plannedWorkouts: planned, completedWorkouts: completed, daysLogged: daysLogged.length, avgDays: avgDays.length, avg };
}

export { weekdayIndex };

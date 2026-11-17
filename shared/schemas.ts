import { z } from 'zod';
import {
  ACTIVITY_LEVELS, ALLERGENS, DIET_PREFERENCES, DIET_TAGS, EQUIPMENT, FITNESS_GOALS, MAX_CALORIE_GOAL,
  MAX_SERVINGS, MEAL_TYPES, MIN_CALORIE_GOAL, MUSCLE_GROUPS, SERVING_UNITS, SEX_OPTIONS, TRAINING_TYPES, UNIT_SYSTEMS,
} from './constants.ts';
import { validateFoodNutrition } from './nutrition.ts';

const trimmed = (min: number, max: number, what: string) =>
  z.string().trim()
    .min(min, min === 1 ? `${what} is required` : `${what} must be at least ${min} characters`)
    .max(max, `${what} must be at most ${max} characters`);

const num = (what: string, min: number, max: number) =>
  z.number({ invalid_type_error: `${what} must be a number`, required_error: `${what} is required` })
    .finite(`${what} must be a number`)
    .min(min, `${what} must be at least ${min}`)
    .max(max, `${what} must be at most ${max}`);

const int = (what: string, min: number, max: number) => num(what, min, max).int(`${what} must be a whole number`);

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'Date is not a real calendar date');

const uniqueArray = <T extends z.ZodTypeAny>(item: T) =>
  z.array(item).transform((a) => Array.from(new Set(a)) as z.infer<T>[]);

// ---------- auth ----------
export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(120),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  name: trimmed(1, 60, 'Name'),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required').max(128),
});

// ---------- profile ----------
export const targetsSchema = z.object({
  calories: int('Calorie goal', MIN_CALORIE_GOAL, MAX_CALORIE_GOAL),
  protein: int('Protein goal', 0, 400),
  carbs: int('Carbs goal', 0, 800),
  fat: int('Fat goal', 0, 300),
});

export const profileSchema = z.object({
  name: trimmed(1, 60, 'Name'),
  age: int('Age', 16, 100),
  heightCm: num('Height', 100, 250),
  weightKg: num('Weight', 30, 300),
  sex: z.enum(SEX_OPTIONS).default('unspecified'),
  units: z.enum(UNIT_SYSTEMS),
  activityLevel: z.enum(ACTIVITY_LEVELS, { errorMap: () => ({ message: 'Choose an activity level' }) }),
  goal: z.enum(FITNESS_GOALS, { errorMap: () => ({ message: 'Choose a goal' }) }),
  dietaryPreference: z.enum(DIET_PREFERENCES).default('none'),
  allergies: uniqueArray(z.enum(ALLERGENS)).default([]),
  otherAllergies: z.string().trim().max(200, 'Keep this under 200 characters').default(''),
  equipment: uniqueArray(z.enum(EQUIPMENT)).default([]),
  customTargets: targetsSchema.nullable().default(null),
});
export type ProfileInput = z.infer<typeof profileSchema>;

// ---------- library ----------
export const exerciseSchema = z.object({
  name: trimmed(2, 80, 'Name'),
  muscleGroup: z.enum(MUSCLE_GROUPS),
  trainingType: z.enum(TRAINING_TYPES),
  equipment: z.enum(EQUIPMENT),
  instructions: z.string().trim().max(2000).default(''),
});
export type ExerciseInput = z.infer<typeof exerciseSchema>;

export const foodSchema = z.object({
  name: trimmed(2, 80, 'Name'),
  brand: z.string().trim().max(60).default(''),
  servingSize: num('Serving size', 0.1, 2000).refine((v) => v > 0, 'Serving size must be greater than 0'),
  servingUnit: z.enum(SERVING_UNITS),
  calories: num('Calories', 0, 3000),
  protein: num('Protein', 0, 500),
  carbs: num('Carbs', 0, 500),
  fat: num('Fat', 0, 500),
  allergens: uniqueArray(z.enum(ALLERGENS)).default([]),
  dietTags: uniqueArray(z.enum(DIET_TAGS)).default([]),
  isApproximate: z.boolean().default(true),
}).superRefine((f, ctx) => {
  for (const message of validateFoodNutrition(f)) ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['calories'] });
});
export type FoodInput = z.infer<typeof foodSchema>;

// ---------- plans ----------
export const workoutItemSchema = z.object({
  exerciseId: int('Exercise', 1, Number.MAX_SAFE_INTEGER),
  sets: int('Sets', 1, 20),
  reps: int('Reps', 1, 100).nullable().default(null),
  durationSec: int('Duration', 5, 7200).nullable().default(null),
  restSec: int('Rest', 0, 600).default(60),
  weightKg: num('Weight', 0, 500).nullable().default(null),
  notes: z.string().trim().max(300).default(''),
}).refine((i) => i.reps !== null || i.durationSec !== null, {
  message: 'Each exercise needs reps or a duration', path: ['reps'],
});

export const workoutDaySchema = z.object({
  dayIndex: int('Day', 0, 6),
  name: trimmed(1, 60, 'Day name'),
  focus: z.enum(MUSCLE_GROUPS).nullable().default(null),
  trainingType: z.enum(TRAINING_TYPES).nullable().default(null),
  items: z.array(workoutItemSchema).max(30),
});

export const workoutPlanSchema = z.object({
  name: trimmed(2, 80, 'Plan name'),
  description: z.string().trim().max(500).default(''),
  days: z.array(workoutDaySchema).max(7),
}).refine((p) => new Set(p.days.map((d) => d.dayIndex)).size === p.days.length, {
  message: 'Each weekday can only appear once', path: ['days'],
});
export type WorkoutPlanInput = z.infer<typeof workoutPlanSchema>;

export const dietItemSchema = z.object({
  dayIndex: int('Day', 0, 6),
  mealType: z.enum(MEAL_TYPES),
  foodId: int('Food', 1, Number.MAX_SAFE_INTEGER),
  servings: num('Servings', 0.05, MAX_SERVINGS).refine((v) => v > 0, 'Servings must be greater than 0'),
});
export const dietPlanSchema = z.object({
  name: trimmed(2, 80, 'Plan name'),
  description: z.string().trim().max(500).default(''),
  items: z.array(dietItemSchema).max(300),
});
export type DietPlanInput = z.infer<typeof dietPlanSchema>;

export const assignSchema = z.object({ userIds: z.array(int('User', 1, Number.MAX_SAFE_INTEGER)).min(1, 'Pick at least one user') });

// ---------- logs ----------
const servings = num('Servings', 0.05, MAX_SERVINGS).refine((v) => v > 0, 'Servings must be greater than 0');

export const foodLogSchema = z.object({
  date: isoDate,
  mealType: z.enum(MEAL_TYPES),
  foodId: int('Food', 1, Number.MAX_SAFE_INTEGER),
  servings,
});
export const foodLogUpdateSchema = z.object({
  mealType: z.enum(MEAL_TYPES).optional(),
  servings: servings.optional(),
}).refine((v) => v.mealType !== undefined || v.servings !== undefined, 'Nothing to update');

export const loggedSetSchema = z.object({
  reps: int('Reps', 0, 200).nullable().default(null),
  weightKg: num('Weight', 0, 500).nullable().default(null),
  durationSec: int('Duration', 0, 7200).nullable().default(null),
});

export const workoutLogEntrySchema = z.object({
  exerciseId: int('Exercise', 1, Number.MAX_SAFE_INTEGER),
  completed: z.boolean(),
  sets: z.array(loggedSetSchema).max(20),
}).superRefine((e, ctx) => {
  if (!e.completed) return;
  const valid = e.sets.filter((s) => (s.reps ?? 0) > 0 || (s.durationSec ?? 0) > 0);
  if (valid.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sets'], message: 'A completed exercise needs at least one set with reps or time' });
  }
});

export const workoutLogSchema = z.object({
  date: isoDate,
  title: trimmed(1, 80, 'Workout title'),
  planId: int('Plan', 1, Number.MAX_SAFE_INTEGER).nullable().default(null),
  dayIndex: int('Day', 0, 6).nullable().default(null),
  notes: z.string().trim().max(500).default(''),
  entries: z.array(workoutLogEntrySchema).min(1, 'Add at least one exercise').max(40),
}).refine((l) => l.entries.some((e) => e.completed), {
  message: 'Mark at least one exercise complete before saving', path: ['entries'],
});
export type WorkoutLogInput = z.infer<typeof workoutLogSchema>;

export const weightLogSchema = z.object({ date: isoDate, weightKg: num('Weight', 30, 300) });

/** Flatten a ZodError into `{ field: message }` plus a summary message. */
export function formatZodError(err: z.ZodError): { message: string; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return { message: err.issues[0]?.message ?? 'Invalid input', fields };
}

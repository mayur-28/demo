import {
  MAX_CALORIE_GOAL,
  MIN_CALORIE_GOAL,
  type ActivityLevel,
  type FitnessGoal,
  type Sex,
} from './constants.ts';
import type { Macros } from './nutrition.ts';

export const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export interface GoalInput {
  age: number;
  heightCm: number;
  weightKg: number;
  sex: Sex;
  activityLevel: ActivityLevel;
  goal: FitnessGoal;
}

export interface GoalEstimate extends Macros {
  bmr: number;
  maintenance: number;
}

const round5 = (n: number) => Math.round(n / 5) * 5;

/** Lowest daily calorie target the app will ever suggest. */
export function calorieFloor(sex: Sex): number {
  return sex === 'female' ? MIN_CALORIE_GOAL : 1500;
}

/**
 * General-guidance daily targets using the Mifflin-St Jeor equation.
 * These are population estimates, not prescriptions. Weight-loss deficits
 * are capped at 500 kcal / 20% and never go below a safety floor.
 */
export function estimateTargets(p: GoalInput): GoalEstimate {
  const sexConstant = p.sex === 'male' ? 5 : p.sex === 'female' ? -161 : -78;
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + sexConstant;
  const maintenance = bmr * ACTIVITY_MULTIPLIER[p.activityLevel];

  let calories = maintenance;
  if (p.goal === 'lose_weight') calories = maintenance - Math.min(500, maintenance * 0.2);
  if (p.goal === 'gain_muscle') calories = maintenance + Math.min(300, maintenance * 0.1);
  calories = Math.min(MAX_CALORIE_GOAL, Math.max(calorieFloor(p.sex), calories));
  calories = round5(calories);

  const proteinPerKg = p.goal === 'lose_weight' || p.goal === 'gain_muscle' ? 1.6 : 1.2;
  let protein = Math.round(p.weightKg * proteinPerKg);
  protein = Math.min(protein, Math.round((calories * 0.35) / 4)); // keep protein ≤ 35% of energy
  const fat = Math.round((calories * 0.3) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));

  return { calories, protein, carbs, fat, bmr: Math.round(bmr), maintenance: Math.round(maintenance) };
}

// Unit conversion helpers (storage is always metric)
export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
export const kgToLb = (kg: number) => Math.round((kg / KG_PER_LB) * 10) / 10;
export const lbToKg = (lb: number) => Math.round(lb * KG_PER_LB * 10) / 10;
export const cmToIn = (cm: number) => Math.round((cm / CM_PER_IN) * 10) / 10;
export const inToCm = (inch: number) => Math.round(inch * CM_PER_IN * 10) / 10;

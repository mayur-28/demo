import { MAX_SERVINGS, type Allergen, type DietPreference, type DietTag } from './constants.ts';

export interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const ZERO_MACROS: Macros = Object.freeze({ calories: 0, protein: 0, carbs: 0, fat: 0 });

const round1 = (n: number) => Math.round(n * 10) / 10;

export function isValidServings(servings: unknown): servings is number {
  return typeof servings === 'number' && Number.isFinite(servings) && servings > 0 && servings <= MAX_SERVINGS;
}

function assertMacros(m: Macros): void {
  for (const k of ['calories', 'protein', 'carbs', 'fat'] as const) {
    const v = m[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new RangeError(`Invalid nutrition value for ${k}: ${v}`);
    }
  }
}

/**
 * Nutrition for `servings` of a food whose values are given per one serving.
 * Calories are rounded to whole numbers, macros to 0.1 g. This is the only
 * function that scales nutrition; totals are built from its output so a list
 * of entries always adds up to the total shown.
 */
export function scaleNutrition(perServing: Macros, servings: number): Macros {
  if (!isValidServings(servings)) {
    throw new RangeError(`Servings must be greater than 0 and at most ${MAX_SERVINGS}`);
  }
  assertMacros(perServing);
  return {
    calories: Math.round(perServing.calories * servings),
    protein: round1(perServing.protein * servings),
    carbs: round1(perServing.carbs * servings),
    fat: round1(perServing.fat * servings),
  };
}

/** Sum already-scaled entries (fixes floating point drift at the end). */
export function sumMacros(items: Macros[]): Macros {
  const t = items.reduce(
    (acc, m) => {
      assertMacros(m);
      return {
        calories: acc.calories + m.calories,
        protein: acc.protein + m.protein,
        carbs: acc.carbs + m.carbs,
        fat: acc.fat + m.fat,
      };
    },
    { ...ZERO_MACROS },
  );
  return { calories: Math.round(t.calories), protein: round1(t.protein), carbs: round1(t.carbs), fat: round1(t.fat) };
}

/** Energy implied by macros using the standard 4/4/9 Atwater factors. */
export function atwaterCalories(m: Pick<Macros, 'protein' | 'carbs' | 'fat'>): number {
  return m.protein * 4 + m.carbs * 4 + m.fat * 9;
}

export interface FoodNutritionInput extends Macros {
  servingSize: number;
  servingUnit: string;
}

/**
 * Plausibility checks for a food entry. Returns a list of human-readable
 * problems (empty when valid). Catches typos like 500 g protein in a 100 g
 * serving or calories that cannot match the macros.
 */
export function validateFoodNutrition(f: FoodNutritionInput): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(f.servingSize) || f.servingSize <= 0) errors.push('Serving size must be greater than 0.');
  for (const k of ['calories', 'protein', 'carbs', 'fat'] as const) {
    if (!Number.isFinite(f[k]) || f[k] < 0) errors.push(`${k[0].toUpperCase() + k.slice(1)} cannot be negative.`);
  }
  if (errors.length) return errors;
  if ((f.servingUnit === 'g' || f.servingUnit === 'ml') && f.protein + f.carbs + f.fat > f.servingSize * 1.001) {
    errors.push(`Protein, carbs and fat add up to more than the ${f.servingSize}${f.servingUnit} serving.`);
  }
  const implied = atwaterCalories(f);
  // Fibre, alcohol and label rounding cause honest differences, so the tolerance is generous.
  if (Math.abs(f.calories - implied) > Math.max(40, implied * 0.35, f.calories * 0.35)) {
    errors.push(`Calories (${f.calories}) don't match the macros (about ${Math.round(implied)} kcal). Check the values.`);
  }
  return errors;
}

/** Percentage (0–100+) of a goal reached; 0 when there is no goal. */
export function percentOf(value: number, goal: number): number {
  if (!goal || goal <= 0 || !Number.isFinite(value)) return 0;
  return Math.round((value / goal) * 100);
}

export interface FoodFlags {
  allergens: Allergen[];
  dietConflict: boolean;
}

/** Which of the user's allergens a food contains, and whether it breaks their diet. */
export function flagFood(
  food: { allergens: Allergen[]; dietTags: DietTag[] },
  user: { allergies: Allergen[]; dietaryPreference: DietPreference },
): FoodFlags {
  const allergens = food.allergens.filter((a) => user.allergies.includes(a));
  const pref = user.dietaryPreference;
  const dietConflict = pref !== 'none' && !food.dietTags.includes(pref);
  return { allergens, dietConflict };
}

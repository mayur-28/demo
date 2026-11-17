import { describe, expect, it } from 'vitest';
import { flagFood, percentOf, scaleNutrition, sumMacros, validateFoodNutrition } from '../shared/nutrition.ts';
import { calorieFloor, estimateTargets, kgToLb, lbToKg } from '../shared/goals.ts';
import { addDays, startOfWeek, weekdayIndex } from '../shared/dates.ts';

const oats = { calories: 150, protein: 5, carbs: 27, fat: 2.5 };

describe('scaleNutrition', () => {
  it('multiplies per-serving values by servings and rounds consistently', () => {
    expect(scaleNutrition(oats, 1.5)).toEqual({ calories: 225, protein: 7.5, carbs: 40.5, fat: 3.8 });
    expect(scaleNutrition(oats, 1)).toEqual(oats);
  });

  it('rounds calories to whole numbers and macros to 0.1 g', () => {
    const r = scaleNutrition({ calories: 72, protein: 6.3, carbs: 0.4, fat: 4.8 }, 0.333);
    expect(r).toEqual({ calories: 24, protein: 2.1, carbs: 0.1, fat: 1.6 });
  });

  it.each([0, -1, Number.NaN, Infinity, 21])('rejects invalid servings %s', (s) => {
    expect(() => scaleNutrition(oats, s)).toThrow(RangeError);
  });

  it('rejects negative or non-finite nutrition values', () => {
    expect(() => scaleNutrition({ ...oats, protein: -1 }, 1)).toThrow(RangeError);
    expect(() => scaleNutrition({ ...oats, fat: Number.NaN }, 1)).toThrow(RangeError);
  });
});

describe('sumMacros', () => {
  it('adds entries and fixes floating point drift', () => {
    const items = Array.from({ length: 10 }, () => ({ calories: 10, protein: 0.1, carbs: 0.2, fat: 0.3 }));
    expect(sumMacros(items)).toEqual({ calories: 100, protein: 1, carbs: 2, fat: 3 });
  });

  it('returns zeros for an empty list', () => {
    expect(sumMacros([])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it('a list of scaled entries always adds up to the displayed total', () => {
    const entries = [scaleNutrition(oats, 1.25), scaleNutrition(oats, 0.75), scaleNutrition({ calories: 95, protein: 3.5, carbs: 3.5, fat: 8 }, 2)];
    const total = sumMacros(entries);
    expect(total.calories).toBe(entries.reduce((a, e) => a + e.calories, 0));
  });
});

describe('validateFoodNutrition', () => {
  const base = { servingSize: 100, servingUnit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6 };
  it('accepts realistic values', () => expect(validateFoodNutrition(base)).toEqual([]));
  it('rejects macros heavier than the serving', () => {
    expect(validateFoodNutrition({ ...base, protein: 90, carbs: 20 }).join(' ')).toMatch(/more than the 100g serving/);
  });
  it('rejects calories that cannot match macros', () => {
    expect(validateFoodNutrition({ ...base, calories: 1650 }).join(' ')).toMatch(/don't match/);
  });
  it('rejects negatives and zero serving size', () => {
    expect(validateFoodNutrition({ ...base, fat: -2 })).toContain('Fat cannot be negative.');
    expect(validateFoodNutrition({ ...base, servingSize: 0 })).toContain('Serving size must be greater than 0.');
  });
  it('allows label rounding (e.g. high-fibre foods) within tolerance', () => {
    expect(validateFoodNutrition({ servingSize: 100, servingUnit: 'g', calories: 35, protein: 2.4, carbs: 7.2, fat: 0.4 })).toEqual([]);
  });
});

describe('flagFood', () => {
  const peanutButter = { allergens: ['peanut' as const], dietTags: ['vegan' as const, 'vegetarian' as const, 'pescatarian' as const] };
  const salmon = { allergens: ['fish' as const], dietTags: ['pescatarian' as const] };
  it('flags allergens the user listed', () => {
    expect(flagFood(peanutButter, { allergies: ['peanut', 'dairy'], dietaryPreference: 'none' })).toEqual({ allergens: ['peanut'], dietConflict: false });
  });
  it('flags diet conflicts', () => {
    expect(flagFood(salmon, { allergies: [], dietaryPreference: 'vegetarian' }).dietConflict).toBe(true);
    expect(flagFood(salmon, { allergies: [], dietaryPreference: 'pescatarian' }).dietConflict).toBe(false);
  });
});

describe('percentOf', () => {
  it('handles zero goals safely', () => {
    expect(percentOf(500, 0)).toBe(0);
    expect(percentOf(1100, 2000)).toBe(55);
  });
});

describe('estimateTargets', () => {
  const alex = { age: 29, heightCm: 178, weightKg: 82, sex: 'male' as const, activityLevel: 'moderate' as const, goal: 'maintain' as const };

  it('matches the Mifflin-St Jeor equation', () => {
    const t = estimateTargets(alex);
    // 10*82 + 6.25*178 - 5*29 + 5 = 1792.5
    expect(t.bmr).toBe(1793);
    expect(t.maintenance).toBe(Math.round(1792.5 * 1.55));
    expect(t.calories).toBe(2780);
  });

  it('caps the weight-loss deficit at 500 kcal', () => {
    const t = estimateTargets({ ...alex, goal: 'lose_weight' });
    expect(t.maintenance - t.calories).toBeLessThanOrEqual(505);
    expect(t.calories).toBeGreaterThan(2200);
  });

  it('never suggests fewer calories than the safety floor', () => {
    const small = estimateTargets({ age: 70, heightCm: 150, weightKg: 42, sex: 'female', activityLevel: 'sedentary', goal: 'lose_weight' });
    expect(small.calories).toBe(calorieFloor('female'));
    expect(small.calories).toBeGreaterThanOrEqual(1200);
    const unspecified = estimateTargets({ age: 70, heightCm: 150, weightKg: 42, sex: 'unspecified', activityLevel: 'sedentary', goal: 'lose_weight' });
    expect(unspecified.calories).toBe(1500);
  });

  it('macros add up to roughly the calorie target', () => {
    for (const goal of ['lose_weight', 'maintain', 'gain_muscle'] as const) {
      const t = estimateTargets({ ...alex, goal });
      const kcal = t.protein * 4 + t.carbs * 4 + t.fat * 9;
      expect(Math.abs(kcal - t.calories)).toBeLessThan(15);
      expect(t.carbs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('units & dates', () => {
  it('converts weight both ways', () => {
    expect(kgToLb(100)).toBe(220.5);
    expect(lbToKg(220.5)).toBe(100);
  });
  it('uses Monday as day 0', () => {
    expect(weekdayIndex('2026-11-16')).toBe(0); // Monday
    expect(weekdayIndex('2026-11-22')).toBe(6); // Sunday
    expect(startOfWeek('2026-11-19')).toBe('2026-11-16');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30'); // across DST in many zones
  });
});

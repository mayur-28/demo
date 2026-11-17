import { describe, expect, it } from 'vitest';
import { foodLogSchema, foodSchema, profileSchema, workoutLogSchema, workoutPlanSchema, isoDate, targetsSchema } from '../shared/schemas.ts';

const profile = {
  name: 'Test', age: 30, heightCm: 170, weightKg: 70, units: 'metric', activityLevel: 'light', goal: 'maintain',
};

describe('profile validation', () => {
  it('accepts required fields and defaults optional ones', () => {
    const p = profileSchema.parse(profile);
    expect(p.allergies).toEqual([]);
    expect(p.sex).toBe('unspecified');
    expect(p.customTargets).toBeNull();
  });
  it('requires name, activity and goal with friendly messages', () => {
    const r = profileSchema.safeParse({ ...profile, name: '  ', activityLevel: undefined, goal: 'yolo' });
    expect(r.success).toBe(false);
    const msgs = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(msgs).toContain('Name is required');
    expect(msgs).toContain('Choose an activity level');
    expect(msgs).toContain('Choose a goal');
  });
  it('rejects out-of-range body measurements', () => {
    expect(profileSchema.safeParse({ ...profile, age: 12 }).success).toBe(false);
    expect(profileSchema.safeParse({ ...profile, weightKg: -5 }).success).toBe(false);
    expect(profileSchema.safeParse({ ...profile, heightCm: Number.NaN }).success).toBe(false);
  });
  it('de-duplicates allergy lists and rejects unknown allergens', () => {
    expect(profileSchema.parse({ ...profile, allergies: ['egg', 'egg'] }).allergies).toEqual(['egg']);
    expect(profileSchema.safeParse({ ...profile, allergies: ['kryptonite'] }).success).toBe(false);
  });
  it('refuses custom calorie targets below the safety minimum', () => {
    expect(targetsSchema.safeParse({ calories: 800, protein: 100, carbs: 50, fat: 30 }).success).toBe(false);
    expect(targetsSchema.safeParse({ calories: 1200, protein: 100, carbs: 50, fat: 30 }).success).toBe(true);
  });
});

describe('food validation', () => {
  const food = { name: 'Rice', servingSize: 100, servingUnit: 'g', calories: 130, protein: 2.7, carbs: 28, fat: 0.3 };
  it('accepts a valid food', () => expect(foodSchema.safeParse(food).success).toBe(true));
  it('rejects negative values and zero serving size', () => {
    expect(foodSchema.safeParse({ ...food, carbs: -1 }).success).toBe(false);
    expect(foodSchema.safeParse({ ...food, servingSize: 0 }).success).toBe(false);
  });
  it('rejects implausible nutrition totals', () => {
    expect(foodSchema.safeParse({ ...food, calories: 1300 }).success).toBe(false);
  });
});

describe('food log validation', () => {
  const log = { date: '2026-11-17', mealType: 'lunch', foodId: 1, servings: 1 };
  it.each([0, -0.5, 25])('rejects servings of %s', (servings) => {
    expect(foodLogSchema.safeParse({ ...log, servings }).success).toBe(false);
  });
  it('rejects impossible dates', () => {
    expect(isoDate.safeParse('2026-02-30').success).toBe(false);
    expect(foodLogSchema.safeParse({ ...log, date: '17/11/2026' }).success).toBe(false);
  });
});

describe('workout plan validation', () => {
  const plan = { name: 'Plan', days: [{ dayIndex: 0, name: 'Day', items: [{ exerciseId: 1, sets: 3, reps: 10 }] }] };
  it('accepts a minimal plan', () => expect(workoutPlanSchema.safeParse(plan).success).toBe(true));
  it('requires reps or a duration for every exercise', () => {
    const bad = { ...plan, days: [{ ...plan.days[0], items: [{ exerciseId: 1, sets: 3 }] }] };
    const r = workoutPlanSchema.safeParse(bad);
    expect(r.success).toBe(false);
    expect(r.success ? '' : r.error.issues[0].message).toMatch(/reps or a duration/);
  });
  it('rejects duplicate weekdays and zero sets', () => {
    expect(workoutPlanSchema.safeParse({ ...plan, days: [plan.days[0], plan.days[0]] }).success).toBe(false);
    expect(workoutPlanSchema.safeParse({ ...plan, days: [{ ...plan.days[0], items: [{ exerciseId: 1, sets: 0, reps: 5 }] }] }).success).toBe(false);
  });
});

describe('workout log validation', () => {
  const log = { date: '2026-11-17', title: 'Upper', entries: [{ exerciseId: 1, completed: true, sets: [{ reps: 10, weightKg: 20 }] }] };
  it('accepts a completed exercise with sets', () => expect(workoutLogSchema.safeParse(log).success).toBe(true));
  it('rejects a completed exercise without any reps or time', () => {
    const r = workoutLogSchema.safeParse({ ...log, entries: [{ exerciseId: 1, completed: true, sets: [{ reps: 0 }] }] });
    expect(r.success).toBe(false);
  });
  it('requires at least one completed exercise', () => {
    const r = workoutLogSchema.safeParse({ ...log, entries: [{ exerciseId: 1, completed: false, sets: [] }] });
    expect(r.success ? '' : r.error.issues[0].message).toMatch(/at least one exercise complete/);
  });
  it('rejects negative weights', () => {
    expect(workoutLogSchema.safeParse({ ...log, entries: [{ exerciseId: 1, completed: true, sets: [{ reps: 5, weightKg: -10 }] }] }).success).toBe(false);
  });
});

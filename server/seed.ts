// Realistic demo data so the app can be explored immediately.
// All nutrition values are approximate, typical values (rounded, USDA-style).
import { get, run, tx, type DB } from './db.ts';
import { hashPassword } from './auth.ts';
import {
  createDietPlan, createWorkoutPlan, dietPlanToInput, getDietPlan, getWorkoutPlan, loadDietItems, saveProfile, updateWorkoutPlan,
  workoutPlanToInput, writeWorkoutLog,
} from './services.ts';
import { exerciseSchema, foodSchema, profileSchema, type DietPlanInput, type WorkoutPlanInput } from '../shared/schemas.ts';
import { addDays, localToday, weekdayIndex } from '../shared/dates.ts';
import type { Allergen, DietTag, MealType } from '../shared/constants.ts';

export const DEMO_PASSWORD = 'demo1234';

const VEGAN: DietTag[] = ['vegan', 'vegetarian', 'pescatarian'];
const VEG: DietTag[] = ['vegetarian', 'pescatarian'];
const PESC: DietTag[] = ['pescatarian'];
const MEAT: DietTag[] = [];

type F = [name: string, size: number, unit: string, kcal: number, p: number, c: number, f: number, allergens: Allergen[], tags: DietTag[]];
const FOODS: F[] = [
  ['Rolled oats', 40, 'g', 150, 5, 27, 2.5, ['gluten'], VEGAN],
  ['Greek yogurt, plain 2%', 170, 'g', 146, 20, 8, 4, ['dairy'], VEG],
  ['Banana', 1, 'piece', 105, 1.3, 27, 0.4, [], VEGAN],
  ['Apple', 1, 'piece', 95, 0.5, 25, 0.3, [], VEGAN],
  ['Orange', 1, 'piece', 62, 1.2, 15.4, 0.2, [], VEGAN],
  ['Blueberries', 100, 'g', 57, 0.7, 14.5, 0.3, [], VEGAN],
  ['Egg, large', 1, 'piece', 72, 6.3, 0.4, 4.8, ['egg'], VEG],
  ['Whole wheat bread', 1, 'slice', 80, 4, 14, 1, ['gluten'], VEGAN],
  ['Peanut butter', 1, 'tbsp', 95, 3.5, 3.5, 8, ['peanut'], VEGAN],
  ['Almonds', 28, 'g', 164, 6, 6, 14, ['tree_nut'], VEGAN],
  ['Milk, whole', 244, 'ml', 149, 7.7, 11.7, 8, ['dairy'], VEG],
  ['Oat milk', 240, 'ml', 120, 3, 16, 5, ['gluten'], VEGAN],
  ['Chicken breast, cooked', 100, 'g', 165, 31, 0, 3.6, [], MEAT],
  ['Salmon, cooked', 100, 'g', 206, 22, 0, 12.4, ['fish'], PESC],
  ['Tuna, canned in water', 100, 'g', 116, 26, 0, 0.8, ['fish'], PESC],
  ['Shrimp, cooked', 100, 'g', 99, 24, 0.2, 0.3, ['shellfish'], PESC],
  ['Lean ground beef 90%, cooked', 100, 'g', 217, 26, 0, 12, [], MEAT],
  ['Turkey breast, sliced', 56, 'g', 60, 12, 1, 1, [], MEAT],
  ['Tofu, firm', 100, 'g', 144, 17, 3, 9, ['soy'], VEGAN],
  ['Edamame, shelled', 100, 'g', 121, 11.9, 8.9, 5.2, ['soy'], VEGAN],
  ['Lentils, cooked', 100, 'g', 116, 9, 20, 0.4, [], VEGAN],
  ['Black beans, cooked', 100, 'g', 132, 8.9, 23.7, 0.5, [], VEGAN],
  ['Chickpeas, cooked', 100, 'g', 164, 8.9, 27.4, 2.6, [], VEGAN],
  ['Brown rice, cooked', 100, 'g', 112, 2.3, 23.5, 0.8, [], VEGAN],
  ['White rice, cooked', 100, 'g', 130, 2.7, 28, 0.3, [], VEGAN],
  ['Quinoa, cooked', 100, 'g', 120, 4.4, 21.3, 1.9, [], VEGAN],
  ['Whole wheat pasta, cooked', 100, 'g', 149, 6, 30, 1.7, ['gluten'], VEGAN],
  ['Sweet potato, baked', 100, 'g', 90, 2, 20.7, 0.2, [], VEGAN],
  ['Potato, baked', 100, 'g', 93, 2.5, 21, 0.1, [], VEGAN],
  ['Broccoli', 100, 'g', 35, 2.4, 7.2, 0.4, [], VEGAN],
  ['Spinach', 100, 'g', 23, 2.9, 3.6, 0.4, [], VEGAN],
  ['Mixed salad greens', 85, 'g', 15, 1.2, 2.9, 0.2, [], VEGAN],
  ['Mixed vegetables, frozen', 100, 'g', 65, 2.9, 13, 0.5, [], VEGAN],
  ['Tomato', 1, 'piece', 22, 1.1, 4.8, 0.2, [], VEGAN],
  ['Avocado', 100, 'g', 160, 2, 8.5, 14.7, [], VEGAN],
  ['Olive oil', 1, 'tbsp', 119, 0, 0, 13.5, [], VEGAN],
  ['Cheddar cheese', 28, 'g', 113, 7, 0.4, 9.3, ['dairy'], VEG],
  ['Cottage cheese, low-fat', 113, 'g', 81, 14, 3.1, 1.2, ['dairy'], VEG],
  ['Whey protein powder', 1, 'scoop', 120, 24, 3, 1.5, ['dairy'], VEG],
  ['Pea protein powder', 1, 'scoop', 120, 24, 2, 2, [], VEGAN],
  ['Hummus', 30, 'g', 70, 2, 4, 5, ['sesame'], VEGAN],
  ['Granola', 50, 'g', 230, 5, 32, 9, ['gluten', 'tree_nut'], VEG],
  ['Dark chocolate 70%', 20, 'g', 120, 1.6, 9, 8.5, [], VEG],
  ['Corn tortilla', 1, 'piece', 57, 1.5, 12, 0.7, [], VEGAN],
  ['Flour tortilla', 1, 'piece', 140, 4, 24, 3.5, ['gluten'], VEGAN],
  ['Bagel, plain', 1, 'piece', 277, 11, 55, 1.4, ['gluten'], VEGAN],
  ['Rice cake', 1, 'piece', 35, 0.7, 7.3, 0.3, [], VEGAN],
  ['Stir-fry sauce, sesame ginger', 1, 'tbsp', 25, 0.5, 5, 0.3, ['soy', 'sesame'], VEGAN],
];

type E = [name: string, muscle: string, type: string, equipment: string, instructions: string];
const EXERCISES: E[] = [
  ['Push-up', 'chest', 'strength', 'bodyweight', 'Hands slightly wider than shoulders. Keep a straight line from head to heels. Lower your chest to just above the floor, then press back up. Drop to your knees to make it easier.'],
  ['Barbell bench press', 'chest', 'strength', 'barbell', 'Lie on the bench with eyes under the bar. Grip slightly wider than shoulders. Lower the bar to mid-chest with control, then press up. Use a spotter or safety arms for heavy sets.'],
  ['Dumbbell bench press', 'chest', 'hypertrophy', 'dumbbells', 'Lie on a bench holding dumbbells over your chest. Lower until elbows are just below the bench, then press up without clanking the weights.'],
  ['Incline dumbbell press', 'chest', 'hypertrophy', 'dumbbells', 'Set the bench to 30–45°. Press dumbbells from upper chest to above your shoulders. Keep shoulder blades pulled back.'],
  ['Pull-up', 'back', 'strength', 'pullup_bar', 'Hang with an overhand grip. Pull your chest toward the bar, then lower all the way with control. Use a band or slow lowering-only reps to build up.'],
  ['Lat pulldown', 'back', 'hypertrophy', 'machine', 'Grip the bar just wider than shoulders. Pull it to your upper chest while leaning back slightly. Return slowly.'],
  ['Bent-over dumbbell row', 'back', 'hypertrophy', 'dumbbells', 'Hinge at the hips with a flat back. Pull the dumbbells toward your hips, squeezing your shoulder blades. Lower slowly.'],
  ['Seated cable row', 'back', 'hypertrophy', 'machine', 'Sit tall with knees slightly bent. Pull the handle to your lower ribs. Avoid rocking your torso.'],
  ['Barbell deadlift', 'back', 'strength', 'barbell', 'Bar over mid-foot. Hinge and grip the bar, brace your core, keep your back flat and push the floor away. Lower by hinging back. Learn with light weight first.'],
  ['Overhead dumbbell press', 'shoulders', 'strength', 'dumbbells', 'Stand or sit tall. Press dumbbells from shoulder height to overhead without arching your lower back.'],
  ['Lateral raise', 'shoulders', 'hypertrophy', 'dumbbells', 'With a slight bend in the elbows, raise the dumbbells out to the sides to shoulder height. Lower slowly. Use light weights.'],
  ['Band pull-apart', 'shoulders', 'mobility', 'bands', 'Hold a band at shoulder height with straight arms. Pull it apart until it touches your chest. Return with control.'],
  ['Dumbbell biceps curl', 'arms', 'hypertrophy', 'dumbbells', 'Keep elbows at your sides. Curl the weights up, then lower slowly without swinging.'],
  ['Bench triceps dip', 'arms', 'strength', 'bench', 'Hands on the edge of a bench behind you. Lower until elbows are about 90°, then press up. Stop if you feel shoulder pain.'],
  ['Band triceps pushdown', 'arms', 'hypertrophy', 'bands', 'Anchor a band overhead. Keeping elbows at your sides, push down until arms are straight.'],
  ['Barbell back squat', 'legs', 'strength', 'barbell', 'Bar on upper back, feet shoulder-width. Sit down and back keeping your chest up and knees tracking over toes. Stand up through your whole foot. Use safety arms.'],
  ['Goblet squat', 'legs', 'strength', 'dumbbells', 'Hold a dumbbell at your chest. Squat between your knees as deep as is comfortable, then stand.'],
  ['Bodyweight squat', 'legs', 'strength', 'bodyweight', 'Feet shoulder-width. Sit back and down to a comfortable depth with your chest up, then stand.'],
  ['Reverse lunge', 'legs', 'strength', 'bodyweight', 'Step one foot back and lower until both knees are bent about 90°. Push through the front foot to return. Alternate legs.'],
  ['Dumbbell Romanian deadlift', 'legs', 'hypertrophy', 'dumbbells', 'Soft knees, hinge at the hips, sliding dumbbells down your thighs until you feel a hamstring stretch. Keep your back flat. Stand tall.'],
  ['Leg press', 'legs', 'hypertrophy', 'machine', 'Feet shoulder-width on the platform. Lower until knees are about 90° without your hips lifting, then press away.'],
  ['Glute bridge', 'glutes', 'strength', 'bodyweight', 'Lie on your back, knees bent. Drive through your heels to lift your hips until your body is straight from knees to shoulders. Pause, then lower.'],
  ['Kettlebell swing', 'glutes', 'hiit', 'kettlebell', 'Hinge and hike the bell back between your legs, then snap your hips forward to float it to chest height. The power comes from your hips, not your arms.'],
  ['Barbell hip thrust', 'glutes', 'hypertrophy', 'barbell', 'Upper back on a bench, padded bar across your hips. Drive your hips up, squeeze at the top, lower with control.'],
  ['Plank', 'core', 'strength', 'bodyweight', 'Forearms under shoulders, body in a straight line. Brace your core and breathe steadily. Stop when your form breaks.'],
  ['Dead bug', 'core', 'mobility', 'bodyweight', 'Lie on your back, arms up and knees at 90°. Slowly extend the opposite arm and leg while keeping your lower back on the floor.'],
  ['Hanging knee raise', 'core', 'strength', 'pullup_bar', 'Hang from a bar. Raise your knees toward your chest without swinging, then lower slowly.'],
  ['Bicycle crunch', 'core', 'strength', 'bodyweight', 'Lie on your back, hands lightly by your head. Bring opposite elbow toward opposite knee while extending the other leg. Move slowly.'],
  ['Brisk walk', 'cardio', 'cardio', 'bodyweight', 'Walk at a pace where you can talk but not sing. Great for recovery days.'],
  ['Treadmill jog', 'cardio', 'cardio', 'cardio_machine', 'Easy, conversational pace. Start with a 5-minute warm-up walk.'],
  ['Stationary bike intervals', 'cardio', 'hiit', 'cardio_machine', 'After a warm-up, alternate 30 seconds hard with 90 seconds easy. Stop if you feel dizzy or unwell.'],
  ['Jumping jacks', 'cardio', 'hiit', 'bodyweight', 'Jump feet out while raising arms overhead, then return. Step side-to-side for a low-impact version.'],
  ['Burpee', 'full_body', 'hiit', 'bodyweight', 'Squat, place hands down, step or jump back to a plank, return, and stand or jump. Step instead of jumping to reduce impact.'],
  ['Hip flexor stretch', 'legs', 'mobility', 'bodyweight', 'Kneel in a half-lunge. Tuck your pelvis and shift forward gently until you feel a stretch at the front of the back hip. Breathe and hold.'],
  ['Cat-cow', 'back', 'mobility', 'bodyweight', 'On hands and knees, slowly alternate between rounding and arching your spine with your breath.'],
  ["World's greatest stretch", 'full_body', 'mobility', 'bodyweight', 'From a lunge, place the same-side hand down inside your front foot, then rotate and reach the other arm to the ceiling. Alternate sides.'],
];

/** Deterministic pseudo-random generator so demo data is stable. */
function rng(seedValue: number) {
  let s = seedValue;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export interface SeedOptions {
  /** Create the demo users (Alex, Jordan, Sam) and their history. Default true. */
  demoUsers?: boolean;
  /** Use these details for the coach account instead of coach@demo.app / demo1234. */
  admin?: { email: string; password: string; name: string };
}

/**
 * Loads the exercise and food libraries and plan templates, plus (optionally)
 * demo users. With `demoUsers: false` and `admin`, this is a clean production start.
 */
export function seed(db: DB, today = localToday(), opts: SeedOptions = {}) {
  const demo = opts.demoUsers !== false;
  const rand = rng(42);
  const pw = hashPassword(DEMO_PASSWORD);
  const user = (email: string, name: string, role: 'admin' | 'user') =>
    run(db, 'INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)', email, pw, name, role).id;

  const coach = opts.admin
    ? run(db, "INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, 'admin')",
      opts.admin.email.trim().toLowerCase(), hashPassword(opts.admin.password), opts.admin.name).id
    : user('coach@demo.app', 'Casey Coach', 'admin');
  const alex = demo ? user('alex@demo.app', 'Alex Rivera', 'user') : 0;
  const jordan = demo ? user('jordan@demo.app', 'Jordan Lee', 'user') : 0;
  if (demo) user('sam@demo.app', 'Sam Patel', 'user'); // not onboarded: shows the onboarding flow

  // ---- library (validated through the same schemas as the API)
  const foodId = new Map<string, number>();
  const exId = new Map<string, number>();
  tx(db, () => {
    for (const [name, servingSize, servingUnit, calories, protein, carbs, fat, allergens, dietTags] of FOODS) {
      const f = foodSchema.parse({ name, servingSize, servingUnit, calories, protein, carbs, fat, allergens, dietTags, isApproximate: true });
      foodId.set(name, run(db,
        `INSERT INTO foods (name, brand, serving_size, serving_unit, calories, protein, carbs, fat, allergens, diet_tags, is_approximate, created_by)
         VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        f.name, f.servingSize, f.servingUnit, f.calories, f.protein, f.carbs, f.fat, JSON.stringify(f.allergens), JSON.stringify(f.dietTags), coach).id);
    }
    for (const [name, muscleGroup, trainingType, equipment, instructions] of EXERCISES) {
      const e = exerciseSchema.parse({ name, muscleGroup, trainingType, equipment, instructions });
      exId.set(name, run(db, 'INSERT INTO exercises (name, muscle_group, training_type, equipment, instructions, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        e.name, e.muscleGroup, e.trainingType, e.equipment, e.instructions, coach).id);
    }
  });
  const X = (name: string) => {
    const id = exId.get(name);
    if (!id) throw new Error(`Unknown exercise ${name}`);
    return id;
  };
  const FD = (name: string) => {
    const id = foodId.get(name);
    if (!id) throw new Error(`Unknown food ${name}`);
    return id;
  };
  const item = (name: string, sets: number, reps: number | null, opts: { dur?: number; rest?: number; kg?: number; notes?: string } = {}) => ({
    exerciseId: X(name), sets, reps, durationSec: opts.dur ?? null, restSec: opts.rest ?? 60, weightKg: opts.kg ?? null, notes: opts.notes ?? '',
  });

  // ---- workout templates
  const beginner: WorkoutPlanInput = {
    name: 'Beginner Full Body (3 days)',
    description: 'Three short full-body sessions a week using bodyweight and dumbbells. Leave 1–2 reps in reserve on every set.',
    days: [
      { dayIndex: 0, name: 'Full body A', focus: 'full_body', trainingType: 'strength', items: [
        item('Goblet squat', 3, 10, { kg: 12 }), item('Push-up', 3, 8, { notes: 'Use knees if needed' }), item('Bent-over dumbbell row', 3, 10, { kg: 10 }),
        item('Glute bridge', 2, 12), item('Plank', 2, null, { dur: 30, rest: 45 })] },
      { dayIndex: 2, name: 'Full body B', focus: 'full_body', trainingType: 'strength', items: [
        item('Reverse lunge', 3, 8, { notes: 'Per leg' }), item('Overhead dumbbell press', 3, 10, { kg: 8 }), item('Dumbbell Romanian deadlift', 3, 10, { kg: 12 }),
        item('Dead bug', 2, 10)] },
      { dayIndex: 4, name: 'Full body C + cardio', focus: 'full_body', trainingType: 'cardio', items: [
        item('Bodyweight squat', 3, 15), item('Incline dumbbell press', 3, 10, { kg: 10 }), item('Brisk walk', 1, null, { dur: 1200, rest: 0 })] },
    ],
  };
  const upperLower: WorkoutPlanInput = {
    name: 'Upper / Lower Strength (4 days)',
    description: 'Classic 4-day split. Add a little weight when you hit the top of the rep range on every set with good form.',
    days: [
      { dayIndex: 0, name: 'Upper body', focus: 'chest', trainingType: 'strength', items: [
        item('Dumbbell bench press', 4, 8, { kg: 22.5, rest: 90 }), item('Bent-over dumbbell row', 4, 10, { kg: 22.5, rest: 90 }),
        item('Overhead dumbbell press', 3, 10, { kg: 14 }), item('Pull-up', 3, 6, { rest: 90 }), item('Dumbbell biceps curl', 2, 12, { kg: 10 })] },
      { dayIndex: 1, name: 'Lower body', focus: 'legs', trainingType: 'strength', items: [
        item('Goblet squat', 4, 10, { kg: 24, rest: 90 }), item('Dumbbell Romanian deadlift', 3, 10, { kg: 22.5, rest: 90 }),
        item('Reverse lunge', 3, 10, { kg: 10, notes: 'Per leg' }), item('Plank', 3, null, { dur: 45, rest: 45 })] },
      { dayIndex: 3, name: 'Upper body (volume)', focus: 'back', trainingType: 'hypertrophy', items: [
        item('Incline dumbbell press', 3, 12, { kg: 18 }), item('Pull-up', 3, 8, { rest: 90 }), item('Lateral raise', 3, 15, { kg: 6 }),
        item('Bench triceps dip', 3, 12)] },
      { dayIndex: 4, name: 'Lower body (volume)', focus: 'glutes', trainingType: 'hypertrophy', items: [
        item('Glute bridge', 3, 15, { kg: 20 }), item('Goblet squat', 3, 12, { kg: 20 }), item('Hanging knee raise', 3, 10), item('Brisk walk', 1, null, { dur: 900, rest: 0 })] },
    ],
  };
  const home: WorkoutPlanInput = {
    name: 'Home Bodyweight + Cardio',
    description: 'No equipment needed. Circuits on Mon/Wed/Fri, easy cardio on Tue and Sat. Step instead of jumping for a low-impact version.',
    days: [
      { dayIndex: 0, name: 'Circuit A', focus: 'full_body', trainingType: 'hiit', items: [
        item('Jumping jacks', 3, null, { dur: 40, rest: 20 }), item('Bodyweight squat', 3, 15, { rest: 30 }), item('Push-up', 3, 10, { rest: 30 }), item('Bicycle crunch', 3, 20, { rest: 30 })] },
      { dayIndex: 1, name: 'Easy cardio', focus: 'cardio', trainingType: 'cardio', items: [item('Brisk walk', 1, null, { dur: 1800, rest: 0 })] },
      { dayIndex: 2, name: 'Circuit B', focus: 'legs', trainingType: 'strength', items: [
        item('Reverse lunge', 3, 10), item('Glute bridge', 3, 15), item('Plank', 3, null, { dur: 40, rest: 30 }), item('Burpee', 3, 8, { rest: 45 })] },
      { dayIndex: 4, name: 'Mobility + core', focus: 'core', trainingType: 'mobility', items: [
        item("World's greatest stretch", 2, 6), item('Cat-cow', 2, 10), item('Hip flexor stretch', 2, null, { dur: 45, rest: 15 }), item('Dead bug', 3, 10)] },
      { dayIndex: 5, name: 'Long walk', focus: 'cardio', trainingType: 'cardio', items: [item('Brisk walk', 1, null, { dur: 2700, rest: 0 })] },
    ],
  };
  createWorkoutPlan(db, beginner, { kind: 'template', ownerId: null, createdBy: coach });
  const ulId = createWorkoutPlan(db, upperLower, { kind: 'template', ownerId: null, createdBy: coach });
  const homeId = createWorkoutPlan(db, home, { kind: 'template', ownerId: null, createdBy: coach });

  // ---- diet templates (same structure each day, rotating lunch/dinner)
  const day = (d: number, meals: [MealType, string, number][]) => meals.map(([mealType, food, servings]) => ({ dayIndex: d, mealType, foodId: FD(food), servings }));
  const balancedItems: DietPlanInput['items'] = [];
  for (let d = 0; d < 7; d++) {
    const lunch: [MealType, string, number][] = d % 2 === 0
      ? [['lunch', 'Chicken breast, cooked', 1.5], ['lunch', 'Brown rice, cooked', 2], ['lunch', 'Broccoli', 1], ['lunch', 'Olive oil', 1]]
      : [['lunch', 'Tuna, canned in water', 1], ['lunch', 'Whole wheat bread', 2], ['lunch', 'Mixed salad greens', 1], ['lunch', 'Avocado', 1]];
    const dinner: [MealType, string, number][] = d % 3 === 0
      ? [['dinner', 'Salmon, cooked', 1.5], ['dinner', 'Sweet potato, baked', 2], ['dinner', 'Spinach', 1], ['dinner', 'Olive oil', 0.5]]
      : d % 3 === 1
        ? [['dinner', 'Lean ground beef 90%, cooked', 1.25], ['dinner', 'Whole wheat pasta, cooked', 1.5], ['dinner', 'Mixed vegetables, frozen', 1], ['dinner', 'Olive oil', 0.5]]
        : [['dinner', 'Tofu, firm', 1.5], ['dinner', 'Quinoa, cooked', 1.5], ['dinner', 'Stir-fry sauce, sesame ginger', 1], ['dinner', 'Broccoli', 1], ['dinner', 'Olive oil', 0.5]];
    balancedItems.push(...day(d, [
      ['breakfast', 'Rolled oats', 2], ['breakfast', 'Greek yogurt, plain 2%', 1], ['breakfast', 'Blueberries', 1],
      ...lunch, ...dinner,
      ['snack', d % 2 ? 'Apple' : 'Banana', 1], ['snack', 'Peanut butter', 1], ['snack', 'Almonds', 1],
    ]));
  }
  const vegItems: DietPlanInput['items'] = [];
  for (let d = 0; d < 7; d++) {
    vegItems.push(...day(d, [
      ['breakfast', 'Egg, large', 2], ['breakfast', 'Whole wheat bread', 2], ['breakfast', 'Avocado', 0.5],
      ['lunch', d % 2 ? 'Chickpeas, cooked' : 'Lentils, cooked', 1.5], ['lunch', 'Quinoa, cooked', 1.5], ['lunch', 'Spinach', 1], ['lunch', 'Hummus', 1],
      ['dinner', 'Tofu, firm', 2], ['dinner', 'Brown rice, cooked', 1.5], ['dinner', 'Mixed vegetables, frozen', 1.5], ['dinner', 'Olive oil', 1],
      ['snack', 'Cottage cheese, low-fat', 1], ['snack', 'Blueberries', 1], ['snack', 'Almonds', 1], ['snack', 'Banana', 1],
      ['breakfast', 'Greek yogurt, plain 2%', 1],
    ]));
  }
  const balancedId = createDietPlan(db, {
    name: 'Balanced ~2,000 kcal', description: 'Mixed omnivore plan with lean protein at every meal. Calories are approximate; adjust servings to your own targets.', items: balancedItems,
  }, { kind: 'template', ownerId: null, createdBy: coach });
  const vegId = createDietPlan(db, {
    name: 'Vegetarian High-Protein ~2,100 kcal', description: 'Egg, dairy and legume based. Contains egg, dairy, soy, sesame and tree nuts.', items: vegItems,
  }, { kind: 'template', ownerId: null, createdBy: coach });

  if (!demo) return { coach, alex, jordan };

  // ---- profiles
  saveProfile(db, alex, profileSchema.parse({
    name: 'Alex Rivera', age: 29, heightCm: 178, weightKg: 82, sex: 'male', units: 'metric', activityLevel: 'moderate', goal: 'lose_weight',
    dietaryPreference: 'none', allergies: ['peanut'], equipment: ['bodyweight', 'dumbbells', 'bench', 'pullup_bar'],
  }));
  saveProfile(db, jordan, profileSchema.parse({
    name: 'Jordan Lee', age: 34, heightCm: 165, weightKg: 63, sex: 'female', units: 'imperial', activityLevel: 'light', goal: 'general_fitness',
    dietaryPreference: 'vegetarian', allergies: ['tree_nut'], equipment: ['bodyweight', 'bands'],
  }));

  // ---- assign: personal copies (Alex customises theirs)
  const alexWp = createWorkoutPlan(db, workoutPlanToInput(getWorkoutPlan(db, ulId, { kind: 'template' })),
    { kind: 'personal', ownerId: alex, createdBy: coach, sourcePlanId: ulId, active: true });
  const alexPlan = workoutPlanToInput(getWorkoutPlan(db, alexWp, { kind: 'personal', ownerId: alex }));
  // Customisation: swap biceps curls for band pushdowns on day 1 and add a lateral raise.
  alexPlan.days[0].items[4] = item('Band triceps pushdown', 2, 15);
  alexPlan.days[0].items.push(item('Lateral raise', 2, 15, { kg: 6 }));
  updateWorkoutPlan(db, alexWp, alexPlan);
  const alexDp = createDietPlan(db, dietPlanToInput(getDietPlan(db, balancedId, { kind: 'template' })),
    { kind: 'personal', ownerId: alex, createdBy: coach, sourcePlanId: balancedId, active: true });
  createWorkoutPlan(db, workoutPlanToInput(getWorkoutPlan(db, homeId, { kind: 'template' })),
    { kind: 'personal', ownerId: jordan, createdBy: coach, sourcePlanId: homeId, active: true });
  createDietPlan(db, dietPlanToInput(getDietPlan(db, vegId, { kind: 'template' })),
    { kind: 'personal', ownerId: jordan, createdBy: coach, sourcePlanId: vegId, active: true });

  // ---- two weeks of history for Alex
  const finalPlan = getWorkoutPlan(db, alexWp, { kind: 'personal', ownerId: alex });
  for (let back = 13; back >= 0; back--) {
    const date = addDays(today, -back);
    const dow = weekdayIndex(date);
    const weeksIn = Math.floor((13 - back) / 7);

    // Workouts on planned days (most of them), progressing load slightly each week.
    const planned = finalPlan.days.find((d) => d.dayIndex === dow);
    if (planned && back > 0 && (back <= 7 || rand() < 0.8)) {
      writeWorkoutLog(db, alex, {
        date, title: planned.name, planId: alexWp, dayIndex: dow, notes: '',
        entries: planned.items.map((it) => {
          const done = rand() < 0.92;
          return {
            exerciseId: it.exerciseId,
            completed: done,
            sets: done
              ? Array.from({ length: it.sets }, (_, i) => ({
                reps: it.reps === null ? null : Math.max(1, it.reps - (i === it.sets - 1 && rand() < 0.4 ? 1 : 0)),
                weightKg: it.weightKg === null ? null : it.weightKg + weeksIn * 2.5,
                durationSec: it.durationSec,
              }))
              : [],
          };
        }),
      });
    }

    // Food logs from the meal plan with realistic variation; today only has breakfast so far.
    const meals = loadDietItems(db, alexDp, dow).filter((m) => back > 0 || m.mealType === 'breakfast');
    for (const m of meals) {
      if (m.food.allergens.includes('peanut')) continue; // Alex avoids peanuts
      if (m.mealType === 'snack' && rand() < 0.2) continue;
      const servings = Math.max(0.25, Math.round(m.servings * (0.9 + rand() * 0.3) * 4) / 4);
      run(db,
        `INSERT INTO food_logs (user_id, date, meal_type, food_id, food_name, serving_size, serving_unit, servings,
           calories_per_serving, protein_per_serving, carbs_per_serving, fat_per_serving, is_approximate, allergens, diet_tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        alex, date, m.mealType, m.food.id, m.food.name, m.food.servingSize, m.food.servingUnit, servings,
        m.food.calories, m.food.protein, m.food.carbs, m.food.fat, JSON.stringify(m.food.allergens), JSON.stringify(m.food.dietTags));
    }
    if (back > 0 && back % 3 === 0) {
      run(db, 'INSERT INTO weight_logs (user_id, date, weight_kg) VALUES (?, ?, ?)', alex, date, Math.round((82.6 - (13 - back) * 0.07) * 10) / 10);
    }
  }
  if (!get(db, 'SELECT id FROM weight_logs WHERE user_id = ? AND date = ?', alex, today)) {
    run(db, 'INSERT INTO weight_logs (user_id, date, weight_kg) VALUES (?, ?, ?)', alex, today, 81.7);
  }

  return { coach, alex, jordan };
}

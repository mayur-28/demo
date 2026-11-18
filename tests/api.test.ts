import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { login, setup, TODAY } from './helpers.ts';
import type { DaySummary, DietPlan, FoodLogEntry, WorkoutLog, WorkoutPlan, WorkoutPlanSummary, Dashboard, Me, Food } from '../shared/types.ts';

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });

describe('authentication', () => {
  it('registers, starts a session, and requires onboarding', async () => {
    const agent = request.agent(ctx.app);
    const res = await agent.post('/api/auth/register').set('X-Requested-With', 'fuelform').send({ name: 'New', email: 'NEW@x.io', password: 'longenough' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'new@x.io', role: 'user' });
    expect(res.body.profile).toBeNull();
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect((await agent.get('/api/me')).status).toBe(200);
  });

  it('never returns password hashes', async () => {
    const u = await login(ctx.app, 'alex@demo.app');
    const body = JSON.stringify((await u.get('/api/me')).body);
    expect(body).not.toMatch(/scrypt|password/i);
  });

  it('rejects duplicate emails, short passwords and bad credentials', async () => {
    const r = (body: object) => request(ctx.app).post('/api/auth/register').set('X-Requested-With', 'fuelform').send(body);
    expect((await r({ name: 'A', email: 'alex@demo.app', password: 'longenough' })).status).toBe(409);
    const short = await r({ name: 'A', email: 'a@b.co', password: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.fields.password).toMatch(/8 characters/);
    const bad = await request(ctx.app).post('/api/auth/login').set('X-Requested-With', 'fuelform').send({ email: 'alex@demo.app', password: 'wrong-password' });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe('Email or password is incorrect');
  });

  it('requires a session for data endpoints', async () => {
    for (const url of ['/api/me', '/api/dashboard', '/api/foods', '/api/workout-plans', '/api/food-logs']) {
      expect((await request(ctx.app).get(url)).status).toBe(401);
    }
  });

  it('blocks state-changing requests without the CSRF header', async () => {
    const res = await request(ctx.app).post('/api/auth/login').send({ email: 'alex@demo.app', password: 'demo1234' });
    expect(res.status).toBe(403);
  });

  it('logs out and invalidates the session', async () => {
    const agent = request.agent(ctx.app);
    await agent.post('/api/auth/login').set('X-Requested-With', 'fuelform').send({ email: 'alex@demo.app', password: 'demo1234' });
    await agent.post('/api/auth/logout').set('X-Requested-With', 'fuelform');
    expect((await agent.get('/api/me')).status).toBe(401);
  });

  it('rate-limits repeated failed logins', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await request(ctx.app).post('/api/auth/login').set('X-Requested-With', 'fuelform').send({ email: 'alex@demo.app', password: 'nope' })).status;
    }
    expect(last).toBe(429);
  });
});

describe('profile', () => {
  it('validates and saves onboarding, then returns estimated targets', async () => {
    const sam = await login(ctx.app, 'sam@demo.app');
    const bad = await sam.put('/api/me/profile', { name: 'Sam', age: 30 });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields)).toEqual(expect.arrayContaining(['heightCm', 'weightKg', 'activityLevel', 'goal']));

    const ok = await sam.put('/api/me/profile', {
      name: 'Sam P', age: 30, heightCm: 170, weightKg: 70, units: 'imperial', activityLevel: 'light', goal: 'lose_weight', allergies: ['dairy'], equipment: ['bands'],
    });
    expect(ok.status).toBe(200);
    const me = ok.body as Me;
    expect(me.user.name).toBe('Sam P');
    expect(me.profile?.allergies).toEqual(['dairy']);
    expect(me.targets?.isCustom).toBe(false);
    expect(me.targets!.calories).toBeGreaterThanOrEqual(1500);
  });

  it('accepts custom targets but never below 1200 kcal', async () => {
    const alex = await login(ctx.app, 'alex@demo.app');
    const base = (await alex.get('/api/me')).body.profile;
    expect((await alex.put('/api/me/profile', { ...base, customTargets: { calories: 900, protein: 100, carbs: 50, fat: 30 } })).status).toBe(400);
    const ok = await alex.put('/api/me/profile', { ...base, customTargets: { calories: 2100, protein: 150, carbs: 220, fat: 70 } });
    expect(ok.body.targets).toMatchObject({ calories: 2100, isCustom: true });
  });
});

describe('permissions', () => {
  it('only coaches can create or edit templates and library entries', async () => {
    const alex = await login(ctx.app, 'alex@demo.app');
    expect((await alex.post('/api/workout-templates', { name: 'Hack', days: [] })).status).toBe(403);
    expect((await alex.put('/api/workout-templates/1', { name: 'Hack', days: [] })).status).toBe(403);
    expect((await alex.del('/api/diet-templates/1')).status).toBe(403);
    expect((await alex.post('/api/workout-templates/1/assign', { userIds: [2] })).status).toBe(403);
    expect((await alex.post('/api/foods', { name: 'X', servingSize: 1, servingUnit: 'g', calories: 0, protein: 0, carbs: 0, fat: 0 })).status).toBe(403);
    expect((await alex.del('/api/exercises/1')).status).toBe(403);
    expect((await alex.get('/api/admin/users')).status).toBe(403);
  });

  it("users cannot read or change another user's plans or logs (404, no leak)", async () => {
    const alex = await login(ctx.app, 'alex@demo.app');
    const jordan = await login(ctx.app, 'jordan@demo.app');
    const alexPlans = (await alex.get('/api/workout-plans')).body as WorkoutPlanSummary[];
    const alexDiet = (await alex.get('/api/diet-plans')).body as WorkoutPlanSummary[];
    const planId = alexPlans[0].id;

    expect((await jordan.get(`/api/workout-plans/${planId}`)).status).toBe(404);
    expect((await jordan.put(`/api/workout-plans/${planId}`, { name: 'Mine now', days: [] })).status).toBe(404);
    expect((await jordan.del(`/api/workout-plans/${planId}`)).status).toBe(404);
    expect((await jordan.post(`/api/workout-plans/${planId}/activate`)).status).toBe(404);
    expect((await jordan.get(`/api/diet-plans/${alexDiet[0].id}`)).status).toBe(404);
    expect((await jordan.post('/api/food-logs/from-plan', { date: TODAY, planId: alexDiet[0].id })).status).toBe(404);

    const alexLog = ((await alex.get(`/api/food-logs?date=${TODAY}`)).body as DaySummary).entries[0];
    expect((await jordan.patch(`/api/food-logs/${alexLog.id}`, { servings: 5 })).status).toBe(404);
    expect((await jordan.del(`/api/food-logs/${alexLog.id}`)).status).toBe(404);

    const alexWorkout = ((await alex.get('/api/workout-logs')).body as WorkoutLog[])[0];
    expect((await jordan.get(`/api/workout-logs/${alexWorkout.id}`)).status).toBe(404);
    expect((await jordan.del(`/api/workout-logs/${alexWorkout.id}`)).status).toBe(404);

    // Jordan's own lists never include Alex's data.
    const jLogs = (await jordan.get('/api/workout-logs')).body as WorkoutLog[];
    expect(jLogs.find((l) => l.id === alexWorkout.id)).toBeUndefined();
    // And Alex's data is untouched.
    expect((await alex.get(`/api/workout-plans/${planId}`)).body.name).toBe(alexPlans[0].name);
  });

  it('a user cannot log a workout against someone else’s plan', async () => {
    const alex = await login(ctx.app, 'alex@demo.app');
    const jordan = await login(ctx.app, 'jordan@demo.app');
    const planId = ((await alex.get('/api/workout-plans')).body as WorkoutPlanSummary[])[0].id;
    const res = await jordan.post('/api/workout-logs', { date: TODAY, title: 'x', planId, entries: [{ exerciseId: 1, completed: true, sets: [{ reps: 5 }] }] });
    expect(res.status).toBe(400);
  });

  it('templates are readable by any signed-in user but personal plans are not listed as templates', async () => {
    const jordan = await login(ctx.app, 'jordan@demo.app');
    const tpls = (await jordan.get('/api/workout-templates')).body as WorkoutPlanSummary[];
    expect(tpls.length).toBe(3);
    expect(tpls.every((t) => t.kind === 'template' && t.ownerId === null)).toBe(true);
    const alex = await login(ctx.app, 'alex@demo.app');
    const alexPlan = ((await alex.get('/api/workout-plans')).body as WorkoutPlanSummary[])[0];
    expect((await jordan.get(`/api/workout-templates/${alexPlan.id}`)).status).toBe(404);
  });
});

describe('plan templates and personal copies', () => {
  it('coach creates, duplicates and assigns; customising a copy never changes the template', async () => {
    const coach = await login(ctx.app, 'coach@demo.app');
    const created = await coach.post('/api/workout-templates', {
      name: 'Test plan', description: 'd',
      days: [{ dayIndex: 1, name: 'Tue', items: [{ exerciseId: 1, sets: 3, reps: 10 }, { exerciseId: 2, sets: 3, reps: 5, weightKg: 40 }] }],
    });
    expect(created.status).toBe(201);
    const tpl = created.body as WorkoutPlan;
    expect(tpl.kind).toBe('template');

    const dup = await coach.post(`/api/workout-templates/${tpl.id}/duplicate`);
    expect(dup.body.name).toBe('Copy of Test plan');
    expect(dup.body.days[0].items).toHaveLength(2);

    const assign = await coach.post(`/api/workout-templates/${tpl.id}/assign`, { userIds: [ctx.ids.jordan] });
    expect(assign.body.assigned).toBe(1);

    const jordan = await login(ctx.app, 'jordan@demo.app');
    const mine = (await jordan.get('/api/workout-plans')).body as WorkoutPlanSummary[];
    const copy = mine.find((p) => p.sourcePlanId === tpl.id)!;
    expect(copy).toBeTruthy();
    expect(copy.active).toBe(true);
    expect(mine.filter((p) => p.active)).toHaveLength(1); // previous active plan deactivated
    expect(copy.sourcePlanName).toBe('Test plan');

    // Customise: reorder, replace, remove, add.
    const full = (await jordan.get(`/api/workout-plans/${copy.id}`)).body as WorkoutPlan;
    const items = full.days[0].items.map((i) => ({ exerciseId: i.exerciseId, sets: i.sets, reps: i.reps, durationSec: i.durationSec, restSec: i.restSec, weightKg: i.weightKg, notes: i.notes }));
    const customised = [{ ...items[1], exerciseId: 5 }, { exerciseId: 25, sets: 2, reps: null, durationSec: 30, restSec: 30, weightKg: null, notes: 'added' }];
    const saved = await jordan.put(`/api/workout-plans/${copy.id}`, { name: 'My version', description: '', days: [{ dayIndex: 1, name: 'Tue', items: customised }] });
    expect(saved.status).toBe(200);
    expect(saved.body.days[0].items.map((i: { exerciseId: number }) => i.exerciseId)).toEqual([5, 25]);

    const tplAfter = (await coach.get(`/api/workout-templates/${tpl.id}`)).body as WorkoutPlan;
    expect(tplAfter.name).toBe('Test plan');
    expect(tplAfter.days[0].items.map((i) => i.exerciseId)).toEqual([1, 2]);

    // Editing the template later doesn't change the copy either.
    await coach.put(`/api/workout-templates/${tpl.id}`, { name: 'Test plan v2', description: '', days: [] });
    expect(((await jordan.get(`/api/workout-plans/${copy.id}`)).body as WorkoutPlan).days[0].items).toHaveLength(2);

    // Reset pulls the template's current content into the copy, keeping its name.
    const reset = await jordan.post(`/api/workout-plans/${copy.id}/reset`);
    expect(reset.body.days).toHaveLength(0);
    expect(reset.body.name).toBe('My version');

    // Deleting the template keeps personal copies.
    expect((await coach.del(`/api/workout-templates/${tpl.id}`)).status).toBe(200);
    expect((await jordan.get(`/api/workout-plans/${copy.id}`)).status).toBe(200);
  });

  it('rejects incomplete workout plan entries', async () => {
    const coach = await login(ctx.app, 'coach@demo.app');
    const res = await coach.post('/api/workout-templates', { name: 'Bad', days: [{ dayIndex: 0, name: 'Mon', items: [{ exerciseId: 1, sets: 3 }] }] });
    expect(res.status).toBe(400);
    const missingEx = await coach.post('/api/workout-templates', { name: 'Bad', days: [{ dayIndex: 0, name: 'Mon', items: [{ exerciseId: 99999, sets: 3, reps: 5 }] }] });
    expect(missingEx.status).toBe(400);
  });

  it('user copies a diet template, customises servings and day totals update', async () => {
    const jordan = await login(ctx.app, 'jordan@demo.app');
    const copy = (await jordan.post('/api/diet-templates/1/copy')).body as DietPlan;
    expect(copy.kind).toBe('personal');
    const mondayBefore = copy.dayTotals[0].calories;
    const items = copy.items.map((i) => ({ dayIndex: i.dayIndex, mealType: i.mealType, foodId: i.foodId, servings: i.servings }));
    const first = items.findIndex((i) => i.dayIndex === 0);
    const firstFood = copy.items[first].food;
    items[first] = { ...items[first], servings: items[first].servings + 1 };
    const saved = (await jordan.put(`/api/diet-plans/${copy.id}`, { name: copy.name, description: '', items })).body as DietPlan;
    expect(saved.dayTotals[0].calories).toBe(mondayBefore + Math.round(firstFood.calories));
    expect((await jordan.put(`/api/diet-plans/${copy.id}`, { name: copy.name, items: [{ ...items[0], servings: -1 }] })).status).toBe(400);
    expect((await jordan.put(`/api/diet-plans/${copy.id}`, { name: copy.name, items: [{ ...items[0], servings: 0 }] })).status).toBe(400);
  });
});

describe('food logging', () => {
  it('logs food, calculates nutrition from servings, edits and deletes', async () => {
    const jordan = await login(ctx.app, 'jordan@demo.app');
    const oats = ((await jordan.get('/api/foods?q=rolled')).body as Food[])[0];
    const created = await jordan.post('/api/food-logs', { date: TODAY, mealType: 'breakfast', foodId: oats.id, servings: 1.5 });
    expect(created.status).toBe(201);
    const entry = created.body as FoodLogEntry;
    expect(entry.nutrition).toEqual({ calories: 225, protein: 7.5, carbs: 40.5, fat: 3.8 });
    expect(entry.isApproximate).toBe(true);

    const edited = (await jordan.patch(`/api/food-logs/${entry.id}`, { servings: 2, mealType: 'snack' })).body as FoodLogEntry;
    expect(edited.nutrition.calories).toBe(300);
    expect(edited.mealType).toBe('snack');

    const day = (await jordan.get(`/api/food-logs?date=${TODAY}`)).body as DaySummary;
    expect(day.totals.calories).toBe(300);
    expect(day.byMeal.snack.calories).toBe(300);
    expect(day.byMeal.breakfast.calories).toBe(0);

    expect((await jordan.del(`/api/food-logs/${entry.id}`)).status).toBe(200);
    expect(((await jordan.get(`/api/food-logs?date=${TODAY}`)).body as DaySummary).entries).toHaveLength(0);
  });

  it('rejects negative, zero, and excessive servings and unknown foods', async () => {
    const jordan = await login(ctx.app, 'jordan@demo.app');
    for (const servings of [-1, 0, 50]) {
      expect((await jordan.post('/api/food-logs', { date: TODAY, mealType: 'lunch', foodId: 1, servings })).status).toBe(400);
    }
    expect((await jordan.post('/api/food-logs', { date: TODAY, mealType: 'lunch', foodId: 99999, servings: 1 })).status).toBe(400);
    expect((await jordan.post('/api/food-logs', { date: 'yesterday', mealType: 'lunch', foodId: 1, servings: 1 })).status).toBe(400);
  });

  it('keeps past logs stable when a coach corrects a food, while plans pick up the change', async () => {
    const coach = await login(ctx.app, 'coach@demo.app');
    const jordan = await login(ctx.app, 'jordan@demo.app');
    const food = ((await coach.get('/api/foods?q=rolled')).body as Food[])[0];
    const logged = (await jordan.post('/api/food-logs', { date: TODAY, mealType: 'breakfast', foodId: food.id, servings: 1 })).body as FoodLogEntry;

    const upd = await coach.put(`/api/foods/${food.id}`, { ...food, calories: 160, carbs: 29 });
    expect(upd.status).toBe(200);

    const day = (await jordan.get(`/api/food-logs?date=${TODAY}`)).body as DaySummary;
    expect(day.entries.find((e) => e.id === logged.id)!.nutrition.calories).toBe(150);
    // Editing servings recalculates from the logged snapshot, consistently.
    expect(((await jordan.patch(`/api/food-logs/${logged.id}`, { servings: 2 })).body as FoodLogEntry).nutrition.calories).toBe(300);
    // New logs use the corrected value.
    expect(((await jordan.post('/api/food-logs', { date: TODAY, mealType: 'snack', foodId: food.id, servings: 1 })).body as FoodLogEntry).nutrition.calories).toBe(160);
  });

  it('coach cannot save implausible food nutrition', async () => {
    const coach = await login(ctx.app, 'coach@demo.app');
    const res = await coach.post('/api/foods', { name: 'Typo', servingSize: 100, servingUnit: 'g', calories: 50, protein: 80, carbs: 30, fat: 10 });
    expect(res.status).toBe(400);
  });

  it('logs a planned meal from the active diet plan', async () => {
    const jordan = await login(ctx.app, 'jordan@demo.app');
    const plan = ((await jordan.get('/api/diet-plans')).body as DietPlan[])[0];
    const res = await jordan.post('/api/food-logs/from-plan', { date: TODAY, planId: plan.id, mealType: 'lunch' });
    expect(res.status).toBe(201);
    const day = res.body as DaySummary;
    const full = (await jordan.get(`/api/diet-plans/${plan.id}`)).body as DietPlan;
    const plannedLunch = full.items.filter((i) => i.dayIndex === 1 && i.mealType === 'lunch');
    expect(day.entries).toHaveLength(plannedLunch.length);
    expect(day.byMeal.lunch.calories).toBe(plannedLunch.reduce((a, i) => a + i.nutrition.calories, 0));
  });

  it('archives (not deletes) foods that are referenced, so history survives', async () => {
    const coach = await login(ctx.app, 'coach@demo.app');
    const res = await coach.del('/api/foods/1');
    expect(res.body).toEqual({ archived: true });
    const list = (await coach.get('/api/foods')).body as Food[];
    expect(list.find((f) => f.id === 1)).toBeUndefined();
    const jordan = await login(ctx.app, 'jordan@demo.app');
    expect((await jordan.post('/api/food-logs', { date: TODAY, mealType: 'lunch', foodId: 1, servings: 1 })).status).toBe(400);
  });
});

describe('workout logging and progress', () => {
  it('logs a workout with actual sets, shows it in history and on the dashboard', async () => {
    const jordan = await login(ctx.app, 'jordan@demo.app');
    const plan = ((await jordan.get('/api/workout-plans')).body as WorkoutPlanSummary[])[0];
    const full = (await jordan.get(`/api/workout-plans/${plan.id}`)).body as WorkoutPlan;
    const tuesday = full.days.find((d) => d.dayIndex === 1)!;
    const res = await jordan.post('/api/workout-logs', {
      date: TODAY, title: tuesday.name, planId: plan.id, dayIndex: 1, notes: 'felt good',
      entries: tuesday.items.map((i) => ({ exerciseId: i.exerciseId, completed: true, sets: [{ reps: null, weightKg: null, durationSec: 1700 }] })),
    });
    expect(res.status).toBe(201);
    const log = res.body as WorkoutLog;
    expect(log.completedCount).toBe(tuesday.items.length);
    expect(log.entries[0].exerciseName).toBe(tuesday.items[0].exercise.name);

    const dash = (await jordan.get(`/api/dashboard?date=${TODAY}`)).body as Dashboard;
    expect(dash.workout.day?.dayIndex).toBe(1);
    expect(dash.workout.loggedToday).toHaveLength(1);
    expect(dash.week.completedWorkouts).toBe(1);
    expect(dash.week.plannedWorkouts).toBe(5);

    const upd = await jordan.put(`/api/workout-logs/${log.id}`, { date: TODAY, title: 'Edited', entries: [{ exerciseId: 1, completed: true, sets: [{ reps: 12 }] }] });
    expect(upd.body.title).toBe('Edited');
    expect(upd.body.entries).toHaveLength(1);
  });

  it('rejects incomplete workout logs', async () => {
    const jordan = await login(ctx.app, 'jordan@demo.app');
    expect((await jordan.post('/api/workout-logs', { date: TODAY, title: 'x', entries: [] })).status).toBe(400);
    expect((await jordan.post('/api/workout-logs', { date: TODAY, title: 'x', entries: [{ exerciseId: 1, completed: true, sets: [] }] })).status).toBe(400);
    expect((await jordan.post('/api/workout-logs', { date: TODAY, title: 'x', entries: [{ exerciseId: 1, completed: false, sets: [] }] })).status).toBe(400);
  });

  it('progress reports daily totals, strength trends and weights from demo history', async () => {
    const alex = await login(ctx.app, 'alex@demo.app');
    const p = (await alex.get(`/api/progress?end=${TODAY}&days=14`)).body;
    expect(p.days).toHaveLength(14);
    expect(p.days.filter((d: { logged: boolean }) => d.logged).length).toBeGreaterThanOrEqual(13);
    expect(p.exerciseTrends.length).toBeGreaterThan(0);
    for (const t of p.exerciseTrends) expect(t.latestBestKg).toBeGreaterThanOrEqual(t.firstBestKg);
    expect(p.weights.length).toBeGreaterThan(2);
  });

  it('the seeded dashboard flags nothing invalid and nutrition totals equal the sum of entries', async () => {
    const alex = await login(ctx.app, 'alex@demo.app');
    const d = (await alex.get(`/api/dashboard?date=${TODAY}`)).body as Dashboard;
    const sum = d.today.entries.reduce((a, e) => a + e.nutrition.calories, 0);
    expect(d.today.totals.calories).toBe(sum);
    expect(d.targets!.calories).toBeGreaterThanOrEqual(1500);
    expect(d.meals.items.length).toBeGreaterThan(0);
  });
});

describe('weekly summary', () => {
  it('averages only completed days, so a half-logged today does not drag the average down', async () => {
    const alex = await login(ctx.app, 'alex@demo.app');
    const d = (await alex.get(`/api/dashboard?date=${TODAY}`)).body as Dashboard;
    // TODAY is Tuesday: Monday is complete, Tuesday has breakfast only.
    expect(d.week.daysLogged).toBe(2);
    expect(d.week.avgDays).toBe(1);
    const monday = (await alex.get('/api/food-logs?date=2026-11-16')).body as DaySummary;
    expect(d.week.avg.calories).toBe(monday.totals.calories);
  });
});

describe('robustness', () => {
  it('returns JSON errors for malformed bodies and unknown routes', async () => {
    const alex = await login(ctx.app, 'alex@demo.app');
    const bad = await request(ctx.app).post('/api/auth/login').set('X-Requested-With', 'fuelform').set('Content-Type', 'application/json').send('{not json');
    expect(bad.status).toBe(400);
    expect((await alex.get('/api/nope')).status).toBe(404);
    expect((await alex.get('/api/workout-plans/abc')).status).toBe(404);
    expect((await alex.get('/api/food-logs?date=2026-13-01')).status).toBe(400);
  });

  it('sets security headers', async () => {
    const res = await request(ctx.app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('production start (no demo users)', () => {
  it('creates only the configured coach, with libraries and templates', async () => {
    const { openDb, all } = await import('../server/db.ts');
    const { seed } = await import('../server/seed.ts');
    const db = openDb(':memory:');
    seed(db, TODAY, { demoUsers: false, admin: { email: 'Owner@Example.com', password: 'a-strong-pass', name: 'Owner' } });
    const users = all<{ email: string; role: string }>(db, 'SELECT email, role FROM users');
    expect(users).toEqual([{ email: 'owner@example.com', role: 'admin' }]);
    expect(all(db, 'SELECT id FROM foods').length).toBeGreaterThan(40);
    expect(all(db, "SELECT id FROM workout_plans WHERE kind = 'template'").length).toBe(3);
    expect(all(db, 'SELECT id FROM food_logs').length).toBe(0);
  });
});

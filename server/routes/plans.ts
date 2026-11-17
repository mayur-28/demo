import { Router } from 'express';
import { all, run, type DB } from '../db.ts';
import { requireAdmin } from '../auth.ts';
import { h, HttpError, idParam, validate } from '../http.ts';
import { assignSchema, dietPlanSchema, workoutPlanSchema } from '../../shared/schemas.ts';
import {
  createDietPlan, createWorkoutPlan, dietPlanToInput, getDietPlan, getWorkoutPlan, listDietPlans, listWorkoutPlans,
  loadPlanMeta, setActivePlan, updateDietPlan, updateWorkoutPlan, workoutPlanToInput,
} from '../services.ts';
import type { PlanKind } from '../../shared/types.ts';

/**
 * Builds template routes (shared, read by everyone, written by coaches) and
 * personal-plan routes (owner only) for one plan family. Personal plans are
 * always deep copies, so editing one never touches its template.
 */
function planFamily<Input extends { name: string }, Plan extends { name: string }>(
  db: DB,
  cfg: {
    table: 'workout_plans' | 'diet_plans';
    templatesPath: string;
    personalPath: string;
    schema: { safeParse: (d: unknown) => unknown } & Parameters<typeof validate>[0];
    list: (db: DB, f: { kind: PlanKind; ownerId?: number }) => unknown;
    get: (db: DB, id: number, a: { kind: PlanKind; ownerId?: number }) => Plan;
    toInput: (p: Plan) => Input;
    create: (db: DB, input: Input, o: { kind: PlanKind; ownerId: number | null; createdBy: number; sourcePlanId?: number | null; active?: boolean }) => number;
    update: (db: DB, id: number, input: Input) => void;
  },
) {
  const r = Router();
  const T = cfg.templatesPath;
  const P = cfg.personalPath;
  const tpl = { kind: 'template' as const };

  // ---------- templates
  r.get(T, h(() => cfg.list(db, tpl)));
  r.get(`${T}/:id`, h((req) => cfg.get(db, idParam(req), tpl)));

  r.post(T, requireAdmin, h((req, res) => {
    const input = validate(cfg.schema, req.body) as Input;
    const id = cfg.create(db, input, { kind: 'template', ownerId: null, createdBy: req.user!.id });
    res.status(201);
    return cfg.get(db, id, tpl);
  }));

  r.put(`${T}/:id`, requireAdmin, h((req) => {
    const id = idParam(req);
    loadPlanMeta(db, cfg.table, id, tpl);
    cfg.update(db, id, validate(cfg.schema, req.body) as Input);
    return cfg.get(db, id, tpl);
  }));

  r.delete(`${T}/:id`, requireAdmin, h((req) => {
    const id = idParam(req);
    loadPlanMeta(db, cfg.table, id, tpl);
    // Personal copies survive; their source link becomes NULL.
    run(db, `DELETE FROM ${cfg.table} WHERE id = ? AND kind = 'template'`, id);
    return { deleted: true };
  }));

  r.post(`${T}/:id/duplicate`, requireAdmin, h((req, res) => {
    const src = cfg.get(db, idParam(req), tpl);
    const input = { ...cfg.toInput(src), name: `Copy of ${src.name}`.slice(0, 80) };
    const id = cfg.create(db, input, { kind: 'template', ownerId: null, createdBy: req.user!.id });
    res.status(201);
    return cfg.get(db, id, tpl);
  }));

  r.post(`${T}/:id/assign`, requireAdmin, h((req) => {
    const srcId = idParam(req);
    const src = cfg.get(db, srcId, tpl);
    const { userIds } = validate(assignSchema, req.body);
    const users = all(db, `SELECT id FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`, ...userIds);
    if (users.length !== new Set(userIds).size) throw new HttpError(400, 'One or more users do not exist');
    const created = userIds.map((uid) =>
      cfg.create(db, cfg.toInput(src), { kind: 'personal', ownerId: uid, createdBy: req.user!.id, sourcePlanId: srcId, active: true }),
    );
    return { assigned: created.length, planIds: created };
  }));

  /** Any signed-in user can copy a shared template into their own plans. */
  r.post(`${T}/:id/copy`, h((req, res) => {
    const srcId = idParam(req);
    const src = cfg.get(db, srcId, tpl);
    const id = cfg.create(db, cfg.toInput(src), { kind: 'personal', ownerId: req.user!.id, createdBy: req.user!.id, sourcePlanId: srcId, active: true });
    res.status(201);
    return cfg.get(db, id, { kind: 'personal', ownerId: req.user!.id });
  }));

  // ---------- personal plans (owner only; others get 404)
  const mine = (uid: number) => ({ kind: 'personal' as const, ownerId: uid });

  r.get(P, h((req) => cfg.list(db, mine(req.user!.id))));
  r.get(`${P}/:id`, h((req) => cfg.get(db, idParam(req), mine(req.user!.id))));

  r.post(P, h((req, res) => {
    const input = validate(cfg.schema, req.body) as Input;
    const hasActive = all(db, `SELECT id FROM ${cfg.table} WHERE owner_id = ? AND active = 1`, req.user!.id).length > 0;
    const id = cfg.create(db, input, { kind: 'personal', ownerId: req.user!.id, createdBy: req.user!.id, active: !hasActive });
    res.status(201);
    return cfg.get(db, id, mine(req.user!.id));
  }));

  r.put(`${P}/:id`, h((req) => {
    const id = idParam(req);
    loadPlanMeta(db, cfg.table, id, mine(req.user!.id));
    cfg.update(db, id, validate(cfg.schema, req.body) as Input);
    return cfg.get(db, id, mine(req.user!.id));
  }));

  r.post(`${P}/:id/activate`, h((req) => {
    const id = idParam(req);
    loadPlanMeta(db, cfg.table, id, mine(req.user!.id));
    setActivePlan(db, cfg.table, req.user!.id, id);
    return cfg.get(db, id, mine(req.user!.id));
  }));

  /** Discard customisations: replace the personal copy's contents with the current template. */
  r.post(`${P}/:id/reset`, h((req) => {
    const id = idParam(req);
    const meta = loadPlanMeta(db, cfg.table, id, mine(req.user!.id));
    if (!meta.sourcePlanId) throw new HttpError(400, 'This plan was not created from a template');
    const src = cfg.get(db, meta.sourcePlanId, tpl);
    cfg.update(db, id, { ...cfg.toInput(src), name: meta.name });
    return cfg.get(db, id, mine(req.user!.id));
  }));

  r.delete(`${P}/:id`, h((req) => {
    const id = idParam(req);
    loadPlanMeta(db, cfg.table, id, mine(req.user!.id));
    run(db, `DELETE FROM ${cfg.table} WHERE id = ? AND owner_id = ?`, id, req.user!.id);
    return { deleted: true };
  }));

  return r;
}

export function planRoutes(db: DB) {
  const r = Router();
  r.use(planFamily(db, {
    table: 'workout_plans', templatesPath: '/workout-templates', personalPath: '/workout-plans', schema: workoutPlanSchema,
    list: listWorkoutPlans, get: getWorkoutPlan, toInput: workoutPlanToInput, create: createWorkoutPlan, update: updateWorkoutPlan,
  }));
  r.use(planFamily(db, {
    table: 'diet_plans', templatesPath: '/diet-templates', personalPath: '/diet-plans', schema: dietPlanSchema,
    list: listDietPlans, get: getDietPlan, toInput: dietPlanToInput, create: createDietPlan, update: updateDietPlan,
  }));
  return r;
}

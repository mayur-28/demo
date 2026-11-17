import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type ApiError } from '../api.ts';
import { useApi, useMe, useToast } from '../hooks.ts';
import { MEAL_TYPES, WEEKDAYS, label } from '../../shared/constants.ts';
import { localToday, weekdayIndex } from '../../shared/dates.ts';
import { sumMacros } from '../../shared/nutrition.ts';
import type { DietPlan, DietPlanSummary } from '../../shared/types.ts';
import type { DietPlanInput } from '../../shared/schemas.ts';
import { Async, Badge, Card, EmptyState, HealthNotice, MacroLine, PageHeader, fmtNum } from '../components/ui.tsx';
import { DayTabs, DietPlanEditor } from '../components/DietPlanEditor.tsx';
import { FoodFlags, hasConflict } from '../components/FoodFlags.tsx';

export function MealPlansPage() {
  const mine = useApi<DietPlanSummary[]>('/diet-plans');
  const templates = useApi<DietPlanSummary[]>('/diet-templates');
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<number | null>(null);

  async function copy(t: DietPlanSummary) {
    setBusy(t.id);
    try {
      const plan = await api.post<DietPlan>(`/diet-templates/${t.id}/copy`);
      toast('success', `“${t.name}” added to your meal plans`);
      navigate(`/meals/${plan.id}`);
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }
  async function activate(p: DietPlanSummary) {
    try {
      await api.post(`/diet-plans/${p.id}/activate`);
      toast('success', `“${p.name}” is now your active meal plan`);
      mine.reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    }
  }

  return (
    <>
      <PageHeader title="Meal plans" subtitle="Your meal plans are private copies you can adjust to suit your tastes and targets." />
      <Card title="My meal plans">
        <Async state={mine}>
          {(list) => list.length === 0 ? (
            <EmptyState title="No meal plan yet">Add a template below, then swap foods and adjust servings.</EmptyState>
          ) : (
            <ul className="plan-list">
              {list.map((p) => (
                <li key={p.id} className="plan-row">
                  <div>
                    <Link className="plan-name" to={`/meals/${p.id}`}>{p.name}</Link> {p.active && <Badge tone="ok">Active</Badge>}
                    <p className="small muted">≈ {fmtNum(p.avgDailyCalories)} kcal/day{p.sourcePlanName ? ` · Your copy of “${p.sourcePlanName}”` : ''}</p>
                  </div>
                  <div className="row gap">
                    {!p.active && <button type="button" className="btn btn-small" onClick={() => activate(p)}>Make active</button>}
                    <Link className="btn btn-small" to={`/meals/${p.id}`}>Open</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>
      <Card title="Coach templates" actions={<Badge tone="info">Shared</Badge>}>
        <Async state={templates}>
          {(list) => list.length === 0 ? <EmptyState title="No meal plan templates yet" /> : (
            <ul className="plan-list">
              {list.map((t) => (
                <li key={t.id} className="plan-row">
                  <div>
                    <span className="plan-name">{t.name}</span>
                    <p className="small muted">≈ {fmtNum(t.avgDailyCalories)} kcal/day · {t.itemCount} items</p>
                    {t.description && <p className="small">{t.description}</p>}
                  </div>
                  <button type="button" className="btn btn-small" disabled={busy === t.id} onClick={() => copy(t)}>{busy === t.id ? 'Adding…' : 'Add to my plans'}</button>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>
      <HealthNotice compact />
    </>
  );
}

export function DietPlanView({ plan, day, setDay, onLogMeal }: { plan: DietPlan; day: number; setDay: (d: number) => void; onLogMeal?: (meal: string) => void }) {
  const me = useMe();
  const items = plan.items.filter((i) => i.dayIndex === day);
  const conflicts = plan.items.filter((i) => hasConflict(i.food, me.profile)).length;
  return (
    <div className="stack">
      {conflicts > 0 && (
        <p className="alert alert-warn" role="note">
          {conflicts} item{conflicts > 1 ? 's' : ''} in this plan may not suit your allergies or diet (flagged below). Use “Customise” to swap them.
        </p>
      )}
      <DayTabs day={day} setDay={setDay} />
      <Card title={WEEKDAYS[day]} actions={<span className="small"><MacroLine m={plan.dayTotals[day]} approx /></span>}>
        {items.length === 0 ? <p className="muted">Nothing planned for this day.</p> : MEAL_TYPES.map((m) => {
          const list = items.filter((i) => i.mealType === m);
          if (!list.length) return null;
          return (
            <section key={m} className="meal-view">
              <div className="card-head">
                <h3>{label(m)} <span className="muted small">≈ {fmtNum(sumMacros(list.map((i) => i.nutrition)).calories)} kcal</span></h3>
                {onLogMeal && <button type="button" className="btn btn-small" onClick={() => onLogMeal(m)}>Log this meal today</button>}
              </div>
              <ul className="plain-list">
                {list.map((i) => (
                  <li key={i.id} className="list-row">
                    <span>{i.food.name} <span className="muted small">{fmtNum(i.servings)} × {i.food.servingSize}{i.food.servingUnit}</span> <FoodFlags food={i.food} /></span>
                    <span className="small muted">{fmtNum(i.nutrition.calories)} kcal · P {fmtNum(i.nutrition.protein)}g</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {me.targets && <p className="small muted">Your daily target ≈ {fmtNum(me.targets.calories)} kcal, {me.targets.protein} g protein. Adjust servings to match.</p>}
      </Card>
    </div>
  );
}

export function MealPlanPage() {
  const { id } = useParams();
  const state = useApi<DietPlan>(`/diet-plans/${id}`);
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const today = localToday();
  const [day, setDay] = useState(weekdayIndex(today));

  async function save(input: DietPlanInput) {
    state.setData(await api.put<DietPlan>(`/diet-plans/${id}`, input));
    setEditing(false);
    toast('success', 'Meal plan saved');
  }
  async function act(path: string, msg: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      state.setData(await api.post<DietPlan>(`/diet-plans/${id}/${path}`));
      toast('success', msg);
    } catch (e) {
      toast('error', (e as ApiError).message);
    }
  }
  async function remove() {
    if (!window.confirm('Delete this meal plan? Your food log is kept.')) return;
    try {
      await api.del(`/diet-plans/${id}`);
      toast('success', 'Meal plan deleted');
      navigate('/meals');
    } catch (e) {
      toast('error', (e as ApiError).message);
    }
  }
  async function logMeal(mealType: string) {
    if (day !== weekdayIndex(today) && !window.confirm(`This is ${WEEKDAYS[day]}'s meal. Log today's (${WEEKDAYS[weekdayIndex(today)]}) planned ${label(mealType).toLowerCase()} instead?`)) return;
    try {
      await api.post('/food-logs/from-plan', { date: today, planId: Number(id), mealType });
      toast('success', `${label(mealType)} added to today's log`);
    } catch (e) {
      toast('error', (e as ApiError).message);
    }
  }

  return (
    <Async state={state}>
      {(plan) => (
        <>
          <PageHeader back={{ to: '/meals', label: 'Meal plans' }} title={plan.name}
            subtitle={<>{plan.active && <Badge tone="ok">Active</Badge>} <Badge>Your copy</Badge>{plan.sourcePlanName && <span className="small"> Based on “{plan.sourcePlanName}” — your changes never affect the template.</span>}</>}
            actions={!editing && <>
              <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>Customise</button>
              {!plan.active && <button type="button" className="btn" onClick={() => act('activate', 'Meal plan is now active')}>Make active</button>}
            </>} />
          {plan.description && !editing && <p>{plan.description}</p>}
          {editing ? <DietPlanEditor plan={plan} onSave={save} onCancel={() => setEditing(false)} initialDay={day} /> : (
            <>
              <DietPlanView plan={plan} day={day} setDay={setDay} onLogMeal={logMeal} />
              <div className="row gap danger-zone">
                {plan.sourcePlanId && <button type="button" className="btn btn-ghost" onClick={() => act('reset', 'Reset to template', 'Replace your changes with the current template?')}>Reset to template</button>}
                <button type="button" className="btn btn-danger-ghost" onClick={remove}>Delete plan</button>
              </div>
            </>
          )}
        </>
      )}
    </Async>
  );
}

import { Link } from 'react-router-dom';
import { useState } from 'react';
import { api, qs, type ApiError } from '../api.ts';
import { useApi, useMe, useToast, useUnits } from '../hooks.ts';
import { MEAL_TYPES, WEEKDAYS, label } from '../../shared/constants.ts';
import { formatDate, localToday, weekdayIndex } from '../../shared/dates.ts';
import { sumMacros } from '../../shared/nutrition.ts';
import type { Dashboard, DaySummary } from '../../shared/types.ts';
import { Async, Badge, Card, EmptyState, HealthNotice, MacroLine, PageHeader, ProgressBar, fmtNum } from '../components/ui.tsx';
import { FoodFlags } from '../components/FoodFlags.tsx';
import { describeSets } from './Workouts.tsx';

export function DashboardPage() {
  const me = useMe();
  const today = localToday();
  const state = useApi<Dashboard>(`/dashboard${qs({ date: today })}`);
  const first = me.user.name.split(' ')[0];

  if (me.user.role === 'admin' && !me.profile) {
    return (
      <>
        <PageHeader title={`Hi ${first}`} subtitle="You're signed in as a coach." />
        <Card title="Coach tools">
          <p>Create and assign workout and meal plan templates, and manage the exercise and food libraries.</p>
          <div className="row gap">
            <Link className="btn btn-primary" to="/coach">Open coach tools</Link>
            <Link className="btn" to="/exercises">Exercises</Link>
            <Link className="btn" to="/foods">Foods</Link>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title={`Hi ${first}`} subtitle={formatDate(today, { weekday: 'long', month: 'long', day: 'numeric' })} />
      <Async state={state}>{(d) => <DashboardBody d={d} reload={state.reload} />}</Async>
      <HealthNotice compact />
    </>
  );
}

function DashboardBody({ d, reload }: { d: Dashboard; reload: () => void }) {
  const toast = useToast();
  const { fmtWeight } = useUnits();
  const [busyMeal, setBusyMeal] = useState<string | null>(null);
  const t = d.targets;
  const loggedMeals = new Set(d.today.entries.map((e) => e.mealType));

  async function logMeal(mealType: string) {
    if (!d.meals.plan) return;
    setBusyMeal(mealType);
    try {
      await api.post<DaySummary>('/food-logs/from-plan', { date: d.date, planId: d.meals.plan.id, mealType });
      toast('success', `${label(mealType)} logged`);
      reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusyMeal(null);
    }
  }

  const workoutDone = d.workout.loggedToday.length > 0;
  return (
    <div className="dash-grid">
      <Card title="Nutrition today" className="span-2" actions={<Link className="btn btn-small" to="/nutrition">Log food</Link>}>
        {t ? (
          <div className="progress-grid">
            <ProgressBar label="Calories" value={d.today.totals.calories} goal={t.calories} unit="kcal" approx={d.today.hasApproximate} />
            <ProgressBar label="Protein" value={d.today.totals.protein} goal={t.protein} unit="g" approx={d.today.hasApproximate} />
            <ProgressBar label="Carbs" value={d.today.totals.carbs} goal={t.carbs} unit="g" approx={d.today.hasApproximate} />
            <ProgressBar label="Fat" value={d.today.totals.fat} goal={t.fat} unit="g" approx={d.today.hasApproximate} />
          </div>
        ) : <p className="muted">Complete your profile to see targets.</p>}
        {d.today.hasApproximate && <p className="muted small">≈ Totals use typical nutrition values and are approximate.</p>}
      </Card>

      <Card title={`Today's workout${d.workout.day ? `: ${d.workout.day.name}` : ''}`}>
        {!d.workout.plan ? (
          <EmptyState title="No active workout plan" action={<Link className="btn btn-primary" to="/workouts">Choose a plan</Link>}>Pick a plan from your coach's templates to get started.</EmptyState>
        ) : !d.workout.day || d.workout.day.items.length === 0 ? (
          <EmptyState title="Rest day" action={<Link className="btn" to="/workouts/log">Log a different workout</Link>}>
            Nothing planned for {WEEKDAYS[weekdayIndex(d.date)]} in “{d.workout.plan.name}”. Light walking or stretching is a good choice.
          </EmptyState>
        ) : (
          <>
            {workoutDone && <p className="alert alert-success">✓ Done — {d.workout.loggedToday[0].completedCount} exercises logged today.</p>}
            <ul className="plain-list">
              {d.workout.day.items.map((i) => (
                <li key={i.id} className="list-row">
                  <span>{i.exercise.name}</span>
                  <span className="muted small">{describeSets(i, fmtWeight)}</span>
                </li>
              ))}
            </ul>
            <div className="row gap">
              <Link className={`btn ${workoutDone ? '' : 'btn-primary'}`} to={`/workouts/log${qs({ plan: d.workout.plan.id, day: d.workout.day.dayIndex })}`}>
                {workoutDone ? 'Log again' : 'Start workout'}
              </Link>
              <Link className="btn btn-ghost" to={`/workouts/${d.workout.plan.id}`}>View plan</Link>
            </div>
          </>
        )}
      </Card>

      <Card title="Today's meals" actions={d.meals.plan && <Link className="btn btn-small btn-ghost" to={`/meals/${d.meals.plan.id}`}>Plan</Link>}>
        {!d.meals.plan ? (
          <EmptyState title="No active meal plan" action={<Link className="btn" to="/meals">Browse meal plans</Link>}>You can still log any food from the library.</EmptyState>
        ) : d.meals.items.length === 0 ? (
          <EmptyState title="Nothing planned today">Log what you eat in the food log.</EmptyState>
        ) : (
          <ul className="plain-list">
            {MEAL_TYPES.map((m) => {
              const items = d.meals.items.filter((i) => i.mealType === m);
              if (!items.length) return null;
              const tot = sumMacros(items.map((i) => i.nutrition));
              return (
                <li key={m} className="meal-row">
                  <div>
                    <strong>{label(m)}</strong> <span className="muted small">≈ {fmtNum(tot.calories)} kcal</span>
                    <p className="small muted">{items.map((i) => i.food.name).join(', ')}</p>
                    <span className="flags">{items.map((i) => <FoodFlags key={i.id} food={i.food} />)}</span>
                  </div>
                  {loggedMeals.has(m) ? <Badge tone="ok">Logged</Badge> : (
                    <button type="button" className="btn btn-small" onClick={() => logMeal(m)} disabled={busyMeal !== null} aria-label={`Log planned ${label(m).toLowerCase()}`}>
                      {busyMeal === m ? 'Logging…' : 'Log'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="This week" className="span-2" actions={<Link className="btn btn-small btn-ghost" to="/progress">Details</Link>}>
        <dl className="stats">
          <div><dt>Workouts</dt><dd>{d.week.completedWorkouts}<span className="muted"> / {d.week.plannedWorkouts || '—'}</span></dd></div>
          <div><dt>Days food logged</dt><dd>{d.week.daysLogged}<span className="muted"> / 7</span></dd></div>
          <div><dt>Avg calories</dt><dd>{d.week.avgDays ? `≈ ${fmtNum(d.week.avg.calories)}` : '—'}</dd></div>
          <div><dt>Avg protein</dt><dd>{d.week.avgDays ? `${fmtNum(d.week.avg.protein)} g` : '—'}</dd></div>
        </dl>
        <p className="muted small">Week of {formatDate(d.week.start, { month: 'short', day: 'numeric' })}. Averages use completed logged days (today is still in progress).</p>
        {d.today.entries.length > 0 && <p className="small">Logged today: <MacroLine m={d.today.totals} approx={d.today.hasApproximate} /></p>}
      </Card>
    </div>
  );
}

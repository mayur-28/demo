import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs, type ApiError } from '../api.ts';
import { useApi, useToast, useUnits } from '../hooks.ts';
import { WEEKDAYS, label } from '../../shared/constants.ts';
import { localToday, weekdayIndex } from '../../shared/dates.ts';
import type { WorkoutItem, WorkoutPlan, WorkoutPlanSummary } from '../../shared/types.ts';
import type { WorkoutPlanInput } from '../../shared/schemas.ts';
import { Async, Badge, Card, EmptyState, PageHeader } from '../components/ui.tsx';
import { WorkoutPlanEditor } from '../components/WorkoutPlanEditor.tsx';

export const fmtDuration = (sec: number) => (sec >= 60 ? `${Math.round((sec / 60) * 10) / 10} min` : `${sec} s`);

export function describeSets(i: Pick<WorkoutItem, 'sets' | 'reps' | 'durationSec' | 'weightKg'>, fmtWeight: (kg: number | null) => string) {
  const work = i.reps !== null ? `${i.reps} reps` : i.durationSec !== null ? fmtDuration(i.durationSec) : '';
  const sets = i.sets > 1 ? `${i.sets} × ${work}` : work;
  return i.weightKg ? `${sets} @ ${fmtWeight(i.weightKg)}` : sets;
}

export function WorkoutsPage() {
  const mine = useApi<WorkoutPlanSummary[]>('/workout-plans');
  const templates = useApi<WorkoutPlanSummary[]>('/workout-templates');
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<number | null>(null);

  async function copy(t: WorkoutPlanSummary) {
    setBusy(t.id);
    try {
      const plan = await api.post<WorkoutPlan>(`/workout-templates/${t.id}/copy`);
      toast('success', `“${t.name}” added to your plans and set as active`);
      navigate(`/workouts/${plan.id}`);
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  async function activate(p: WorkoutPlanSummary) {
    try {
      await api.post(`/workout-plans/${p.id}/activate`);
      toast('success', `“${p.name}” is now your active plan`);
      mine.reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    }
  }

  return (
    <>
      <PageHeader title="Workouts" subtitle="Your plans are private copies — change them freely without affecting your coach's templates."
        actions={<>
          <Link className="btn btn-primary" to="/workouts/log">Log a workout</Link>
          <Link className="btn" to="/workouts/history">History</Link>
        </>} />
      <Card title="My plans">
        <Async state={mine}>
          {(list) => list.length === 0 ? (
            <EmptyState title="You don't have a workout plan yet">Add one of your coach's templates below. You can customise it afterwards.</EmptyState>
          ) : (
            <ul className="plan-list">
              {list.map((p) => (
                <li key={p.id} className="plan-row">
                  <div>
                    <Link to={`/workouts/${p.id}`} className="plan-name">{p.name}</Link>
                    {p.active && <Badge tone="ok">Active</Badge>}
                    <p className="small muted">
                      {p.dayCount} days · {p.exerciseCount} exercises
                      {p.sourcePlanName ? ` · Your copy of “${p.sourcePlanName}”` : p.sourcePlanId === null && p.ownerId ? ' · Your own plan' : ''}
                    </p>
                  </div>
                  <div className="row gap">
                    {!p.active && <button type="button" className="btn btn-small" onClick={() => activate(p)}>Make active</button>}
                    <Link className="btn btn-small" to={`/workouts/${p.id}`}>Open</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>
      <Card title="Coach templates" actions={<Badge tone="info">Shared</Badge>}>
        <p className="muted small">Templates are shared and read-only. Adding one creates your own private copy.</p>
        <Async state={templates}>
          {(list) => list.length === 0 ? <EmptyState title="No templates yet">Your coach hasn't published any workout templates.</EmptyState> : (
            <ul className="plan-list">
              {list.map((t) => (
                <li key={t.id} className="plan-row">
                  <div>
                    <span className="plan-name">{t.name}</span>
                    <p className="small muted">{t.dayCount} days · {t.exerciseCount} exercises</p>
                    {t.description && <p className="small">{t.description}</p>}
                  </div>
                  <button type="button" className="btn btn-small" disabled={busy === t.id} onClick={() => copy(t)}>{busy === t.id ? 'Adding…' : 'Add to my plans'}</button>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>
    </>
  );
}

export function WorkoutPlanView({ plan, startable }: { plan: WorkoutPlan; startable?: boolean }) {
  const { fmtWeight } = useUnits();
  const todayIdx = weekdayIndex(localToday());
  if (plan.days.length === 0) return <EmptyState title="This plan has no workout days yet" />;
  return (
    <div className="stack">
      {plan.days.map((d) => (
        <Card key={d.id} title={<>{WEEKDAYS[d.dayIndex]} · {d.name} {d.dayIndex === todayIdx && <Badge tone="info">Today</Badge>}</>}
          actions={startable && d.items.length > 0 && <Link className="btn btn-small btn-primary" to={`/workouts/log${qs({ plan: plan.id, day: d.dayIndex })}`}>Start</Link>}>
          {(d.focus || d.trainingType) && <p className="small muted">{[d.focus && label(d.focus), d.trainingType && label(d.trainingType)].filter(Boolean).join(' · ')}</p>}
          {d.items.length === 0 ? <p className="muted">No exercises.</p> : (
            <ol className="exercise-list">
              {d.items.map((i) => (
                <li key={i.id}>
                  <details>
                    <summary>
                      <span className="ex-name">{i.exercise.name}</span>
                      <span className="ex-target">{describeSets(i, fmtWeight)}{i.restSec ? ` · rest ${fmtDuration(i.restSec)}` : ''}</span>
                    </summary>
                    {i.notes && <p className="small"><strong>Note:</strong> {i.notes}</p>}
                    <p className="small">{i.exercise.instructions || 'No instructions yet.'}</p>
                    <p className="small muted">{label(i.exercise.muscleGroup)} · {label(i.exercise.equipment)}</p>
                  </details>
                </li>
              ))}
            </ol>
          )}
        </Card>
      ))}
    </div>
  );
}

export function WorkoutPlanPage() {
  const { id } = useParams();
  const state = useApi<WorkoutPlan>(`/workout-plans/${id}`);
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  async function save(input: WorkoutPlanInput) {
    const updated = await api.put<WorkoutPlan>(`/workout-plans/${id}`, input);
    state.setData(updated);
    setEditing(false);
    toast('success', 'Plan saved');
  }

  async function act(path: string, msg: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      const res = await api.post<WorkoutPlan>(`/workout-plans/${id}/${path}`);
      state.setData(res);
      toast('success', msg);
    } catch (e) {
      toast('error', (e as ApiError).message);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this plan? Your workout history is kept.')) return;
    try {
      await api.del(`/workout-plans/${id}`);
      toast('success', 'Plan deleted');
      navigate('/workouts');
    } catch (e) {
      toast('error', (e as ApiError).message);
    }
  }

  return (
    <Async state={state}>
      {(plan) => (
        <>
          <PageHeader back={{ to: '/workouts', label: 'Workouts' }} title={plan.name}
            subtitle={<>{plan.active ? <Badge tone="ok">Active</Badge> : null} <Badge>Your copy</Badge>{plan.sourcePlanName && <span className="small"> Based on the “{plan.sourcePlanName}” template — changes here never affect it.</span>}</>}
            actions={!editing && (
              <>
                <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>Customise</button>
                {!plan.active && <button type="button" className="btn" onClick={() => act('activate', 'Plan is now active')}>Make active</button>}
              </>
            )} />
          {plan.description && !editing && <p>{plan.description}</p>}
          {editing ? (
            <WorkoutPlanEditor plan={plan} onSave={save} onCancel={() => setEditing(false)} />
          ) : (
            <>
              <WorkoutPlanView plan={plan} startable />
              <div className="row gap danger-zone">
                {plan.sourcePlanId && <button type="button" className="btn btn-ghost" onClick={() => act('reset', 'Plan reset to the template', 'Replace your customisations with the current template?')}>Reset to template</button>}
                <button type="button" className="btn btn-danger-ghost" onClick={remove}>Delete plan</button>
              </div>
            </>
          )}
        </>
      )}
    </Async>
  );
}

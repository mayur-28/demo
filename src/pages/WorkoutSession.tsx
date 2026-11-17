import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type ApiError } from '../api.ts';
import { useToast, useUnits } from '../hooks.ts';
import { localToday } from '../../shared/dates.ts';
import { formatZodError, workoutLogSchema } from '../../shared/schemas.ts';
import type { Exercise, WorkoutLog, WorkoutPlan } from '../../shared/types.ts';
import { ErrorBox, Loading, PageHeader, TextInput } from '../components/ui.tsx';
import { ExercisePicker } from '../components/Pickers.tsx';
import { describeSets } from './Workouts.tsx';

interface SetRow { key: number; reps: string; weight: string; duration: string }
interface Entry { key: number; exercise: Pick<Exercise, 'id' | 'name'>; target?: string; completed: boolean; sets: SetRow[] }

let seq = 0;
const nk = () => ++seq;
const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const num = (v: string) => (v.trim() === '' ? null : Number(v));

export function WorkoutSessionPage() {
  const { logId } = useParams();
  const [params] = useSearchParams();
  const planId = params.get('plan') ? Number(params.get('plan')) : null;
  const dayIndex = params.get('day') ? Number(params.get('day')) : null;
  const units = useUnits();
  const toast = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(Boolean(logId || planId));
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [date, setDate] = useState(localToday());
  const [title, setTitle] = useState('Workout');
  const [notes, setNotes] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [meta, setMeta] = useState<{ planId: number | null; dayIndex: number | null }>({ planId, dayIndex });
  const [picking, setPicking] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (logId) {
          const log = await api.get<WorkoutLog>(`/workout-logs/${logId}`);
          if (cancelled) return;
          setDate(log.date); setTitle(log.title); setNotes(log.notes); setMeta({ planId: log.planId, dayIndex: log.dayIndex });
          setEntries(log.entries.filter((e) => e.exerciseId !== null).map((e) => ({
            key: nk(), exercise: { id: e.exerciseId!, name: e.exerciseName }, completed: e.completed,
            sets: (e.sets.length ? e.sets : [{ reps: null, weightKg: null, durationSec: null }]).map((s) => ({ key: nk(), reps: str(s.reps), weight: str(units.toDisplayWeight(s.weightKg)), duration: str(s.durationSec) })),
          })));
        } else if (planId !== null) {
          const plan = await api.get<WorkoutPlan>(`/workout-plans/${planId}`);
          if (cancelled) return;
          const day = plan.days.find((d) => d.dayIndex === dayIndex);
          if (day) {
            setTitle(day.name);
            setEntries(day.items.map((i) => ({
              key: nk(), exercise: i.exercise, completed: false, target: describeSets(i, units.fmtWeight),
              sets: Array.from({ length: i.sets }, () => ({ key: nk(), reps: str(i.reps), weight: str(units.toDisplayWeight(i.weightKg)), duration: str(i.durationSec) })),
            })));
          }
        }
      } catch (e) {
        if (!cancelled) setLoadError(e as ApiError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // Load once per route; unit helpers are stable for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logId, planId, dayIndex]);

  // Any edit clears a stale validation message; it is re-checked on save.
  useEffect(() => { setFormError(null); }, [entries]);

  const upd = (key: number, patch: Partial<Entry>) => setEntries((es) => es.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  const updSet = (ek: number, sk: number, patch: Partial<SetRow>) =>
    setEntries((es) => es.map((e) => (e.key !== ek ? e : { ...e, sets: e.sets.map((s) => (s.key === sk ? { ...s, ...patch } : s)) })));

  function payload() {
    return {
      date, title, notes, planId: meta.planId, dayIndex: meta.dayIndex,
      entries: entries.map((e) => ({
        exerciseId: e.exercise.id, completed: e.completed,
        sets: e.sets.map((s) => ({ reps: num(s.reps), weightKg: units.fromDisplayWeight(num(s.weight)), durationSec: num(s.duration) })),
      })),
    };
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const parsed = workoutLogSchema.safeParse(payload());
    if (!parsed.success) {
      const f = formatZodError(parsed.error);
      setErrors(f.fields);
      setFormError(f.message);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (logId) await api.put(`/workout-logs/${logId}`, parsed.data);
      else await api.post('/workout-logs', parsed.data);
      toast('success', 'Workout saved. Nice work!');
      navigate('/workouts/history');
    } catch (e) {
      setFormError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (loadError) return <ErrorBox error={loadError} />;

  const done = entries.filter((e) => e.completed).length;
  return (
    <>
      <PageHeader back={{ to: '/workouts', label: 'Workouts' }} title={logId ? 'Edit workout' : 'Log workout'}
        subtitle={`${done} of ${entries.length} exercises done`} />
      <form onSubmit={submit} noValidate className="stack">
        {formError && <ErrorBox error={formError} />}
        <div className="card grid-2">
          <TextInput label="Workout" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
          <TextInput label="Date" type="date" max={localToday()} value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
        </div>

        {entries.length === 0 && <p className="muted">Add the exercises you did.</p>}
        {entries.map((e, ei) => (
          <fieldset key={e.key} className={`card log-entry ${e.completed ? 'is-done' : ''}`}>
            <legend className="sr-only">{e.exercise.name}</legend>
            <div className="item-head">
              <label className="check done-check">
                <input type="checkbox" checked={e.completed} onChange={(x) => upd(e.key, { completed: x.target.checked })} />
                <strong>{e.exercise.name}</strong>
              </label>
              <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => setEntries((es) => es.filter((x) => x.key !== e.key))} aria-label={`Remove ${e.exercise.name}`}>Remove</button>
            </div>
            {e.target && <p className="small muted">Target: {e.target}</p>}
            {errors[`entries.${ei}.sets`] && <p className="field-error" role="alert">{errors[`entries.${ei}.sets`]}</p>}
            <table className="sets-table">
              <thead><tr><th scope="col">Set</th><th scope="col">Reps</th><th scope="col">{units.weightUnit}</th><th scope="col">Sec</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {e.sets.map((s, si) => (
                  <tr key={s.key}>
                    <th scope="row">{si + 1}</th>
                    <td><input aria-label={`${e.exercise.name} set ${si + 1} reps`} type="number" inputMode="numeric" min={0} value={s.reps} onChange={(x) => updSet(e.key, s.key, { reps: x.target.value })} /></td>
                    <td><input aria-label={`${e.exercise.name} set ${si + 1} weight in ${units.weightUnit}`} type="number" inputMode="decimal" step="0.5" min={0} value={s.weight} onChange={(x) => updSet(e.key, s.key, { weight: x.target.value })} /></td>
                    <td><input aria-label={`${e.exercise.name} set ${si + 1} seconds`} type="number" inputMode="numeric" min={0} value={s.duration} onChange={(x) => updSet(e.key, s.key, { duration: x.target.value })} /></td>
                    <td><button type="button" className="btn-icon" aria-label={`Delete set ${si + 1}`} onClick={() => upd(e.key, { sets: e.sets.filter((x) => x.key !== s.key) })} disabled={e.sets.length === 1}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="btn btn-small" onClick={() => {
              const last = e.sets[e.sets.length - 1];
              upd(e.key, { sets: [...e.sets, { key: nk(), reps: last?.reps ?? '', weight: last?.weight ?? '', duration: last?.duration ?? '' }] });
            }}>+ Add set</button>
          </fieldset>
        ))}

        <button type="button" className="btn" onClick={() => setPicking(true)}>+ Add exercise</button>
        <div className="card">
          <div className="field">
            <label htmlFor="log-notes">Notes <span className="optional">(optional)</span></label>
            <textarea id="log-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How did it feel?" />
          </div>
        </div>
        <p className="muted small">Stop and rest if you feel pain, dizziness or chest discomfort. Progress gradually.</p>
        <div className="form-actions sticky-actions">
          <button type="button" className="btn" onClick={() => setEntries((es) => es.map((e) => ({ ...e, completed: true })))} disabled={!entries.length}>Mark all done</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Finish & save'}</button>
        </div>
      </form>
      <ExercisePicker open={picking} onClose={() => setPicking(false)} onPick={(ex) => {
        const cardio = ex.trainingType === 'cardio';
        setEntries((es) => [...es, { key: nk(), exercise: ex, completed: false, sets: [{ key: nk(), reps: cardio ? '' : '10', weight: '', duration: cardio ? '600' : '' }] }]);
        setPicking(false);
      }} />
    </>
  );
}

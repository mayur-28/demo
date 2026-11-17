import { useMemo, useState, type FormEvent } from 'react';
import { MUSCLE_GROUPS, TRAINING_TYPES, WEEKDAYS, label, type MuscleGroup, type TrainingType } from '../../shared/constants.ts';
import { formatZodError, workoutPlanSchema, type WorkoutPlanInput } from '../../shared/schemas.ts';
import type { Exercise, WorkoutPlan } from '../../shared/types.ts';
import { useUnits } from '../hooks.ts';
import { ErrorBox, SelectInput, TextInput } from './ui.tsx';
import { ExercisePicker } from './Pickers.tsx';

interface EditItem {
  key: string;
  exercise: Exercise;
  sets: string; reps: string; duration: string; rest: string; weight: string; notes: string;
}
interface EditDay { key: string; dayIndex: number; name: string; focus: MuscleGroup | ''; trainingType: TrainingType | ''; items: EditItem[] }

let keySeq = 0;
const k = () => `k${++keySeq}`;
const s = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const num = (v: string) => (v.trim() === '' ? null : Number(v));

function fromPlan(plan: Pick<WorkoutPlan, 'days'>, toDisp: (kg: number | null) => number | null): EditDay[] {
  return plan.days.map((d) => ({
    key: k(), dayIndex: d.dayIndex, name: d.name, focus: d.focus ?? '', trainingType: d.trainingType ?? '',
    items: d.items.map((i) => ({
      key: k(), exercise: i.exercise, sets: s(i.sets), reps: s(i.reps), duration: s(i.durationSec), rest: s(i.restSec), weight: s(toDisp(i.weightKg)), notes: i.notes,
    })),
  }));
}

/**
 * Full plan editor: days, exercises, and per-exercise targets. Add, remove,
 * reorder (move up/down buttons, keyboard friendly) and replace exercises.
 * Nothing is saved until the user presses Save.
 */
export function WorkoutPlanEditor({ plan, onSave, onCancel, saveLabel = 'Save plan' }: {
  plan: Pick<WorkoutPlan, 'name' | 'description' | 'days'>;
  onSave: (input: WorkoutPlanInput) => Promise<void>;
  onCancel?: () => void;
  saveLabel?: string;
}) {
  const units = useUnits();
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description);
  const [days, setDays] = useState<EditDay[]>(() => fromPlan(plan, units.toDisplayWeight));
  const [picker, setPicker] = useState<{ dayKey: string; replaceKey?: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usedDays = useMemo(() => new Set(days.map((d) => d.dayIndex)), [days]);

  const updateDay = (key: string, patch: Partial<EditDay>) => setDays((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const updateItem = (dayKey: string, itemKey: string, patch: Partial<EditItem>) =>
    setDays((ds) => ds.map((d) => (d.key !== dayKey ? d : { ...d, items: d.items.map((i) => (i.key === itemKey ? { ...i, ...patch } : i)) })));
  const moveItem = (dayKey: string, idx: number, dir: -1 | 1) =>
    setDays((ds) => ds.map((d) => {
      if (d.key !== dayKey) return d;
      const items = [...d.items];
      const j = idx + dir;
      if (j < 0 || j >= items.length) return d;
      [items[idx], items[j]] = [items[j], items[idx]];
      return { ...d, items };
    }));
  const removeItem = (dayKey: string, itemKey: string) =>
    setDays((ds) => ds.map((d) => (d.key !== dayKey ? d : { ...d, items: d.items.filter((i) => i.key !== itemKey) })));

  function addDay() {
    const free = [0, 1, 2, 3, 4, 5, 6].find((i) => !usedDays.has(i));
    if (free === undefined) return;
    setDays((ds) => [...ds, { key: k(), dayIndex: free, name: 'New workout', focus: '', trainingType: '', items: [] } as EditDay].sort((a, b) => a.dayIndex - b.dayIndex));
  }

  function pick(ex: Exercise) {
    if (!picker) return;
    const { dayKey, replaceKey } = picker;
    if (replaceKey) {
      // Replace keeps the targets (sets, reps, rest) so swapping is one step.
      updateItem(dayKey, replaceKey, { exercise: ex, weight: '' });
    } else {
      const cardio = ex.trainingType === 'cardio';
      setDays((ds) => ds.map((d) => (d.key !== dayKey ? d : {
        ...d,
        items: [...d.items, { key: k(), exercise: ex, sets: cardio ? '1' : '3', reps: cardio ? '' : '10', duration: cardio ? '1200' : '', rest: cardio ? '0' : '60', weight: '', notes: '' }],
      })));
    }
    setPicker(null);
  }

  function toInput(): WorkoutPlanInput {
    return {
      name, description,
      days: days.map((d) => ({
        dayIndex: d.dayIndex, name: d.name, focus: d.focus || null, trainingType: d.trainingType || null,
        items: d.items.map((i) => ({
          exerciseId: i.exercise.id, sets: num(i.sets) as number, reps: num(i.reps), durationSec: num(i.duration),
          restSec: num(i.rest) ?? 0, weightKg: units.fromDisplayWeight(num(i.weight)), notes: i.notes,
        })),
      })),
    };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = workoutPlanSchema.safeParse(toInput());
    if (!parsed.success) {
      const f = formatZodError(parsed.error);
      setErrors(f.fields);
      setFormError(`Please fix the highlighted fields: ${f.message}`);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSave(parsed.data);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="stack editor">
      {formError && <ErrorBox error={formError} />}
      <div className="card">
        <TextInput label="Plan name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} required />
        <Field2 label="Description" optional value={description} onChange={setDescription} />
      </div>

      {days.length === 0 && <p className="muted">No workout days yet. Add a day to start building the plan.</p>}
      {days.map((d, di) => (
        <fieldset key={d.key} className="card day-editor">
          <legend className="sr-only">{WEEKDAYS[d.dayIndex]} workout</legend>
          <div className="grid-4">
            <SelectInput label="Day" options={['0', '1', '2', '3', '4', '5', '6']} labelFor={(v) => WEEKDAYS[Number(v)]}
              value={String(d.dayIndex)} onChange={(e) => updateDay(d.key, { dayIndex: Number(e.target.value) })} error={errors.days} />
            <TextInput label="Workout name" value={d.name} onChange={(e) => updateDay(d.key, { name: e.target.value })} error={errors[`days.${di}.name`]} />
            <SelectInput label="Focus" optional options={MUSCLE_GROUPS} placeholder="—" value={d.focus} onChange={(e) => updateDay(d.key, { focus: e.target.value as MuscleGroup })} />
            <SelectInput label="Type" optional options={TRAINING_TYPES} placeholder="—" value={d.trainingType} onChange={(e) => updateDay(d.key, { trainingType: e.target.value as TrainingType })} />
          </div>

          <ol className="item-list">
            {d.items.map((i, ii) => {
              const err = (f: string) => errors[`days.${di}.items.${ii}.${f}`];
              return (
                <li key={i.key} className="item-editor">
                  <div className="item-head">
                    <span className="item-num" aria-hidden="true">{ii + 1}</span>
                    <strong>{i.exercise.name}</strong>
                    {i.exercise.archived && <span className="badge badge-warn">Retired from library</span>}
                    <div className="item-tools">
                      <button type="button" className="btn-icon" onClick={() => moveItem(d.key, ii, -1)} disabled={ii === 0} aria-label={`Move ${i.exercise.name} up`}>↑</button>
                      <button type="button" className="btn-icon" onClick={() => moveItem(d.key, ii, 1)} disabled={ii === d.items.length - 1} aria-label={`Move ${i.exercise.name} down`}>↓</button>
                      <button type="button" className="btn btn-small" onClick={() => setPicker({ dayKey: d.key, replaceKey: i.key })} aria-label={`Replace ${i.exercise.name}`}>Replace</button>
                      <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => removeItem(d.key, i.key)} aria-label={`Remove ${i.exercise.name}`}>Remove</button>
                    </div>
                  </div>
                  <div className="grid-5">
                    <TextInput label="Sets" type="number" inputMode="numeric" min={1} max={20} value={i.sets} onChange={(e) => updateItem(d.key, i.key, { sets: e.target.value })} error={err('sets')} />
                    <TextInput label="Reps" type="number" inputMode="numeric" min={1} value={i.reps} onChange={(e) => updateItem(d.key, i.key, { reps: e.target.value })} error={err('reps')} />
                    <TextInput label="Time (sec)" type="number" inputMode="numeric" min={5} value={i.duration} onChange={(e) => updateItem(d.key, i.key, { duration: e.target.value })} error={err('durationSec')} />
                    <TextInput label="Rest (sec)" type="number" inputMode="numeric" min={0} value={i.rest} onChange={(e) => updateItem(d.key, i.key, { rest: e.target.value })} error={err('restSec')} />
                    <TextInput label={`Weight (${units.weightUnit})`} optional type="number" inputMode="decimal" step="0.5" min={0} value={i.weight} onChange={(e) => updateItem(d.key, i.key, { weight: e.target.value })} error={err('weightKg')} />
                  </div>
                  <TextInput label="Notes" optional value={i.notes} onChange={(e) => updateItem(d.key, i.key, { notes: e.target.value })} error={err('notes')} />
                </li>
              );
            })}
          </ol>
          <div className="row gap">
            <button type="button" className="btn" onClick={() => setPicker({ dayKey: d.key })}>+ Add exercise</button>
            <button type="button" className="btn btn-danger-ghost" onClick={() => setDays((ds) => ds.filter((x) => x.key !== d.key))}>Remove day</button>
          </div>
        </fieldset>
      ))}

      <button type="button" className="btn" onClick={addDay} disabled={days.length >= 7}>+ Add workout day</button>
      <div className="form-actions sticky-actions">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : saveLabel}</button>
      </div>
      <ExercisePicker open={!!picker} onClose={() => setPicker(null)} onPick={pick} title={picker?.replaceKey ? 'Replace exercise' : 'Add exercise'} />
    </form>
  );
}

export function Field2({ label: l, value, onChange, optional }: { label: string; value: string; onChange: (v: string) => void; optional?: boolean }) {
  const id = `ta-${l.replace(/\W/g, '')}`;
  return (
    <div className="field">
      <label htmlFor={id}>{l}{optional && <span className="optional"> (optional)</span>}</label>
      <textarea id={id} rows={2} value={value} onChange={(e) => onChange(e.target.value)} maxLength={500} />
    </div>
  );
}

export { label };

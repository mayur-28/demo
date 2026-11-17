import { useState, type FormEvent } from 'react';
import { api, type ApiError } from '../api.ts';
import { useSession, useToast } from '../hooks.ts';
import { EQUIPMENT, MUSCLE_GROUPS, TRAINING_TYPES, label } from '../../shared/constants.ts';
import { exerciseSchema, formatZodError, type ExerciseInput } from '../../shared/schemas.ts';
import type { Exercise } from '../../shared/types.ts';
import { Async, Badge, EmptyState, ErrorBox, Modal, PageHeader, SelectInput, TextInput } from '../components/ui.tsx';
import { ExerciseFilters, useExerciseSearch } from '../components/Pickers.tsx';

const BLANK: ExerciseInput = { name: '', muscleGroup: 'full_body', trainingType: 'strength', equipment: 'bodyweight', instructions: '' };

export function ExercisesPage() {
  const { me } = useSession();
  const isAdmin = me?.user.role === 'admin';
  const toast = useToast();
  const { filters, state } = useExerciseSearch();
  const [editing, setEditing] = useState<{ id?: number; value: ExerciseInput } | null>(null);

  async function remove(e: Exercise) {
    if (!window.confirm(`Remove “${e.name}” from the library?`)) return;
    try {
      const r = await api.del<{ archived?: boolean }>(`/exercises/${e.id}`);
      toast('success', r.archived ? 'Exercise retired. Existing plans and history keep it.' : 'Exercise deleted');
      state.reload();
    } catch (err) {
      toast('error', (err as ApiError).message);
    }
  }

  return (
    <>
      <PageHeader title="Exercise library" subtitle="Search, filter and read how to do each movement safely."
        actions={isAdmin && <button type="button" className="btn btn-primary" onClick={() => setEditing({ value: BLANK })}>+ New exercise</button>} />
      <ExerciseFilters {...filters} />
      <Async state={state}>
        {(list) => list.length === 0 ? <EmptyState title="No exercises match">Try a different search or clear the filters.</EmptyState> : (
          <>
            <p className="muted small" aria-live="polite">{list.length} exercise{list.length === 1 ? '' : 's'}</p>
            <ul className="card-grid">
              {list.map((e) => (
                <li key={e.id} className="card lib-card">
                  <h2 className="h3">{e.name}</h2>
                  <p className="tags"><Badge>{label(e.muscleGroup)}</Badge><Badge>{label(e.trainingType)}</Badge><Badge tone="info">{label(e.equipment)}</Badge></p>
                  <details>
                    <summary>How to do it</summary>
                    <p className="small">{e.instructions || 'No instructions yet.'}</p>
                  </details>
                  {isAdmin && (
                    <div className="row gap">
                      <button type="button" className="btn btn-small" onClick={() => setEditing({ id: e.id, value: { name: e.name, muscleGroup: e.muscleGroup, trainingType: e.trainingType, equipment: e.equipment, instructions: e.instructions } })}>Edit</button>
                      <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => remove(e)}>Remove</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Async>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit exercise' : 'New exercise'}>
        {editing && <ExerciseForm initial={editing.value} id={editing.id} onDone={() => { setEditing(null); state.reload(); }} />}
      </Modal>
    </>
  );
}

function ExerciseForm({ initial, id, onDone }: { initial: ExerciseInput; id?: number; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = exerciseSchema.safeParse(v);
    if (!parsed.success) { setErrors(formatZodError(parsed.error).fields); return; }
    setBusy(true);
    try {
      if (id) await api.put(`/exercises/${id}`, parsed.data);
      else await api.post('/exercises', parsed.data);
      toast('success', id ? 'Exercise updated' : 'Exercise added');
      onDone();
    } catch (err) {
      setError((err as ApiError).message);
      setErrors((err as ApiError).fields ?? {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {error && <ErrorBox error={error} />}
      <TextInput label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={errors.name} required />
      <div className="grid-3">
        <SelectInput label="Muscle group" options={MUSCLE_GROUPS} value={v.muscleGroup} onChange={(e) => setV({ ...v, muscleGroup: e.target.value as ExerciseInput['muscleGroup'] })} />
        <SelectInput label="Training type" options={TRAINING_TYPES} value={v.trainingType} onChange={(e) => setV({ ...v, trainingType: e.target.value as ExerciseInput['trainingType'] })} />
        <SelectInput label="Equipment" options={EQUIPMENT} value={v.equipment} onChange={(e) => setV({ ...v, equipment: e.target.value as ExerciseInput['equipment'] })} />
      </div>
      <div className="field">
        <label htmlFor="ex-instr">Instructions <span className="optional">(optional)</span></label>
        <textarea id="ex-instr" rows={4} maxLength={2000} value={v.instructions} onChange={(e) => setV({ ...v, instructions: e.target.value })} />
        <p className="hint">Include setup, movement and a safety cue.</p>
      </div>
      <div className="form-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save exercise'}</button></div>
    </form>
  );
}

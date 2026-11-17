import { useEffect, useState } from 'react';
import { qs } from '../api.ts';
import { useApi, useSession } from '../hooks.ts';
import { MUSCLE_GROUPS, TRAINING_TYPES, label } from '../../shared/constants.ts';
import type { Exercise, Food } from '../../shared/types.ts';
import { Async, Badge, EmptyState, MacroLine, Modal, SelectInput, TextInput } from './ui.tsx';
import { FoodFlags } from './FoodFlags.tsx';

/** Debounce a fast-changing value (search boxes). */
export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ExerciseFilters({ q, setQ, muscle, setMuscle, type, setType, mine, setMine }: {
  q: string; setQ: (v: string) => void; muscle: string; setMuscle: (v: string) => void; type: string; setType: (v: string) => void; mine: boolean; setMine: (v: boolean) => void;
}) {
  const { me } = useSession();
  const hasEquipment = (me?.profile?.equipment.length ?? 0) > 0;
  return (
    <div className="filters">
      <TextInput label="Search exercises" type="search" placeholder="e.g. squat, row, plank" value={q} onChange={(e) => setQ(e.target.value)} />
      <SelectInput label="Muscle group" options={MUSCLE_GROUPS} placeholder="All" value={muscle} onChange={(e) => setMuscle(e.target.value)} />
      <SelectInput label="Training type" options={TRAINING_TYPES} placeholder="All" value={type} onChange={(e) => setType(e.target.value)} />
      {hasEquipment && (
        <label className="check filter-check">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only my equipment
        </label>
      )}
    </div>
  );
}

export function useExerciseSearch() {
  const { me } = useSession();
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState('');
  const [type, setType] = useState('');
  const [mine, setMine] = useState(false);
  const dq = useDebounced(q);
  const equipment = mine ? me?.profile?.equipment.join(',') : undefined;
  const state = useApi<Exercise[]>(`/exercises${qs({ q: dq, muscleGroup: muscle, trainingType: type, equipment })}`);
  return { filters: { q, setQ, muscle, setMuscle, type, setType, mine, setMine }, state };
}

export function ExercisePicker({ open, onClose, onPick, title = 'Choose an exercise' }: { open: boolean; onClose: () => void; onPick: (e: Exercise) => void; title?: string }) {
  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      {open && <ExercisePickerBody onPick={onPick} />}
    </Modal>
  );
}

function ExercisePickerBody({ onPick }: { onPick: (e: Exercise) => void }) {
  const { filters, state } = useExerciseSearch();
  return (
    <>
      <ExerciseFilters {...filters} />
      <Async state={state}>
        {(list) => list.length === 0 ? <EmptyState title="No exercises match">Try a different search or clear the filters.</EmptyState> : (
          <ul className="pick-list">
            {list.map((e) => (
              <li key={e.id}>
                <div>
                  <strong>{e.name}</strong>
                  <p className="small muted">{label(e.muscleGroup)} · {label(e.trainingType)} · {label(e.equipment)}</p>
                </div>
                <button type="button" className="btn btn-small btn-primary" onClick={() => onPick(e)} aria-label={`Choose ${e.name}`}>Choose</button>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </>
  );
}

export function useFoodSearch() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const state = useApi<Food[]>(`/foods${qs({ q: dq })}`);
  return { q, setQ, state };
}

export function FoodSearchList({ onPick, actionLabel = 'Add' }: { onPick: (f: Food) => void; actionLabel?: string }) {
  const { q, setQ, state } = useFoodSearch();
  return (
    <>
      <TextInput label="Search foods" type="search" placeholder="e.g. oats, chicken, tofu" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <Async state={state}>
        {(list) => list.length === 0 ? <EmptyState title="No foods match">Try a simpler word, like “rice” or “egg”.</EmptyState> : (
          <ul className="pick-list">
            {list.map((f) => (
              <li key={f.id}>
                <div>
                  <strong>{f.name}</strong>{f.brand && <span className="muted"> · {f.brand}</span>}
                  <p className="small muted">Per {f.servingSize} {f.servingUnit}: <MacroLine m={f} approx={f.isApproximate} /></p>
                  <FoodFlags food={f} />
                </div>
                <button type="button" className="btn btn-small btn-primary" onClick={() => onPick(f)} aria-label={`${actionLabel} ${f.name}`}>{actionLabel}</button>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </>
  );
}

export { Badge };

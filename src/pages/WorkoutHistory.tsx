import { Link } from 'react-router-dom';
import { api, type ApiError } from '../api.ts';
import { useApi, useToast, useUnits } from '../hooks.ts';
import { formatDate } from '../../shared/dates.ts';
import type { WorkoutLog } from '../../shared/types.ts';
import { Async, Badge, Card, EmptyState, PageHeader } from '../components/ui.tsx';
import { fmtDuration } from './Workouts.tsx';

export function WorkoutHistoryPage() {
  const state = useApi<WorkoutLog[]>('/workout-logs?limit=100');
  const { fmtWeight } = useUnits();
  const toast = useToast();

  async function remove(log: WorkoutLog) {
    if (!window.confirm(`Delete “${log.title}” on ${formatDate(log.date)}?`)) return;
    try {
      await api.del(`/workout-logs/${log.id}`);
      toast('success', 'Workout deleted');
      state.reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    }
  }

  return (
    <>
      <PageHeader back={{ to: '/workouts', label: 'Workouts' }} title="Workout history" actions={<Link className="btn btn-primary" to="/workouts/log">Log a workout</Link>} />
      <Async state={state}>
        {(logs) => logs.length === 0 ? (
          <EmptyState title="No workouts logged yet" action={<Link className="btn btn-primary" to="/workouts">Go to your plan</Link>}>Finish a workout and it will show up here.</EmptyState>
        ) : (
          <div className="stack">
            {logs.map((l) => (
              <Card key={l.id} title={<>{l.title} <span className="muted small">{formatDate(l.date)}</span></>}
                actions={<div className="row gap"><Link className="btn btn-small" to={`/workouts/log/${l.id}`}>Edit</Link><button type="button" className="btn btn-small btn-danger-ghost" onClick={() => remove(l)}>Delete</button></div>}>
                <p className="small muted">{l.completedCount} of {l.entries.length} exercises completed{l.totalVolumeKg > 0 && ` · volume ${fmtWeight(l.totalVolumeKg)}`}</p>
                <ul className="plain-list">
                  {l.entries.map((e) => (
                    <li key={e.id} className="list-row">
                      <span>{e.completed ? '✓' : '○'} {e.exerciseName} {!e.completed && <Badge>Skipped</Badge>}</span>
                      <span className="small muted">
                        {e.sets.map((s) => [s.reps ? `${s.reps}` : null, s.weightKg ? `@${fmtWeight(s.weightKg)}` : null, s.durationSec ? fmtDuration(s.durationSec) : null].filter(Boolean).join(' ')).join(', ')}
                      </span>
                    </li>
                  ))}
                </ul>
                {l.notes && <p className="small">“{l.notes}”</p>}
              </Card>
            ))}
          </div>
        )}
      </Async>
    </>
  );
}

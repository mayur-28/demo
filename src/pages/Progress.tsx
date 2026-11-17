import { useState, type FormEvent } from 'react';
import { api, qs, type ApiError } from '../api.ts';
import { useApi, useToast, useUnits } from '../hooks.ts';
import { formatDate, localToday } from '../../shared/dates.ts';
import { percentOf } from '../../shared/nutrition.ts';
import { weightLogSchema } from '../../shared/schemas.ts';
import type { Progress } from '../../shared/types.ts';
import { Async, Card, EmptyState, PageHeader, TextInput, fmtNum } from '../components/ui.tsx';

export function ProgressPage() {
  const [span, setSpan] = useState(7);
  const state = useApi<Progress>(`/progress${qs({ end: localToday(), days: span })}`);
  return (
    <>
      <PageHeader title="Progress" subtitle="Simple numbers showing consistency and trends." actions={
        <div className="segmented" role="group" aria-label="Time range">
          {[7, 14, 30].map((d) => <button key={d} type="button" aria-pressed={span === d} onClick={() => setSpan(d)}>{d} days</button>)}
        </div>
      } />
      <Async state={state}>{(p) => <ProgressBody p={p} span={span} reload={state.reload} />}</Async>
    </>
  );
}

function ProgressBody({ p, span, reload }: { p: Progress; span: number; reload: () => void }) {
  const { fmtWeight, weightUnit, fromDisplayWeight } = useUnits();
  const toast = useToast();
  const [w, setW] = useState('');
  const [wErr, setWErr] = useState<string>();
  const logged = p.days.filter((d) => d.logged);
  const workouts = p.days.reduce((a, d) => a + d.workouts, 0);
  const avgCal = logged.length ? Math.round(logged.reduce((a, d) => a + d.calories, 0) / logged.length) : 0;
  const avgProtein = logged.length ? Math.round(logged.reduce((a, d) => a + d.protein, 0) / logged.length) : 0;
  const t = p.targets;
  const onTarget = t ? logged.filter((d) => Math.abs(d.calories - t.calories) <= t.calories * 0.1).length : 0;
  const weights = p.weights;
  const wChange = weights.length >= 2 ? Math.round((weights[weights.length - 1].weightKg - weights[0].weightKg) * 10) / 10 : null;

  async function addWeight(e: FormEvent) {
    e.preventDefault();
    const parsed = weightLogSchema.safeParse({ date: localToday(), weightKg: fromDisplayWeight(w.trim() === '' ? NaN : Number(w)) });
    if (!parsed.success) { setWErr(`Enter a weight between ${weightUnit === 'kg' ? '30 and 300 kg' : '66 and 661 lb'}`); return; }
    setWErr(undefined);
    try {
      await api.post('/weights', parsed.data);
      toast('success', "Today's weight saved");
      setW('');
      reload();
    } catch (err) {
      toast('error', (err as ApiError).message);
    }
  }

  return (
    <div className="stack">
      <Card title="This week">
        <dl className="stats">
          <div><dt>Workouts done</dt><dd>{p.week.completedWorkouts}<span className="muted"> / {p.week.plannedWorkouts || '—'} planned</span></dd></div>
          <div><dt>Food logged</dt><dd>{p.week.daysLogged}<span className="muted"> / 7 days</span></dd></div>
          <div><dt>Avg calories (completed days)</dt><dd>{p.week.avgDays ? `≈ ${fmtNum(p.week.avg.calories)}` : '—'}</dd></div>
          <div><dt>Avg P / C / F</dt><dd className="small-dd">{p.week.avgDays ? `${p.week.avg.protein} / ${p.week.avg.carbs} / ${p.week.avg.fat} g` : '—'}</dd></div>
        </dl>
        {p.week.plannedWorkouts > 0 && (
          <div className="bar bar-under" role="progressbar" aria-label="Weekly workout completion" aria-valuemin={0} aria-valuemax={p.week.plannedWorkouts} aria-valuenow={p.week.completedWorkouts}>
            <span style={{ width: `${Math.min(100, percentOf(p.week.completedWorkouts, p.week.plannedWorkouts))}%` }} />
          </div>
        )}
      </Card>

      <Card title={`Last ${span} days`}>
        <dl className="stats">
          <div><dt>Workouts</dt><dd>{workouts}</dd></div>
          <div><dt>Days logged</dt><dd>{logged.length}<span className="muted"> / {span}</span></dd></div>
          <div><dt>Avg calories</dt><dd>{logged.length ? `≈ ${fmtNum(avgCal)}` : '—'}</dd></div>
          <div><dt>Avg protein</dt><dd>{logged.length ? `${avgProtein} g` : '—'}</dd></div>
          {t && <div><dt>Days within ±10% of calorie goal</dt><dd>{onTarget}<span className="muted"> / {logged.length}</span></dd></div>}
        </dl>
        {logged.length === 0 ? <EmptyState title="No food logged in this period" /> : (
          <div className="table-wrap">
            <table className="data-table">
              <caption className="sr-only">Daily calories, protein and workouts</caption>
              <thead><tr><th scope="col">Day</th><th scope="col">kcal{t ? ` (goal ${fmtNum(t.calories)})` : ''}</th><th scope="col">Protein</th><th scope="col">Workout</th></tr></thead>
              <tbody>
                {[...p.days].reverse().map((d) => (
                  <tr key={d.date}>
                    <th scope="row">{formatDate(d.date)}</th>
                    <td>
                      {d.logged ? (
                        <span className="cell-bar">
                          <span>{fmtNum(d.calories)}</span>
                          {t && <span className="mini-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, percentOf(d.calories, t.calories))}%` }} /></span>}
                        </span>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>{d.logged ? `${fmtNum(d.protein)} g` : <span className="muted">—</span>}</td>
                    <td>{d.workouts ? '✓' : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Strength trends (last 90 days)">
        {p.exerciseTrends.length === 0 ? <EmptyState title="No weighted sets logged yet">Log weights in your workouts to see progress here.</EmptyState> : (
          <div className="table-wrap">
            <table className="data-table">
              <caption className="sr-only">Best weight per exercise, first versus latest session</caption>
              <thead><tr><th scope="col">Exercise</th><th scope="col">Sessions</th><th scope="col">First best</th><th scope="col">Latest best</th><th scope="col">Change</th></tr></thead>
              <tbody>
                {p.exerciseTrends.map((e) => {
                  const diff = Math.round((e.latestBestKg - e.firstBestKg) * 10) / 10;
                  return (
                    <tr key={e.exerciseId}>
                      <th scope="row">{e.name}</th>
                      <td>{e.sessions}</td>
                      <td>{fmtWeight(e.firstBestKg)}</td>
                      <td>{fmtWeight(e.latestBestKg)}</td>
                      <td className={diff > 0 ? 'pos' : ''}>{diff > 0 ? '+' : diff < 0 ? '−' : ''}{diff === 0 ? 'same' : fmtWeight(Math.abs(diff))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Body weight">
        <form className="inline-form" onSubmit={addWeight} noValidate>
          <TextInput label={`Today's weight (${weightUnit})`} type="number" inputMode="decimal" step="0.1" value={w} onChange={(e) => setW(e.target.value)} error={wErr} optional />
          <button className="btn">Save</button>
        </form>
        {weights.length === 0 ? <p className="muted">No weigh-ins yet.</p> : (
          <>
            <p>Latest: <strong>{fmtWeight(weights[weights.length - 1].weightKg)}</strong>
              {wChange !== null && <span className="muted"> ({wChange > 0 ? '+' : wChange < 0 ? '−' : '±'}{fmtWeight(Math.abs(wChange))} since {formatDate(weights[0].date)})</span>}</p>
            <ul className="weight-list">
              {[...weights].reverse().slice(0, 8).map((x) => <li key={x.date}><span>{formatDate(x.date)}</span><span>{fmtWeight(x.weightKg)}</span></li>)}
            </ul>
            <p className="small muted">Day-to-day weight naturally moves with water and food. Look at the trend over weeks; aim for gradual change.</p>
          </>
        )}
      </Card>
    </div>
  );
}

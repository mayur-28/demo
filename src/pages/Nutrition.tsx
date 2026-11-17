import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs, type ApiError } from '../api.ts';
import { useApi, useMe, useToast } from '../hooks.ts';
import { MEAL_TYPES, label, type MealType } from '../../shared/constants.ts';
import { addDays, formatDate, localToday } from '../../shared/dates.ts';
import { percentOf, sumMacros } from '../../shared/nutrition.ts';
import type { DaySummary, Food, FoodLogEntry } from '../../shared/types.ts';
import { Async, Card, EmptyState, HealthNotice, MacroLine, Modal, PageHeader, ProgressBar, fmtNum } from '../components/ui.tsx';
import { FoodSearchList } from '../components/Pickers.tsx';
import { ServingsForm } from '../components/ServingsForm.tsx';
import { FoodFlags } from '../components/FoodFlags.tsx';

type Dialog = { kind: 'add'; meal: MealType; food?: Food } | { kind: 'edit'; entry: FoodLogEntry } | null;

export function NutritionPage() {
  const [params, setParams] = useSearchParams();
  const today = localToday();
  const date = params.get('date') && /^\d{4}-\d{2}-\d{2}$/.test(params.get('date')!) ? params.get('date')! : today;
  const view = params.get('view') === 'week' ? 'week' : 'day';
  const setDate = (d: string) => setParams((p) => { p.set('date', d); return p; });
  const setView = (v: string) => setParams((p) => { p.set('view', v); return p; });

  return (
    <>
      <PageHeader title="Food log" subtitle="Calories and macros are calculated from each food's serving size." />
      <div className="row gap wrap toolbar">
        <div className="segmented" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'day'} onClick={() => setView('day')}>Day</button>
          <button type="button" aria-pressed={view === 'week'} onClick={() => setView('week')}>Week</button>
        </div>
        <div className="date-nav">
          <button type="button" className="btn btn-small" onClick={() => setDate(addDays(date, view === 'week' ? -7 : -1))} aria-label={view === 'week' ? 'Previous week' : 'Previous day'}>←</button>
          <label className="sr-only" htmlFor="log-date">Date</label>
          <input id="log-date" type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button type="button" className="btn btn-small" onClick={() => setDate(addDays(date, view === 'week' ? 7 : 1))} disabled={date >= today} aria-label={view === 'week' ? 'Next week' : 'Next day'}>→</button>
          {date !== today && <button type="button" className="btn btn-small btn-ghost" onClick={() => setDate(today)}>Today</button>}
        </div>
      </div>
      {view === 'day' ? <DayView date={date} /> : <WeekView end={date} onPick={(d) => setParams({ date: d, view: 'day' })} />}
      <HealthNotice compact />
    </>
  );
}

function DayView({ date }: { date: string }) {
  const me = useMe();
  const toast = useToast();
  const state = useApi<DaySummary>(`/food-logs${qs({ date })}`);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [meal, setMeal] = useState<MealType>('breakfast');
  const [busy, setBusy] = useState(false);
  const t = me.targets;

  async function add(food: Food, servings: number) {
    setBusy(true);
    try {
      await api.post('/food-logs', { date, mealType: meal, foodId: food.id, servings });
      toast('success', `Added ${food.name}`);
      setDialog(null);
      state.reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function edit(entry: FoodLogEntry, servings: number) {
    setBusy(true);
    try {
      await api.patch(`/food-logs/${entry.id}`, { servings, mealType: meal });
      toast('success', 'Entry updated');
      setDialog(null);
      state.reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: FoodLogEntry) {
    if (!window.confirm(`Remove ${entry.foodName}?`)) return;
    try {
      await api.del(`/food-logs/${entry.id}`);
      toast('success', 'Entry removed');
      state.reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    }
  }

  return (
    <Async state={state}>
      {(day) => (
        <div className="stack">
          <Card title={formatDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}>
            {t ? (
              <div className="progress-grid">
                <ProgressBar label="Calories" value={day.totals.calories} goal={t.calories} unit="kcal" approx={day.hasApproximate} />
                <ProgressBar label="Protein" value={day.totals.protein} goal={t.protein} unit="g" approx={day.hasApproximate} />
                <ProgressBar label="Carbs" value={day.totals.carbs} goal={t.carbs} unit="g" approx={day.hasApproximate} />
                <ProgressBar label="Fat" value={day.totals.fat} goal={t.fat} unit="g" approx={day.hasApproximate} />
              </div>
            ) : <MacroLine m={day.totals} />}
            {day.hasApproximate && <p className="muted small">≈ Values are typical estimates; actual products and portions vary.</p>}
          </Card>

          {MEAL_TYPES.map((m) => {
            const entries = day.entries.filter((e) => e.mealType === m);
            return (
              <Card key={m} title={<>{label(m)} {entries.length > 0 && <span className="muted small">≈ {fmtNum(day.byMeal[m].calories)} kcal</span>}</>}
                actions={<button type="button" className="btn btn-small" onClick={() => { setMeal(m); setDialog({ kind: 'add', meal: m }); }} aria-label={`Add food to ${label(m).toLowerCase()}`}>+ Add</button>}>
                {entries.length === 0 ? <p className="muted small">Nothing logged.</p> : (
                  <ul className="plain-list">
                    {entries.map((e) => (
                      <li key={e.id} className="log-row">
                        <div>
                          <strong>{e.foodName}</strong> <FoodFlags food={e} />
                          <p className="small muted">{fmtNum(e.servings)} × {e.servingSize} {e.servingUnit} = {fmtNum(Math.round(e.servings * e.servingSize * 10) / 10)} {e.servingUnit}</p>
                          <MacroLine m={e.nutrition} approx={e.isApproximate} />
                        </div>
                        <div className="row gap">
                          <button type="button" className="btn btn-small" onClick={() => { setMeal(e.mealType); setDialog({ kind: 'edit', entry: e }); }} aria-label={`Edit ${e.foodName}`}>Edit</button>
                          <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => remove(e)} aria-label={`Remove ${e.foodName}`}>Remove</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}

          <Modal open={dialog !== null} onClose={() => setDialog(null)} wide
            title={dialog?.kind === 'edit' ? `Edit ${dialog.entry.foodName}` : `Add to ${label(meal).toLowerCase()}`}>
            {dialog?.kind === 'add' && !dialog.food && <FoodSearchList onPick={(f) => setDialog({ ...dialog, food: f })} actionLabel="Select" />}
            {dialog?.kind === 'add' && dialog.food && (
              <ServingsForm food={dialog.food} mealType={meal} onMealType={setMeal} submitLabel="Add to log" busy={busy}
                onCancel={() => setDialog({ kind: 'add', meal })} onSubmit={(s) => add(dialog.food!, s)} />
            )}
            {dialog?.kind === 'edit' && (
              <ServingsForm
                food={{ ...dialog.entry.perServing, name: dialog.entry.foodName, servingSize: dialog.entry.servingSize, servingUnit: dialog.entry.servingUnit, allergens: dialog.entry.allergens, dietTags: dialog.entry.dietTags, isApproximate: dialog.entry.isApproximate }}
                initialServings={dialog.entry.servings} mealType={meal} onMealType={setMeal} submitLabel="Save changes" busy={busy}
                onSubmit={(s) => edit(dialog.entry, s)} />
            )}
          </Modal>
        </div>
      )}
    </Async>
  );
}

function WeekView({ end, onPick }: { end: string; onPick: (d: string) => void }) {
  const me = useMe();
  const start = addDays(end, -6);
  const state = useApi<DaySummary[]>(`/food-logs/range${qs({ start, end })}`);
  const t = me.targets;
  return (
    <Async state={state}>
      {(days) => {
        const logged = days.filter((d) => d.entries.length > 0);
        const total = sumMacros(logged.map((d) => d.totals));
        const n = logged.length || 1;
        return (
          <Card title={`${formatDate(start, { month: 'short', day: 'numeric' })} – ${formatDate(end, { month: 'short', day: 'numeric' })}`}>
            {logged.length === 0 ? <EmptyState title="No food logged this week" /> : (
              <>
                <dl className="stats">
                  <div><dt>Days logged</dt><dd>{logged.length}<span className="muted"> / 7</span></dd></div>
                  <div><dt>Avg calories</dt><dd>≈ {fmtNum(Math.round(total.calories / n))}</dd></div>
                  <div><dt>Avg protein</dt><dd>{fmtNum(Math.round(total.protein / n))} g</dd></div>
                  <div><dt>Avg carbs / fat</dt><dd>{fmtNum(Math.round(total.carbs / n))} / {fmtNum(Math.round(total.fat / n))} g</dd></div>
                </dl>
                <div className="table-wrap">
                  <table className="data-table">
                    <caption className="sr-only">Daily nutrition totals</caption>
                    <thead><tr><th scope="col">Day</th><th scope="col">kcal</th>{t && <th scope="col">% goal</th>}<th scope="col">Protein</th><th scope="col">Carbs</th><th scope="col">Fat</th></tr></thead>
                    <tbody>
                      {days.map((d) => (
                        <tr key={d.date}>
                          <th scope="row"><button type="button" className="linklike" onClick={() => onPick(d.date)}>{formatDate(d.date)}</button></th>
                          {d.entries.length === 0 ? <td colSpan={t ? 5 : 4} className="muted">Not logged</td> : (
                            <>
                              <td>{fmtNum(d.totals.calories)}</td>
                              {t && <td>{percentOf(d.totals.calories, t.calories)}%</td>}
                              <td>{fmtNum(d.totals.protein)} g</td>
                              <td>{fmtNum(d.totals.carbs)} g</td>
                              <td>{fmtNum(d.totals.fat)} g</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {t && <p className="small muted">Daily target ≈ {fmtNum(t.calories)} kcal · {t.protein} g protein · {t.carbs} g carbs · {t.fat} g fat. Averages count logged days only.</p>}
              </>
            )}
          </Card>
        );
      }}
    </Async>
  );
}

import { useState, type FormEvent } from 'react';
import { MEAL_TYPES, WEEKDAYS, label, type MealType } from '../../shared/constants.ts';
import { isValidServings, scaleNutrition, sumMacros } from '../../shared/nutrition.ts';
import { dietPlanSchema, formatZodError, type DietPlanInput } from '../../shared/schemas.ts';
import type { DietPlan, Food } from '../../shared/types.ts';
import { ErrorBox, MacroLine, Modal, TextInput } from './ui.tsx';
import { FoodSearchList } from './Pickers.tsx';
import { ServingsForm } from './ServingsForm.tsx';
import { FoodFlags } from './FoodFlags.tsx';
import { Field2 } from './WorkoutPlanEditor.tsx';

interface Item { key: number; dayIndex: number; mealType: MealType; food: Food; servings: string }
let seq = 0;

export function DayTabs({ day, setDay, label: aria = 'Day' }: { day: number; setDay: (d: number) => void; label?: string }) {
  return (
    <div className="day-tabs" role="tablist" aria-label={aria}>
      {WEEKDAYS.map((w, i) => (
        <button key={w} type="button" role="tab" aria-selected={day === i} className={day === i ? 'on' : ''} onClick={() => setDay(i)}>
          <span aria-hidden="true">{w.slice(0, 3)}</span><span className="sr-only">{w}</span>
        </button>
      ))}
    </div>
  );
}

export function DietPlanEditor({ plan, onSave, onCancel, initialDay = 0 }: {
  plan: Pick<DietPlan, 'name' | 'description' | 'items'>;
  onSave: (input: DietPlanInput) => Promise<void>;
  onCancel?: () => void;
  initialDay?: number;
}) {
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description);
  const [items, setItems] = useState<Item[]>(() => plan.items.map((i) => ({ key: ++seq, dayIndex: i.dayIndex, mealType: i.mealType, food: i.food, servings: String(i.servings) })));
  const [day, setDay] = useState(initialDay);
  const [adding, setAdding] = useState<{ meal: MealType; food?: Food; replaceKey?: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dayItems = items.filter((i) => i.dayIndex === day);
  const nutritionOf = (i: Item) => (isValidServings(Number(i.servings)) ? scaleNutrition(i.food, Number(i.servings)) : null);
  const dayTotal = sumMacros(dayItems.map(nutritionOf).filter((m): m is NonNullable<typeof m> => m !== null));

  function copyDayToAll() {
    if (!window.confirm(`Replace every other day with ${WEEKDAYS[day]}'s meals?`)) return;
    const src = items.filter((i) => i.dayIndex === day);
    const next: Item[] = [];
    for (let d = 0; d < 7; d++) next.push(...src.map((i) => ({ ...i, key: ++seq, dayIndex: d })));
    setItems(next);
  }

  function toInput(): DietPlanInput {
    return { name, description, items: items.map((i) => ({ dayIndex: i.dayIndex, mealType: i.mealType, foodId: i.food.id, servings: Number(i.servings) })) };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const bad = items.find((i) => !isValidServings(Number(i.servings)) || i.servings.trim() === '');
    if (bad) {
      setDay(bad.dayIndex);
      setFormError(`${bad.food.name} on ${WEEKDAYS[bad.dayIndex]} needs a serving amount greater than 0.`);
      return;
    }
    const parsed = dietPlanSchema.safeParse(toInput());
    if (!parsed.success) {
      const f = formatZodError(parsed.error);
      setErrors(f.fields);
      setFormError(f.message);
      return;
    }
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
        <TextInput label="Plan name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
        <Field2 label="Description" optional value={description} onChange={setDescription} />
      </div>
      <DayTabs day={day} setDay={setDay} />
      <div className="card">
        <div className="card-head">
          <h2>{WEEKDAYS[day]}</h2>
          <button type="button" className="btn btn-small btn-ghost" onClick={copyDayToAll} disabled={!dayItems.length}>Copy to all days</button>
        </div>
        <p className="small">Day total: <MacroLine m={dayTotal} approx /></p>
        {MEAL_TYPES.map((m) => {
          const list = dayItems.filter((i) => i.mealType === m);
          return (
            <section key={m} className="meal-editor">
              <div className="card-head">
                <h3>{label(m)}</h3>
                <button type="button" className="btn btn-small" onClick={() => setAdding({ meal: m })} aria-label={`Add food to ${WEEKDAYS[day]} ${label(m).toLowerCase()}`}>+ Add food</button>
              </div>
              {list.length === 0 ? <p className="muted small">No foods.</p> : (
                <ul className="plain-list">
                  {list.map((i) => {
                    const n = nutritionOf(i);
                    return (
                      <li key={i.key} className="edit-food-row">
                        <div className="grow">
                          <strong>{i.food.name}</strong> <FoodFlags food={i.food} />
                          {i.food.archived && <span className="badge badge-warn">Retired from library</span>}
                          <p className="small muted">{n ? <MacroLine m={n} approx={i.food.isApproximate} /> : 'Enter servings'}</p>
                        </div>
                        <div className="servings-input">
                          <label className="sr-only" htmlFor={`sv-${i.key}`}>Servings of {i.food.name}</label>
                          <input id={`sv-${i.key}`} type="number" inputMode="decimal" min={0.05} step="0.25" value={i.servings}
                            aria-invalid={!isValidServings(Number(i.servings)) || undefined}
                            onChange={(e) => setItems((xs) => xs.map((x) => (x.key === i.key ? { ...x, servings: e.target.value } : x)))} />
                          <span className="small muted">× {i.food.servingSize}{i.food.servingUnit}</span>
                        </div>
                        <div className="row gap">
                          <button type="button" className="btn btn-small" onClick={() => setAdding({ meal: m, replaceKey: i.key })} aria-label={`Replace ${i.food.name}`}>Swap</button>
                          <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => setItems((xs) => xs.filter((x) => x.key !== i.key))} aria-label={`Remove ${i.food.name}`}>Remove</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <div className="form-actions sticky-actions">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save plan'}</button>
      </div>

      <Modal open={!!adding} onClose={() => setAdding(null)} wide title={adding?.replaceKey ? 'Swap food' : `Add to ${WEEKDAYS[day]} ${adding ? label(adding.meal).toLowerCase() : ''}`}>
        {adding && !adding.food && <FoodSearchList onPick={(f) => setAdding({ ...adding, food: f })} actionLabel="Select" />}
        {adding?.food && (
          <ServingsForm food={adding.food} submitLabel={adding.replaceKey ? 'Swap' : 'Add'} onCancel={() => setAdding({ meal: adding.meal, replaceKey: adding.replaceKey })}
            initialServings={adding.replaceKey ? Number(items.find((x) => x.key === adding.replaceKey)?.servings) || 1 : 1}
            onSubmit={(servings) => {
              const food = adding.food!;
              if (adding.replaceKey) setItems((xs) => xs.map((x) => (x.key === adding.replaceKey ? { ...x, food, servings: String(servings) } : x)));
              else setItems((xs) => [...xs, { key: ++seq, dayIndex: day, mealType: adding.meal, food, servings: String(servings) }]);
              setAdding(null);
            }} />
        )}
      </Modal>
    </form>
  );
}

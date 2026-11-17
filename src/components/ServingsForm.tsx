import { useState, type FormEvent } from 'react';
import { MAX_SERVINGS, MEAL_TYPES, type MealType } from '../../shared/constants.ts';
import { isValidServings, scaleNutrition } from '../../shared/nutrition.ts';
import type { Food } from '../../shared/types.ts';
import { MacroLine, SelectInput, TextInput } from './ui.tsx';
import { FoodFlags } from './FoodFlags.tsx';

type FoodLike = Pick<Food, 'name' | 'servingSize' | 'servingUnit' | 'calories' | 'protein' | 'carbs' | 'fat' | 'allergens' | 'dietTags' | 'isApproximate'>;

/**
 * Choose how much of a food: by servings or by amount (g/ml etc.). Shows the
 * calculated nutrition live, using the same function the server uses.
 */
export function ServingsForm({ food, initialServings = 1, mealType, onMealType, submitLabel, onSubmit, onCancel, busy }: {
  food: FoodLike;
  initialServings?: number;
  mealType?: MealType;
  onMealType?: (m: MealType) => void;
  submitLabel: string;
  onSubmit: (servings: number) => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  const [mode, setMode] = useState<'servings' | 'amount'>('servings');
  const [value, setValue] = useState(String(initialServings));
  const [touched, setTouched] = useState(false);
  const raw = Number(value);
  const servings = value.trim() === '' ? NaN : mode === 'servings' ? raw : raw / food.servingSize;
  const valid = isValidServings(servings) && servings >= 0.05;
  const preview = valid ? scaleNutrition(food, servings) : null;
  const unitLabel = food.servingUnit;
  const error = !valid && (touched || value !== '')
    ? `Enter an amount greater than 0 and at most ${mode === 'servings' ? MAX_SERVINGS + ' servings' : `${MAX_SERVINGS * food.servingSize} ${unitLabel}`}.`
    : undefined;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (valid) onSubmit(Math.round(servings * 1000) / 1000);
  }

  function switchMode(next: 'servings' | 'amount') {
    if (next === mode) return;
    if (valid) setValue(String(next === 'amount' ? Math.round(servings * food.servingSize * 10) / 10 : Math.round(servings * 100) / 100));
    setMode(next);
  }

  return (
    <form onSubmit={submit} noValidate className="servings-form">
      <p><strong>{food.name}</strong> <FoodFlags food={food} showApprox /></p>
      <p className="small muted">1 serving = {food.servingSize} {unitLabel}</p>
      {mealType && onMealType && (
        <SelectInput label="Meal" options={MEAL_TYPES} value={mealType} onChange={(e) => onMealType(e.target.value as MealType)} />
      )}
      <div className="segmented" role="group" aria-label="Enter quantity as">
        <button type="button" aria-pressed={mode === 'servings'} onClick={() => switchMode('servings')}>Servings</button>
        <button type="button" aria-pressed={mode === 'amount'} onClick={() => switchMode('amount')}>Amount ({unitLabel})</button>
      </div>
      <TextInput label={mode === 'servings' ? 'Number of servings' : `Amount in ${unitLabel}`} type="number" inputMode="decimal" min={0} step="any"
        value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => setTouched(true)} error={error} autoFocus />
      {mode === 'servings' && (
        <div className="row gap quick">
          {[0.5, 1, 1.5, 2].map((q) => <button key={q} type="button" className="btn btn-small" onClick={() => setValue(String(q))}>{q}</button>)}
        </div>
      )}
      <div className="preview" aria-live="polite">
        {preview ? <>Total: <MacroLine m={preview} approx={food.isApproximate} /></> : <span className="muted">Enter a quantity to see nutrition.</span>}
      </div>
      <div className="form-actions">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Back</button>}
        <button className="btn btn-primary" disabled={busy || !valid}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  );
}

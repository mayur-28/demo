import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api.ts';
import { useSession, useToast } from '../hooks.ts';
import {
  ACTIVITY_LEVELS, ALLERGENS, DIET_PREFERENCES, EQUIPMENT, FITNESS_GOALS, MIN_CALORIE_GOAL, SEX_OPTIONS, label,
  type ActivityLevel, type Allergen, type DietPreference, type Equipment, type FitnessGoal, type Sex, type UnitSystem,
} from '../../shared/constants.ts';
import { calorieFloor, cmToIn, estimateTargets, inToCm, kgToLb, lbToKg } from '../../shared/goals.ts';
import { formatZodError, profileSchema } from '../../shared/schemas.ts';
import type { Me, Profile } from '../../shared/types.ts';
import { CheckboxChips, ErrorBox, HealthNotice, PageHeader, RadioCards, SelectInput, TextInput, Card } from '../components/ui.tsx';

const ACTIVITY_DESC: Record<ActivityLevel, string> = {
  sedentary: 'Mostly sitting, little exercise',
  light: 'Light exercise 1–3 days/week',
  moderate: 'Exercise 3–5 days/week',
  active: 'Hard exercise 6–7 days/week',
  very_active: 'Physical job plus training',
};
const GOAL_DESC: Record<FitnessGoal, string> = {
  lose_weight: 'Gentle calorie deficit',
  maintain: 'Keep weight steady',
  gain_muscle: 'Small surplus + strength focus',
  improve_endurance: 'Build stamina',
  general_fitness: 'Feel better, move more',
};

interface FormState {
  name: string; age: string; units: UnitSystem; heightCm: string; heightFt: string; heightIn: string; weight: string; sex: Sex;
  activityLevel: ActivityLevel | ''; goal: FitnessGoal | ''; dietaryPreference: DietPreference; allergies: Allergen[]; otherAllergies: string;
  equipment: Equipment[]; useCustom: boolean; cCal: string; cP: string; cC: string; cF: string;
}

function toForm(p: Profile | null, name: string): FormState {
  const units = p?.units ?? 'metric';
  const inches = p ? cmToIn(p.heightCm) : 0;
  return {
    name: p?.name ?? name, age: p ? String(p.age) : '', units,
    heightCm: p ? String(p.heightCm) : '', heightFt: p ? String(Math.floor(inches / 12)) : '', heightIn: p ? String(Math.round(inches % 12)) : '',
    weight: p ? String(units === 'imperial' ? kgToLb(p.weightKg) : p.weightKg) : '', sex: p?.sex ?? 'unspecified',
    activityLevel: p?.activityLevel ?? '', goal: p?.goal ?? '', dietaryPreference: p?.dietaryPreference ?? 'none',
    allergies: p?.allergies ?? [], otherAllergies: p?.otherAllergies ?? '', equipment: p?.equipment ?? [],
    useCustom: !!p?.customTargets, cCal: String(p?.customTargets?.calories ?? ''), cP: String(p?.customTargets?.protein ?? ''),
    cC: String(p?.customTargets?.carbs ?? ''), cF: String(p?.customTargets?.fat ?? ''),
  };
}

const n = (s: string) => (s.trim() === '' ? NaN : Number(s));

function toPayload(f: FormState) {
  const heightCm = f.units === 'metric' ? n(f.heightCm) : inToCm(n(f.heightFt) * 12 + (n(f.heightIn) || 0));
  const weightKg = f.units === 'metric' ? n(f.weight) : lbToKg(n(f.weight));
  return {
    name: f.name, age: n(f.age), heightCm, weightKg, sex: f.sex, units: f.units,
    activityLevel: f.activityLevel || undefined, goal: f.goal || undefined, dietaryPreference: f.dietaryPreference,
    allergies: f.allergies, otherAllergies: f.otherAllergies, equipment: f.equipment,
    customTargets: f.useCustom ? { calories: n(f.cCal), protein: n(f.cP), carbs: n(f.cC), fat: n(f.cF) } : null,
  };
}

const STEP_FIELDS = [
  ['name', 'age', 'heightCm', 'weightKg', 'sex', 'units'],
  ['activityLevel', 'goal'],
  ['dietaryPreference', 'allergies', 'otherAllergies'],
  ['equipment', 'customTargets'],
];
const STEP_TITLES = ['About you', 'Activity & goal', 'Diet & allergies', 'Equipment & targets'];

function useProfileForm(initial: FormState) {
  const [f, setF] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  /** Validate (optionally only some fields). Returns the parsed payload when everything is valid. */
  function check(fields?: string[]) {
    const r = profileSchema.safeParse(toPayload(f));
    if (r.success) { setErrors({}); return r.data; }
    const { fields: all } = formatZodError(r.error);
    const relevant = fields ? Object.fromEntries(Object.entries(all).filter(([k]) => fields.some((x) => k === x || k.startsWith(`${x}.`)))) : all;
    setErrors(relevant);
    return Object.keys(relevant).length ? null : undefined;
  }
  return { f, set, errors, setErrors, check };
}

function AboutFields({ f, set, errors }: ReturnType<typeof useProfileForm>) {
  return (
    <>
      <TextInput label="Name" autoComplete="name" value={f.name} onChange={(e) => set('name', e.target.value)} error={errors.name} required />
      <div className="grid-2">
        <TextInput label="Age" type="number" inputMode="numeric" min={16} max={100} value={f.age} onChange={(e) => set('age', e.target.value)} error={errors.age} hint="16 or older" required />
        <SelectInput label="Units" options={['metric', 'imperial']} labelFor={(v) => (v === 'metric' ? 'Metric (kg, cm)' : 'Imperial (lb, ft/in)')} value={f.units}
          onChange={(e) => {
            const next = e.target.value as UnitSystem;
            // Convert what's already typed so switching units never loses data.
            if (next !== f.units) {
              const p = toPayload(f);
              set('units', next);
              if (Number.isFinite(p.weightKg)) set('weight', String(next === 'imperial' ? kgToLb(p.weightKg) : p.weightKg));
              if (Number.isFinite(p.heightCm)) {
                const inch = cmToIn(p.heightCm);
                set('heightCm', String(Math.round(p.heightCm)));
                set('heightFt', String(Math.floor(inch / 12)));
                set('heightIn', String(Math.round(inch % 12)));
              }
            }
          }} />
      </div>
      {f.units === 'metric' ? (
        <div className="grid-2">
          <TextInput label="Height (cm)" type="number" inputMode="decimal" value={f.heightCm} onChange={(e) => set('heightCm', e.target.value)} error={errors.heightCm} required />
          <TextInput label="Weight (kg)" type="number" inputMode="decimal" step="0.1" value={f.weight} onChange={(e) => set('weight', e.target.value)} error={errors.weightKg} required />
        </div>
      ) : (
        <div className="grid-3">
          <TextInput label="Height (ft)" type="number" inputMode="numeric" value={f.heightFt} onChange={(e) => set('heightFt', e.target.value)} error={errors.heightCm} required />
          <TextInput label="(in)" type="number" inputMode="numeric" min={0} max={11} value={f.heightIn} onChange={(e) => set('heightIn', e.target.value)} />
          <TextInput label="Weight (lb)" type="number" inputMode="decimal" step="0.1" value={f.weight} onChange={(e) => set('weight', e.target.value)} error={errors.weightKg} required />
        </div>
      )}
      <SelectInput label="Sex used for calorie estimate" optional options={SEX_OPTIONS} labelFor={(v) => (v === 'unspecified' ? 'Prefer not to say' : label(v))}
        value={f.sex} onChange={(e) => set('sex', e.target.value as Sex)} hint="Only used to estimate energy needs. 'Prefer not to say' uses an average." />
    </>
  );
}

function GoalFields({ f, set, errors }: ReturnType<typeof useProfileForm>) {
  return (
    <>
      <RadioCards legend="Activity level" name="activity" options={ACTIVITY_LEVELS} value={f.activityLevel} onChange={(v) => set('activityLevel', v)} describe={(v) => ACTIVITY_DESC[v]} error={errors.activityLevel} />
      <RadioCards legend="Main goal" name="goal" options={FITNESS_GOALS} value={f.goal} onChange={(v) => set('goal', v)} describe={(v) => GOAL_DESC[v]} error={errors.goal} />
    </>
  );
}

function DietFields({ f, set, errors }: ReturnType<typeof useProfileForm>) {
  return (
    <>
      <SelectInput label="Dietary preference" optional options={DIET_PREFERENCES} value={f.dietaryPreference} onChange={(e) => set('dietaryPreference', e.target.value as DietPreference)}
        hint="Foods that don't fit are flagged in the library, plans and your log." />
      <CheckboxChips legend="Allergies & intolerances" optional options={ALLERGENS} value={f.allergies} onChange={(v) => set('allergies', v)} hint="Foods containing these are clearly flagged. Always check product labels too." />
      <TextInput label="Other allergies or restrictions" optional value={f.otherAllergies} onChange={(e) => set('otherAllergies', e.target.value)} error={errors.otherAllergies} hint="Shown on your profile as a reminder (not auto-flagged)." />
    </>
  );
}

function TargetFields({ f, set, errors }: ReturnType<typeof useProfileForm>) {
  const p = toPayload(f);
  const est = useMemo(() => {
    if (![p.age, p.heightCm, p.weightKg].every(Number.isFinite) || !f.activityLevel || !f.goal) return null;
    return estimateTargets({ age: p.age, heightCm: p.heightCm, weightKg: p.weightKg, sex: f.sex, activityLevel: f.activityLevel, goal: f.goal });
  }, [p.age, p.heightCm, p.weightKg, f.sex, f.activityLevel, f.goal]);
  const floor = calorieFloor(f.sex);
  const lowCustom = f.useCustom && Number.isFinite(n(f.cCal)) && n(f.cCal) < floor && n(f.cCal) >= MIN_CALORIE_GOAL;
  return (
    <>
      <CheckboxChips legend="Equipment you can use" optional options={EQUIPMENT} value={f.equipment} onChange={(v) => set('equipment', v)} hint="Used to filter the exercise library and suggest swaps." />
      <fieldset className="targets">
        <legend>Daily nutrition targets</legend>
        {est ? (
          <p className="estimate">
            Suggested: <strong>≈ {est.calories.toLocaleString()} kcal</strong>, {est.protein} g protein, {est.carbs} g carbs, {est.fat} g fat.
            <span className="muted small"> Estimated with the Mifflin-St Jeor equation; real needs vary by person.</span>
          </p>
        ) : <p className="muted">Fill in your details and goal to see a suggested target.</p>}
        <label className="check">
          <input type="checkbox" checked={f.useCustom} onChange={(e) => {
            set('useCustom', e.target.checked);
            if (e.target.checked && est && !f.cCal) { set('cCal', String(est.calories)); set('cP', String(est.protein)); set('cC', String(est.carbs)); set('cF', String(est.fat)); }
          }} />
          Set my own targets (e.g. from my coach or dietitian)
        </label>
        {f.useCustom && (
          <div className="grid-4">
            <TextInput label="Calories" type="number" inputMode="numeric" min={MIN_CALORIE_GOAL} value={f.cCal} onChange={(e) => set('cCal', e.target.value)} error={errors['customTargets.calories']} />
            <TextInput label="Protein (g)" type="number" inputMode="numeric" value={f.cP} onChange={(e) => set('cP', e.target.value)} error={errors['customTargets.protein']} />
            <TextInput label="Carbs (g)" type="number" inputMode="numeric" value={f.cC} onChange={(e) => set('cC', e.target.value)} error={errors['customTargets.carbs']} />
            <TextInput label="Fat (g)" type="number" inputMode="numeric" value={f.cF} onChange={(e) => set('cF', e.target.value)} error={errors['customTargets.fat']} />
          </div>
        )}
        {lowCustom && <p className="alert alert-warn">This is below the {floor.toLocaleString()} kcal level we normally suggest. Very low intakes should be supervised by a health professional.</p>}
        <p className="hint">We never suggest fewer than {MIN_CALORIE_GOAL.toLocaleString()} kcal per day.</p>
      </fieldset>
    </>
  );
}

export function OnboardingPage() {
  const { me, setMe } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const form = useProfileForm(toForm(me?.profile ?? null, me?.user.name ?? ''));
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const last = step === STEP_TITLES.length - 1;

  async function next(e: FormEvent) {
    e.preventDefault();
    if (!last) {
      if (form.check(STEP_FIELDS[step]) !== null) setStep(step + 1);
      return;
    }
    const payload = form.check();
    if (!payload) return;
    setBusy(true);
    try {
      setMe(await api.put<Me>('/me/profile', payload));
      toast('success', 'Profile saved. Your targets are ready.');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err as ApiError);
      form.setErrors((err as ApiError).fields);
    } finally {
      setBusy(false);
    }
  }

  const Step = [AboutFields, GoalFields, DietFields, TargetFields][step];
  return (
    <main className="onboarding" id="main">
      <p className="brand"><span className="brand-mark" aria-hidden="true">F</span> FuelForm</p>
      <h1>Set up your profile</h1>
      <ol className="steps" aria-label="Progress">
        {STEP_TITLES.map((t, i) => <li key={t} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>{t}</li>)}
      </ol>
      <form className="card" onSubmit={next} noValidate>
        <h2>{STEP_TITLES[step]} <span className="muted small">Step {step + 1} of {STEP_TITLES.length}</span></h2>
        {error && <ErrorBox error={error} />}
        <Step {...form} />
        <div className="form-actions">
          {step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Back</button>}
          <button className="btn btn-primary" disabled={busy}>{last ? (busy ? 'Saving…' : 'Finish') : 'Continue'}</button>
        </div>
      </form>
      <HealthNotice />
    </main>
  );
}

export function ProfilePage() {
  const { me, setMe } = useSession();
  const toast = useToast();
  const form = useProfileForm(toForm(me?.profile ?? null, me?.user.name ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = form.check();
    if (!payload) {
      toast('error', 'Please fix the highlighted fields.');
      return;
    }
    setBusy(true);
    try {
      setMe(await api.put<Me>('/me/profile', payload));
      toast('success', 'Profile updated');
    } catch (err) {
      setError(err as ApiError);
      form.setErrors((err as ApiError).fields);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Profile & goals" subtitle={me?.user.email} />
      {me?.targets && (
        <Card title="Current daily targets">
          <p>≈ <strong>{me.targets.calories.toLocaleString()} kcal</strong> · {me.targets.protein} g protein · {me.targets.carbs} g carbs · {me.targets.fat} g fat
            <span className="muted"> ({me.targets.isCustom ? 'your own targets' : 'estimated'}; estimated maintenance ≈ {me.targets.maintenance.toLocaleString()} kcal)</span></p>
        </Card>
      )}
      <form onSubmit={save} noValidate className="stack">
        {error && <ErrorBox error={error} />}
        <Card title="About you"><AboutFields {...form} /></Card>
        <Card title="Activity & goal"><GoalFields {...form} /></Card>
        <Card title="Diet & allergies"><DietFields {...form} /></Card>
        <Card title="Equipment & targets"><TargetFields {...form} /></Card>
        <div className="form-actions sticky-actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
      <HealthNotice />
    </>
  );
}

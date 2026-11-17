import { useState, type FormEvent } from 'react';
import { api, type ApiError } from '../api.ts';
import { useSession, useToast } from '../hooks.ts';
import { ALLERGENS, DIET_TAGS, SERVING_UNITS, type Allergen, type DietTag, type ServingUnit } from '../../shared/constants.ts';
import { atwaterCalories } from '../../shared/nutrition.ts';
import { foodSchema, formatZodError } from '../../shared/schemas.ts';
import type { Food } from '../../shared/types.ts';
import { Async, CheckboxChips, EmptyState, ErrorBox, MacroLine, Modal, PageHeader, SelectInput, TextInput } from '../components/ui.tsx';
import { useFoodSearch } from '../components/Pickers.tsx';
import { FoodFlags } from '../components/FoodFlags.tsx';

interface FoodForm {
  name: string; brand: string; servingSize: string; servingUnit: ServingUnit; calories: string; protein: string; carbs: string; fat: string;
  allergens: Allergen[]; dietTags: DietTag[]; isApproximate: boolean;
}
const BLANK: FoodForm = { name: '', brand: '', servingSize: '100', servingUnit: 'g', calories: '', protein: '', carbs: '', fat: '', allergens: [], dietTags: [], isApproximate: true };
const toForm = (f: Food): FoodForm => ({ ...f, servingSize: String(f.servingSize), calories: String(f.calories), protein: String(f.protein), carbs: String(f.carbs), fat: String(f.fat) });
const n = (s: string) => (s.trim() === '' ? NaN : Number(s));

export function FoodsPage() {
  const { me } = useSession();
  const isAdmin = me?.user.role === 'admin';
  const toast = useToast();
  const { q, setQ, state } = useFoodSearch();
  const [editing, setEditing] = useState<{ id?: number; value: FoodForm } | null>(null);

  async function remove(f: Food) {
    if (!window.confirm(`Remove “${f.name}” from the library?`)) return;
    try {
      const r = await api.del<{ archived?: boolean }>(`/foods/${f.id}`);
      toast('success', r.archived ? 'Food retired. Existing plans and logs keep their values.' : 'Food deleted');
      state.reload();
    } catch (err) {
      toast('error', (err as ApiError).message);
    }
  }

  return (
    <>
      <PageHeader title="Food library" subtitle="Nutrition is per serving. Values marked ≈ are typical estimates — packaged products vary, so check labels."
        actions={isAdmin && <button type="button" className="btn btn-primary" onClick={() => setEditing({ value: BLANK })}>+ New food</button>} />
      <div className="filters"><TextInput label="Search foods" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. yogurt" /></div>
      <Async state={state}>
        {(list) => list.length === 0 ? <EmptyState title="No foods match">Try a simpler search word.</EmptyState> : (
          <div className="table-wrap">
            <table className="data-table foods-table">
              <caption className="sr-only">Foods and nutrition per serving</caption>
              <thead><tr><th scope="col">Food</th><th scope="col">Serving</th><th scope="col">Nutrition per serving</th>{isAdmin && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
              <tbody>
                {list.map((f) => (
                  <tr key={f.id}>
                    <th scope="row">{f.name}{f.brand && <span className="muted"> · {f.brand}</span>}<br /><FoodFlags food={f} /></th>
                    <td>{f.servingSize} {f.servingUnit}</td>
                    <td><MacroLine m={f} approx={f.isApproximate} /></td>
                    {isAdmin && (
                      <td className="nowrap">
                        <button type="button" className="btn btn-small" onClick={() => setEditing({ id: f.id, value: toForm(f) })} aria-label={`Edit ${f.name}`}>Edit</button>{' '}
                        <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => remove(f)} aria-label={`Remove ${f.name}`}>Remove</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit food' : 'New food'} wide>
        {editing && <FoodEditor initial={editing.value} id={editing.id} onDone={() => { setEditing(null); state.reload(); }} />}
      </Modal>
    </>
  );
}

function FoodEditor({ initial, id, onDone }: { initial: FoodForm; id?: number; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FoodForm>(k: K, val: FoodForm[K]) => setV((s) => ({ ...s, [k]: val }));
  const implied = [v.protein, v.carbs, v.fat].every((x) => Number.isFinite(n(x))) ? Math.round(atwaterCalories({ protein: n(v.protein), carbs: n(v.carbs), fat: n(v.fat) })) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = { ...v, servingSize: n(v.servingSize), calories: n(v.calories), protein: n(v.protein), carbs: n(v.carbs), fat: n(v.fat) };
    const parsed = foodSchema.safeParse(payload);
    if (!parsed.success) {
      const f = formatZodError(parsed.error);
      setErrors(f.fields);
      setError(f.message);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (id) await api.put(`/foods/${id}`, parsed.data);
      else await api.post('/foods', parsed.data);
      toast('success', id ? 'Food updated. Past food logs keep the values they were logged with.' : 'Food added');
      onDone();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {error && <ErrorBox error={error} />}
      <div className="grid-2">
        <TextInput label="Name" value={v.name} onChange={(e) => set('name', e.target.value)} error={errors.name} required />
        <TextInput label="Brand" optional value={v.brand} onChange={(e) => set('brand', e.target.value)} />
      </div>
      <div className="grid-2">
        <TextInput label="Serving size" type="number" inputMode="decimal" min={0.1} value={v.servingSize} onChange={(e) => set('servingSize', e.target.value)} error={errors.servingSize} />
        <SelectInput label="Unit" options={SERVING_UNITS} value={v.servingUnit} onChange={(e) => set('servingUnit', e.target.value as ServingUnit)} />
      </div>
      <div className="grid-4">
        <TextInput label="Calories" type="number" inputMode="decimal" min={0} value={v.calories} onChange={(e) => set('calories', e.target.value)} error={errors.calories} />
        <TextInput label="Protein (g)" type="number" inputMode="decimal" min={0} value={v.protein} onChange={(e) => set('protein', e.target.value)} error={errors.protein} />
        <TextInput label="Carbs (g)" type="number" inputMode="decimal" min={0} value={v.carbs} onChange={(e) => set('carbs', e.target.value)} error={errors.carbs} />
        <TextInput label="Fat (g)" type="number" inputMode="decimal" min={0} value={v.fat} onChange={(e) => set('fat', e.target.value)} error={errors.fat} />
      </div>
      {implied !== null && <p className="hint">Macros imply about {implied} kcal (4/4/9 kcal per gram). Calories far from this are rejected as likely typos.</p>}
      <CheckboxChips legend="Contains allergens" options={ALLERGENS} value={v.allergens} onChange={(x) => set('allergens', x)} optional />
      <CheckboxChips legend="Suitable for" options={DIET_TAGS} value={v.dietTags} onChange={(x) => set('dietTags', x)} optional hint="Vegan foods should also be marked vegetarian and pescatarian." />
      <label className="check"><input type="checkbox" checked={v.isApproximate} onChange={(e) => set('isApproximate', e.target.checked)} /> Values are approximate (typical/generic values, not from a specific label)</label>
      <div className="form-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save food'}</button></div>
    </form>
  );
}

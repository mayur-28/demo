import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type ApiError } from '../api.ts';
import { useApi, useToast } from '../hooks.ts';
import type { AdminUserRow, DietPlan, DietPlanSummary, WorkoutPlan, WorkoutPlanSummary } from '../../shared/types.ts';
import type { DietPlanInput, WorkoutPlanInput } from '../../shared/schemas.ts';
import { Async, Badge, Card, EmptyState, Modal, PageHeader, fmtNum } from '../components/ui.tsx';
import { WorkoutPlanEditor } from '../components/WorkoutPlanEditor.tsx';
import { DietPlanEditor } from '../components/DietPlanEditor.tsx';

type Family = 'workout' | 'diet';
const PATH: Record<Family, string> = { workout: '/workout-templates', diet: '/diet-templates' };
const UI: Record<Family, string> = { workout: '/coach/workouts', diet: '/coach/meals' };

export function CoachPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'workout' | 'diet' | 'users') ?? 'workout';
  return (
    <>
      <PageHeader title="Coach tools" subtitle="Templates are shared. Assigning one gives each person their own private copy to customise." />
      <div className="segmented tabs" role="group" aria-label="Section">
        {(['workout', 'diet', 'users'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setParams({ tab: t })}>
            {t === 'workout' ? 'Workout templates' : t === 'diet' ? 'Meal plan templates' : 'Users'}
          </button>
        ))}
      </div>
      {tab === 'users' ? <UsersTab /> : <TemplatesTab key={tab} family={tab} />}
    </>
  );
}

function TemplatesTab({ family }: { family: Family }) {
  const state = useApi<(WorkoutPlanSummary | DietPlanSummary)[]>(PATH[family]);
  const toast = useToast();
  const navigate = useNavigate();
  const [assigning, setAssigning] = useState<{ id: number; name: string } | null>(null);

  async function duplicate(id: number) {
    try {
      const p = await api.post<{ id: number }>(`${PATH[family]}/${id}/duplicate`);
      toast('success', 'Template duplicated');
      navigate(`${UI[family]}/${p.id}`);
    } catch (e) { toast('error', (e as ApiError).message); }
  }
  async function remove(id: number, name: string) {
    if (!window.confirm(`Delete the “${name}” template? People who already have a copy keep theirs.`)) return;
    try {
      await api.del(`${PATH[family]}/${id}`);
      toast('success', 'Template deleted');
      state.reload();
    } catch (e) { toast('error', (e as ApiError).message); }
  }

  return (
    <Card title={family === 'workout' ? 'Workout templates' : 'Meal plan templates'} actions={<Link className="btn btn-primary btn-small" to={`${UI[family]}/new`}>+ New template</Link>}>
      <Async state={state}>
        {(list) => list.length === 0 ? <EmptyState title="No templates yet" action={<Link className="btn btn-primary" to={`${UI[family]}/new`}>Create one</Link>} /> : (
          <ul className="plan-list">
            {list.map((t) => (
              <li key={t.id} className="plan-row">
                <div>
                  <Link className="plan-name" to={`${UI[family]}/${t.id}`}>{t.name}</Link>
                  <p className="small muted">
                    {'dayCount' in t ? `${t.dayCount} days · ${t.exerciseCount} exercises` : `≈ ${fmtNum(t.avgDailyCalories)} kcal/day · ${t.itemCount} items`}
                  </p>
                </div>
                <div className="row gap wrap">
                  <button type="button" className="btn btn-small btn-primary" onClick={() => setAssigning({ id: t.id, name: t.name })}>Assign</button>
                  <Link className="btn btn-small" to={`${UI[family]}/${t.id}`}>Edit</Link>
                  <button type="button" className="btn btn-small" onClick={() => duplicate(t.id)}>Duplicate</button>
                  <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => remove(t.id, t.name)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Async>
      <Modal open={!!assigning} onClose={() => setAssigning(null)} title={`Assign “${assigning?.name ?? ''}”`}>
        {assigning && <AssignForm family={family} templateId={assigning.id} onDone={() => setAssigning(null)} />}
      </Modal>
    </Card>
  );
}

function AssignForm({ family, templateId, onDone }: { family: Family; templateId: number; onDone: () => void }) {
  const users = useApi<AdminUserRow[]>('/admin/users');
  const toast = useToast();
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await api.post<{ assigned: number }>(`${PATH[family]}/${templateId}/assign`, { userIds: picked });
      toast('success', `Assigned to ${r.assigned} ${r.assigned === 1 ? 'person' : 'people'}. It's now their active plan.`);
      onDone();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Async state={users}>
      {(list) => {
        const people = list.filter((u) => u.role === 'user');
        return people.length === 0 ? <EmptyState title="No users to assign to yet" /> : (
          <>
            <fieldset className="chips-field">
              <legend>Choose people</legend>
              <p className="hint">Each person gets a private copy that becomes their active plan. Their existing plans are kept.</p>
              <ul className="plain-list">
                {people.map((u) => (
                  <li key={u.id}>
                    <label className="check">
                      <input type="checkbox" checked={picked.includes(u.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, u.id] : picked.filter((x) => x !== u.id))} />
                      {u.name} <span className="muted small">{u.email}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            <div className="form-actions">
              <button type="button" className="btn" onClick={onDone}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!picked.length || busy} onClick={submit}>{busy ? 'Assigning…' : `Assign to ${picked.length || ''}`.trim()}</button>
            </div>
          </>
        );
      }}
    </Async>
  );
}

function UsersTab() {
  const state = useApi<AdminUserRow[]>('/admin/users');
  return (
    <Card title="People">
      <p className="small muted">Coaches see names and active plan names only. Logs, weights and profiles stay private to each person.</p>
      <Async state={state}>
        {(list) => (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Workout plan</th><th scope="col">Meal plan</th></tr></thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id}>
                    <th scope="row">{u.name}<br /><span className="muted small">{u.email}</span></th>
                    <td>{u.role === 'admin' ? <Badge tone="info">Coach</Badge> : u.onboarded ? 'User' : <Badge tone="warn">Not set up</Badge>}</td>
                    <td>{u.activeWorkoutPlan ?? <span className="muted">—</span>}</td>
                    <td>{u.activeDietPlan ?? <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
    </Card>
  );
}

export function CoachWorkoutTemplatePage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const state = useApi<WorkoutPlan>(isNew ? null : `/workout-templates/${id}`);
  const toast = useToast();
  const navigate = useNavigate();

  async function save(input: WorkoutPlanInput) {
    const p = isNew ? await api.post<WorkoutPlan>('/workout-templates', input) : await api.put<WorkoutPlan>(`/workout-templates/${id}`, input);
    toast('success', isNew ? 'Template created' : 'Template saved. Existing personal copies are unchanged.');
    if (isNew) navigate(`/coach/workouts/${p.id}`, { replace: true });
    else state.setData(p);
  }

  const header = <PageHeader back={{ to: '/coach?tab=workout', label: 'Coach tools' }} title={isNew ? 'New workout template' : 'Edit workout template'} subtitle={<Badge tone="info">Shared template</Badge>} />;
  if (isNew) return <>{header}<WorkoutPlanEditor plan={{ name: '', description: '', days: [] }} onSave={save} saveLabel="Create template" /></>;
  return <>{header}<Async state={state}>{(p) => <WorkoutPlanEditor key={p.updatedAt} plan={p} onSave={save} saveLabel="Save template" />}</Async></>;
}

export function CoachDietTemplatePage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const state = useApi<DietPlan>(isNew ? null : `/diet-templates/${id}`);
  const toast = useToast();
  const navigate = useNavigate();

  async function save(input: DietPlanInput) {
    const p = isNew ? await api.post<DietPlan>('/diet-templates', input) : await api.put<DietPlan>(`/diet-templates/${id}`, input);
    toast('success', isNew ? 'Template created' : 'Template saved. Existing personal copies are unchanged.');
    if (isNew) navigate(`/coach/meals/${p.id}`, { replace: true });
    else state.setData(p);
  }

  const header = <PageHeader back={{ to: '/coach?tab=diet', label: 'Coach tools' }} title={isNew ? 'New meal plan template' : 'Edit meal plan template'} subtitle={<><Badge tone="info">Shared template</Badge> <span className="small">All values are approximate.</span></>} />;
  if (isNew) return <>{header}<DietPlanEditor plan={{ name: '', description: '', items: [] }} onSave={save} /></>;
  return <>{header}<Async state={state}>{(p) => <DietPlanEditor key={p.updatedAt} plan={p} onSave={save} />}</Async></>;
}

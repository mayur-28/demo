import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api.ts';
import { useSession, useToast } from '../hooks.ts';
import { ErrorBox, HealthNotice, TextInput } from '../components/ui.tsx';
import type { Me } from '../../shared/types.ts';

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth-page" id="main">
      <div className="auth-card">
        <p className="brand"><span className="brand-mark" aria-hidden="true">F</span> FuelForm</p>
        <h1>{title}</h1>
        {children}
      </div>
      <HealthNotice compact />
    </main>
  );
}

export function LoginPage() {
  const { setMe } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<Me>('/auth/login', { email, password });
      setMe(me);
      toast('success', `Welcome back, ${me.user.name.split(' ')[0]}`);
      navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const demo = (who: string) => { setEmail(`${who}@demo.app`); setPassword('demo1234'); };

  return (
    <AuthShell title="Sign in">
      <form onSubmit={submit} noValidate>
        {error && <ErrorBox error={error} />}
        <TextInput label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error?.fields.email} required />
        <TextInput label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error?.fields.password} required />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="muted center">New here? <Link to="/register">Create an account</Link></p>
      <div className="demo-box">
        <p className="small"><strong>Demo accounts</strong> (password <code>demo1234</code>)</p>
        <div className="demo-buttons">
          <button type="button" className="btn btn-small" onClick={() => demo('alex')}>User: Alex</button>
          <button type="button" className="btn btn-small" onClick={() => demo('coach')}>Coach: Casey</button>
          <button type="button" className="btn btn-small" onClick={() => demo('sam')}>New user: Sam</button>
        </div>
      </div>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { setMe } = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setMe(await api.post<Me>('/auth/register', form));
      navigate('/onboarding', { replace: true });
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Create your account">
      <form onSubmit={submit} noValidate>
        {error && !Object.keys(error.fields).length && <ErrorBox error={error} />}
        <TextInput label="Your name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={error?.fields.name} required />
        <TextInput label="Email" type="email" autoComplete="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={error?.fields.email} required />
        <TextInput label="Password" type="password" autoComplete="new-password" minLength={8} hint="At least 8 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={error?.fields.password} required />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
      <p className="muted center">Already have an account? <Link to="/login">Sign in</Link></p>
    </AuthShell>
  );
}

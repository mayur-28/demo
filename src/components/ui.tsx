import { useEffect, useId, useRef, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { label as enumLabel } from '../../shared/constants.ts';
import { percentOf } from '../../shared/nutrition.ts';
import type { ApiError } from '../api.ts';

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="page-header">
      {back && <Link className="back-link" to={back.to}>← {back.label}</Link>}
      <div className="page-header-row">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({ title, children, actions, className = '' }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: ApiError | Error | string; onRetry?: () => void }) {
  const msg = typeof error === 'string' ? error : error.message;
  return (
    <div className="alert alert-error" role="alert">
      <span>{msg}</span>
      {onRetry && <button type="button" className="btn btn-small" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

/** Wraps async data: shows loading, error with retry, or the content. */
export function Async<T>({ state, children }: { state: { data: T | null; loading: boolean; error: ApiError | null; reload: () => void }; children: (d: T) => ReactNode }) {
  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
  if (state.data === null) return <Loading />;
  return <>{children(state.data)}</>;
}

export function Field({ label, error, hint, optional, children, htmlFor }: { label: string; error?: string; hint?: ReactNode; optional?: boolean; children: ReactNode; htmlFor: string }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={htmlFor}>
        {label}
        {optional && <span className="optional"> (optional)</span>}
      </label>
      {children}
      {hint && !error && <p className="hint" id={`${htmlFor}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${htmlFor}-error`} role="alert">{error}</p>}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode; optional?: boolean };
export function TextInput({ label, error, hint, optional, id, ...rest }: InputProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} optional={optional} htmlFor={fid}>
      <input
        id={fid}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined}
        required={!optional && rest.required !== false ? rest.required : undefined}
        {...rest}
      />
    </Field>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: ReactNode; optional?: boolean; options: readonly string[]; placeholder?: string; labelFor?: (v: string) => string };
export function SelectInput({ label, error, hint, optional, options, placeholder, labelFor = enumLabel, id, ...rest }: SelectProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} optional={optional} htmlFor={fid}>
      <select id={fid} aria-invalid={error ? true : undefined} aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o} value={o}>{labelFor(o)}</option>)}
      </select>
    </Field>
  );
}

/** Accessible group of toggle chips backed by checkboxes. */
export function CheckboxChips<T extends string>({ legend, options, value, onChange, hint, optional, labelFor = enumLabel }: {
  legend: string; options: readonly T[]; value: T[]; onChange: (v: T[]) => void; hint?: string; optional?: boolean; labelFor?: (v: string) => string;
}) {
  return (
    <fieldset className="chips-field">
      <legend>{legend}{optional && <span className="optional"> (optional)</span>}</legend>
      {hint && <p className="hint">{hint}</p>}
      <div className="chips">
        {options.map((o) => {
          const checked = value.includes(o);
          return (
            <label key={o} className={`chip ${checked ? 'chip-on' : ''}`}>
              <input type="checkbox" checked={checked} onChange={() => onChange(checked ? value.filter((v) => v !== o) : [...value, o])} />
              {labelFor(o)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function RadioCards<T extends string>({ legend, options, value, onChange, describe, error, name }: {
  legend: string; options: readonly T[]; value: T | ''; onChange: (v: T) => void; describe?: (v: T) => string; error?: string; name: string;
}) {
  return (
    <fieldset className={`radio-cards ${error ? 'has-error' : ''}`} aria-describedby={error ? `${name}-error` : undefined}>
      <legend>{legend}</legend>
      <div className="radio-grid">
        {options.map((o) => (
          <label key={o} className={`radio-card ${value === o ? 'radio-on' : ''}`}>
            <input type="radio" name={name} value={o} checked={value === o} onChange={() => onChange(o)} />
            <span className="radio-title">{enumLabel(o)}</span>
            {describe && <span className="radio-desc">{describe(o)}</span>}
          </label>
        ))}
      </div>
      {error && <p className="field-error" id={`${name}-error`} role="alert">{error}</p>}
    </fieldset>
  );
}

/** Progress toward a goal; turns amber past 110% so overshoot is visible without alarm. */
export function ProgressBar({ label, value, goal, unit, approx }: { label: string; value: number; goal: number; unit: string; approx?: boolean }) {
  const pct = percentOf(value, goal);
  const state = pct > 110 ? 'over' : pct >= 90 ? 'near' : 'under';
  const remaining = Math.round((goal - value) * 10) / 10;
  return (
    <div className="progress">
      <div className="progress-head">
        <span className="progress-label">{label}</span>
        <span className="progress-value">
          <strong>{approx ? '≈ ' : ''}{fmtNum(value)}</strong> / {fmtNum(goal)} {unit}
        </span>
      </div>
      <div className={`bar bar-${state}`} role="progressbar" aria-label={`${label}`} aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.round(value)} aria-valuetext={`${fmtNum(value)} of ${fmtNum(goal)} ${unit}`}>
        <span style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className="progress-foot muted">
        {remaining >= 0 ? `${fmtNum(remaining)} ${unit} left` : `${fmtNum(-remaining)} ${unit} over`} · {pct}%
      </p>
    </div>
  );
}

export const fmtNum = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : (Math.round(n * 10) / 10).toLocaleString());

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'danger' | 'ok' | 'info'; title?: string }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>;
}

/** Native <dialog> modal: focus trapping, Esc to close and inert background come from the browser. */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && (
        <>
          <div className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="btn-icon" onClick={onClose} aria-label="Close dialog">✕</button>
          </div>
          <div className="modal-body">{children}</div>
        </>
      )}
    </dialog>
  );
}

export function MacroLine({ m, approx }: { m: { calories: number; protein: number; carbs: number; fat: number }; approx?: boolean }) {
  return (
    <span className="macro-line">
      <strong>{approx ? '≈' : ''}{fmtNum(m.calories)} kcal</strong>
      <span>P {fmtNum(m.protein)}g</span>
      <span>C {fmtNum(m.carbs)}g</span>
      <span>F {fmtNum(m.fat)}g</span>
    </span>
  );
}

export function HealthNotice({ compact }: { compact?: boolean }) {
  return (
    <p className={`health-notice ${compact ? 'compact' : ''}`}>
      <strong>General guidance only.</strong> Plans and nutrition numbers are estimates, not medical advice. If you have a medical
      condition, are pregnant, or have concerns, check with a doctor or registered dietitian before changing your diet or exercise.
    </p>
  );
}

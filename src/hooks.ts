import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api.ts';
import type { Me } from '../shared/types.ts';
import { cmToIn, inToCm, kgToLb, lbToKg } from '../shared/goals.ts';

/** Fetch JSON from the API with loading / error state and a reload function. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (path === null) return;
    const ticket = ++latest.current;
    setLoading(true);
    setError(null);
    api.get<T>(path)
      .then((d) => { if (ticket === latest.current) setData(d); })
      .catch((e) => { if (ticket === latest.current) setError(e instanceof ApiError ? e : new ApiError(0, String(e))); })
      .finally(() => { if (ticket === latest.current) setLoading(false); });
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

// ---------------------------------------------------------------- session
export interface Session {
  me: Me | null;
  setMe: (me: Me | null) => void;
  refresh: () => Promise<void>;
}
export const SessionContext = createContext<Session>({ me: null, setMe: () => {}, refresh: async () => {} });
export const useSession = () => useContext(SessionContext);
export const useMe = () => {
  const { me } = useSession();
  if (!me) throw new Error('useMe used outside an authenticated route');
  return me;
};

// ---------------------------------------------------------------- units
export function useUnits() {
  const { me } = useSession();
  const imperial = me?.profile?.units === 'imperial';
  return {
    imperial,
    weightUnit: imperial ? 'lb' : 'kg',
    /** kg → display number in the user's unit */
    toDisplayWeight: (kg: number | null) => (kg === null ? null : imperial ? kgToLb(kg) : Math.round(kg * 10) / 10),
    /** display unit → kg */
    fromDisplayWeight: (v: number | null) => (v === null ? null : imperial ? lbToKg(v) : v),
    fmtWeight: (kg: number | null) => (kg === null ? '—' : imperial ? `${kgToLb(kg)} lb` : `${Math.round(kg * 10) / 10} kg`),
    fmtHeight: (cm: number) => {
      if (!imperial) return `${cm} cm`;
      const inches = cmToIn(cm);
      return `${Math.floor(inches / 12)}′ ${Math.round(inches % 12)}″`;
    },
    cmToIn,
    inToCm,
  };
}

// ---------------------------------------------------------------- toasts
export interface Toast { id: number; kind: 'success' | 'error' | 'info'; message: string }
export const ToastContext = createContext<(kind: Toast['kind'], message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

/** Keep a value in sync with localStorage for small per-device conveniences. */
export function useLocalState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
  }, [key, v]);
  return [v, setV] as const;
}

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, ApiError, setUnauthorizedHandler } from './api.ts';
import { SessionContext, ToastContext, useSession, type Toast } from './hooks.ts';
import type { Me } from '../shared/types.ts';
import { Layout } from './components/Layout.tsx';
import { Loading } from './components/ui.tsx';
import { LoginPage, RegisterPage } from './pages/Auth.tsx';
import { OnboardingPage, ProfilePage } from './pages/Profile.tsx';
import { DashboardPage } from './pages/Dashboard.tsx';
import { WorkoutsPage, WorkoutPlanPage } from './pages/Workouts.tsx';
import { WorkoutSessionPage } from './pages/WorkoutSession.tsx';
import { WorkoutHistoryPage } from './pages/WorkoutHistory.tsx';
import { ExercisesPage } from './pages/Exercises.tsx';
import { FoodsPage } from './pages/Foods.tsx';
import { NutritionPage } from './pages/Nutrition.tsx';
import { MealPlansPage, MealPlanPage } from './pages/MealPlans.tsx';
import { ProgressPage } from './pages/Progress.tsx';
import { CoachPage, CoachWorkoutTemplatePage, CoachDietTemplatePage } from './pages/Coach.tsx';
import { NotFoundPage } from './pages/NotFound.tsx';

function RequireAuth({ children, admin, allowUnonboarded }: { children: ReactNode; admin?: boolean; allowUnonboarded?: boolean }) {
  const { me } = useSession();
  const location = useLocation();
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!me.profile && !allowUnonboarded && me.user.role !== 'admin') return <Navigate to="/onboarding" replace />;
  if (admin && me.user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span>{t.message}</span>
          <button type="button" className="btn-icon" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [booting, setBooting] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else throw e;
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => setMe(null)).finally(() => setBooting(false));
    setUnauthorizedHandler(() => setMe(null));
  }, [refresh]);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback((kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { id, kind, message }]);
    setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4000);
  }, [dismiss]);

  const session = useMemo(() => ({ me, setMe, refresh }), [me, refresh]);

  if (booting) return <div className="boot"><Loading label="Starting FuelForm…" /></div>;

  return (
    <SessionContext.Provider value={session}>
      <ToastContext.Provider value={toast}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={me ? <Navigate to="/" replace /> : <LoginPage />} />
            <Route path="/register" element={me ? <Navigate to="/" replace /> : <RegisterPage />} />
            <Route path="/onboarding" element={<RequireAuth allowUnonboarded><OnboardingPage /></RequireAuth>} />
            <Route element={<RequireAuth><Layout /></RequireAuth>}>
              <Route index element={<DashboardPage />} />
              <Route path="workouts" element={<WorkoutsPage />} />
              <Route path="workouts/history" element={<WorkoutHistoryPage />} />
              <Route path="workouts/log" element={<WorkoutSessionPage />} />
              <Route path="workouts/log/:logId" element={<WorkoutSessionPage />} />
              <Route path="workouts/:id" element={<WorkoutPlanPage />} />
              <Route path="nutrition" element={<NutritionPage />} />
              <Route path="meals" element={<MealPlansPage />} />
              <Route path="meals/:id" element={<MealPlanPage />} />
              <Route path="progress" element={<ProgressPage />} />
              <Route path="exercises" element={<ExercisesPage />} />
              <Route path="foods" element={<FoodsPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="coach" element={<RequireAuth admin><CoachPage /></RequireAuth>} />
              <Route path="coach/workouts/:id" element={<RequireAuth admin><CoachWorkoutTemplatePage /></RequireAuth>} />
              <Route path="coach/meals/:id" element={<RequireAuth admin><CoachDietTemplatePage /></RequireAuth>} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toasts toasts={toasts} dismiss={dismiss} />
      </ToastContext.Provider>
    </SessionContext.Provider>
  );
}

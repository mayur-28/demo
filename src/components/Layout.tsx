import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.ts';
import { useSession, useToast } from '../hooks.ts';

const MAIN = [
  { to: '/', label: 'Today', icon: '◉', end: true },
  { to: '/workouts', label: 'Workouts', icon: '▲' },
  { to: '/nutrition', label: 'Food log', icon: '◆' },
  { to: '/meals', label: 'Meal plans', icon: '▤' },
  { to: '/progress', label: 'Progress', icon: '↗' },
];
const MORE = [
  { to: '/exercises', label: 'Exercise library' },
  { to: '/foods', label: 'Food library' },
  { to: '/profile', label: 'Profile & goals' },
];

export function Layout() {
  const { me, setMe } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const isAdmin = me?.user.role === 'admin';

  // After in-app navigation, move focus to the main content so screen-reader and keyboard
  // users land in the right place. Skip the first render so the skip link stays first in tab order.
  const firstRender = useRef(true);
  useEffect(() => {
    setMenuOpen(false);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);

  async function signOut() {
    try {
      await api.post('/auth/logout');
    } finally {
      setMe(null);
      toast('info', 'Signed out');
      navigate('/login');
    }
  }

  const secondary = [...MORE, ...(isAdmin ? [{ to: '/coach', label: 'Coach tools' }] : [])];

  return (
    <div className="shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="FuelForm home">
          <span className="brand-mark" aria-hidden="true">F</span> FuelForm
        </NavLink>
        <div className="topbar-right">
          {isAdmin && <span className="role-pill">Coach</span>}
          <button type="button" className="btn btn-ghost menu-btn" aria-expanded={menuOpen} aria-controls="more-menu" onClick={() => setMenuOpen((o) => !o)}>
            Menu
          </button>
        </div>
        {menuOpen && (
          <nav id="more-menu" className="more-menu" aria-label="More">
            <p className="more-user">Signed in as <strong>{me?.user.name}</strong></p>
            {secondary.map((l) => <NavLink key={l.to} to={l.to}>{l.label}</NavLink>)}
            <button type="button" className="linklike" onClick={signOut}>Sign out</button>
          </nav>
        )}
      </header>

      <nav className="sidebar" aria-label="Main">
        <NavLink to="/" className="brand" aria-label="FuelForm home">
          <span className="brand-mark" aria-hidden="true">F</span> FuelForm
        </NavLink>
        <ul>
          {MAIN.map((l) => <li key={l.to}><NavLink to={l.to} end={l.end}><span aria-hidden="true" className="nav-icon">{l.icon}</span>{l.label}</NavLink></li>)}
        </ul>
        <p className="nav-section">Library & account</p>
        <ul>
          {secondary.map((l) => <li key={l.to}><NavLink to={l.to}>{l.label}</NavLink></li>)}
        </ul>
        <div className="sidebar-foot">
          <p className="muted small">{me?.user.name}{isAdmin && ' · Coach'}</p>
          <button type="button" className="btn btn-ghost btn-small" onClick={signOut}>Sign out</button>
        </div>
      </nav>

      <main id="main" ref={mainRef} tabIndex={-1}>
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Main">
        {MAIN.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}>
            <span aria-hidden="true" className="nav-icon">{l.icon}</span>
            <span>{l.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

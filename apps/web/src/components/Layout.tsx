import { useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { EXPERTISE_LEVELS, THEMES, type ExpertiseLevel, type Me, type Theme } from '@easycontract/shared';
import { usePrefs } from '../lib/prefs.tsx';
import { useApi } from '../lib/useApi.ts';
import { PolicyBanner } from './PolicyBanner.tsx';
import { PolicyGate } from '../pages/Auth.tsx';
import { api, setDevUser } from '../lib/api.ts';

const THEME_LABELS: Record<Theme, string> = { fun: 'Fun', normal: 'Normal', professional: 'Professional' };
const LEVEL_LABELS: Record<ExpertiseLevel, string> = { plain: 'Plain', legal: 'Legal' };

function Segmented<T extends string>({ label, options, labels, value, onChange }: {
  label: string; options: readonly T[]; labels: Record<T, string>; value: T; onChange(v: T): void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      <span className="segmented__label">{label}</span>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} className={value === o ? 'is-active' : ''} onClick={() => onChange(o)}>
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

/** Pages that work without signing in. */
export function PublicLayout() {
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand"><span className="brand__mark" aria-hidden>EC</span><span>EasyContract</span></NavLink>
      </header>
      <PolicyBanner />
      <main className="main"><Outlet /></main>
    </div>
  );
}

export function Layout() {
  const { theme, setTheme, level, setLevel } = usePrefs();
  const me = useApi<Me>('/me');
  // On small screens the display settings fold away behind one button.
  const [prefsOpen, setPrefsOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  async function signOut() {
    try { await api('/auth/logout', { method: 'POST', body: '{}' }); } catch { /* signed out either way */ }
    setDevUser('off');
    navigate('/login');
  }

  if (me.status === 401) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand__mark" aria-hidden>EC</span>
          <span>EasyContract</span>
        </NavLink>
        <nav className="topnav">
          <NavLink to="/projects">Projects</NavLink>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/profile">Company profile</NavLink>
          <NavLink to="/team">Team</NavLink>
        </nav>
        <button type="button" className="prefs-toggle" aria-expanded={prefsOpen} aria-controls="topbar-prefs" onClick={() => setPrefsOpen(!prefsOpen)}>
          Display {prefsOpen ? '▲' : '▼'}
        </button>
        <div id="topbar-prefs" className={`topbar__prefs ${prefsOpen ? 'is-open' : ''}`}>
          <Segmented label="Theme" options={THEMES} labels={THEME_LABELS} value={theme} onChange={setTheme} />
          <Segmented label="Detail" options={EXPERTISE_LEVELS} labels={LEVEL_LABELS} value={level} onChange={setLevel} />
          {me.data && (
            <span className="whoami" title={me.data.user.email}>
              <span className="whoami__name">{me.data.user.name}</span>
              <span className="whoami__tenant"> · {me.data.tenant.name}{me.data.authMode === 'dev' && ' (dev sign-in)'}</span>
              <button className="linklike signout" onClick={signOut}>Sign out</button>
            </span>
          )}
        </div>
      </header>
      <PolicyBanner />
      <main className="main">
        {me.data && !me.data.policyAccepted && me.data.authMode === 'session'
          ? <PolicyGate onAccepted={me.reload} />
          : me.error ? <div className="card">Could not reach the EasyContract server: {me.error}</div> : <Outlet />}
      </main>
    </div>
  );
}

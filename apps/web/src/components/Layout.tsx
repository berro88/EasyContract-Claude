import { NavLink, Outlet } from 'react-router-dom';
import { EXPERTISE_LEVELS, THEMES, type ExpertiseLevel, type Me, type Theme } from '@easycontract/shared';
import { usePrefs } from '../lib/prefs.tsx';
import { useApi } from '../lib/useApi.ts';
import { PolicyBanner } from './PolicyBanner.tsx';

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

export function Layout() {
  const { theme, setTheme, level, setLevel } = usePrefs();
  const me = useApi<Me>('/me');

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand__mark" aria-hidden>EC</span>
          <span>EasyContract</span>
        </NavLink>
        <nav className="topnav">
          <NavLink to="/projects">Projects</NavLink>
          <NavLink to="/profile">Company profile</NavLink>
        </nav>
        <div className="topbar__prefs">
          <Segmented label="Theme" options={THEMES} labels={THEME_LABELS} value={theme} onChange={setTheme} />
          <Segmented label="Detail" options={EXPERTISE_LEVELS} labels={LEVEL_LABELS} value={level} onChange={setLevel} />
          {me.data && <span className="whoami" title={me.data.user.email}>{me.data.tenant.name}</span>}
        </div>
      </header>
      <PolicyBanner />
      <main className="main">
        {me.error ? <div className="card">Could not reach the EasyContract server: {me.error}</div> : <Outlet />}
      </main>
    </div>
  );
}

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { EXPERTISE_LEVELS, THEMES, type ExpertiseLevel, type Theme } from '@easycontract/shared';
import { copy, type CopyKey } from './copy.ts';

interface Prefs {
  theme: Theme;
  level: ExpertiseLevel;
  setTheme(t: Theme): void;
  setLevel(l: ExpertiseLevel): void;
  t(key: CopyKey): string;
}

const PrefsContext = createContext<Prefs | null>(null);

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => stored('easycontract.theme', THEMES, 'normal'));
  const [level, setLevelState] = useState<ExpertiseLevel>(() => stored('easycontract.level', EXPERTISE_LEVELS, 'plain'));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const value: Prefs = {
    theme,
    level,
    setTheme: (t) => { setThemeState(t); save('easycontract.theme', t); },
    setLevel: (l) => { setLevelState(l); save('easycontract.level', l); },
    t: (key) => copy(theme, key),
  };
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs outside PrefsProvider');
  return ctx;
}

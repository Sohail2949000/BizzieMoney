import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  ThemeContext,
  type ThemePreference,
  type ThemeContextValue,
} from './theme';

const THEME_STORAGE_KEY = 'bizziemoney-theme';

function readStoredPreference(): ThemePreference {
  const stored = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system'
    ? stored
    : 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setStoredPreference] =
    useState<ThemePreference>(readStoredPreference);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    setStoredPreference(nextPreference);
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, nextPreference);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = preference;
  }, [preference]);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, setPreference }),
    [preference, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

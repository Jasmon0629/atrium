import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const KEY = 'atrium-theme';
export const THEME_ORDER: Theme[] = ['light', 'dark', 'system'];

function mq() {
  return window.matchMedia('(prefers-color-scheme: dark)');
}

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function isDark(theme: Theme): boolean {
  return theme === 'dark' || (theme === 'system' && mq().matches);
}

/** Toggle the .dark class on <html>; index.html does the same before first paint. */
export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', isDark(theme));
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Theme preference with persistence and a live "system" mode. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    const m = mq();
    const onChange = () => {
      if (theme === 'system') applyTheme(theme);
    };
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem(KEY, t);
    } catch {}
    setThemeState(t);
  }, []);

  return [theme, setTheme];
}

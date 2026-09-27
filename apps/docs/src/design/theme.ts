import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'dark' | 'light' | 'system';
export const THEME_KEY = 'gix-theme';
const ORDER: readonly ThemeChoice[] = ['dark', 'light', 'system'];

/**
 * Runs inline in <head> before first paint (see index.html) so there is no flash of the wrong
 * theme. Dark is the GIX default. Kept as a string so the prerender can inline it verbatim.
 */
export const THEME_BOOTSTRAP = `(function(){try{var c=localStorage.getItem('${THEME_KEY}')||'dark';var t=c==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):c;document.documentElement.dataset.theme=t;document.documentElement.dataset.themeChoice=c;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export function resolveTheme(choice: ThemeChoice, prefersLight: boolean): 'dark' | 'light' {
  return choice === 'system' ? (prefersLight ? 'light' : 'dark') : choice;
}

function readChoice(): ThemeChoice {
  try {
    const stored = globalThis.localStorage?.getItem(THEME_KEY);
    return stored === 'light' || stored === 'system' || stored === 'dark' ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

function apply(choice: ThemeChoice): void {
  const prefersLight = globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ?? false;
  document.documentElement.dataset['theme'] = resolveTheme(choice, prefersLight);
  document.documentElement.dataset['themeChoice'] = choice;
}

export function useTheme(): { readonly choice: ThemeChoice; readonly setChoice: (choice: ThemeChoice) => void; readonly cycle: () => void } {
  // The server render always says "dark"; the real choice is read after hydration.
  const [choice, setState] = useState<ThemeChoice>('dark');
  useEffect(() => setState(readChoice()), []);
  useEffect(() => {
    if (choice !== 'system') return;
    const media = globalThis.matchMedia?.('(prefers-color-scheme: light)');
    const onChange = (): void => apply('system');
    media?.addEventListener('change', onChange);
    return () => media?.removeEventListener('change', onChange);
  }, [choice]);
  const setChoice = useCallback((next: ThemeChoice) => {
    setState(next);
    try {
      globalThis.localStorage?.setItem(THEME_KEY, next);
    } catch {
      // Storage may be unavailable (private mode); the theme still applies for this page.
    }
    apply(next);
  }, []);
  const cycle = useCallback(() => setChoice(ORDER[(ORDER.indexOf(readChoice()) + 1) % ORDER.length] ?? 'dark'), [setChoice]);
  return { choice, setChoice, cycle };
}

import type { ThemePref } from '../settings';

const media = window.matchMedia('(prefers-color-scheme: dark)');

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'auto') return media.matches ? 'dark' : 'light';
  return pref;
}

export function applyTheme(pref: ThemePref): 'light' | 'dark' {
  const effective = resolveTheme(pref);
  document.documentElement.dataset.theme = effective;
  return effective;
}

/** Zavola cb, kdyz se zmeni systemovy motiv a uzivatel ma nastaveno "auto". */
export function onSystemThemeChange(cb: () => void): void {
  media.addEventListener('change', cb);
}

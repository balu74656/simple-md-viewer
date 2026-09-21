export type ThemePref = 'auto' | 'light' | 'dark';
export type Mode = 'view' | 'edit' | 'split';

export interface Settings {
  plantumlServer: string;
  plantumlFormat: 'svg' | 'png';
  defaultMode: Mode;
  theme: ThemePref;
  tocOpen: boolean;
  lineWrap: boolean;
}

/**
 * Vychozi PlantUML server se bere z build-time promenne, aby v repozitari
 * nebyla natvrdo URL konkretni instalace. Nastav ji v .env.local:
 *
 *   VITE_PLANTUML_SERVER=https://plantuml.firma.cz
 *
 * Bez ni aplikace nastartuje s prazdnym polem a uzivatel si server doplni
 * v Nastaveni; volba se ulozi a build-time hodnotu uz nepotrebuje.
 */
const DEFAULT_PLANTUML_SERVER =
  (import.meta.env?.VITE_PLANTUML_SERVER as string | undefined)?.trim() || '';

const DEFAULTS: Settings = {
  plantumlServer: DEFAULT_PLANTUML_SERVER,
  plantumlFormat: 'svg',
  defaultMode: 'view',
  theme: 'auto',
  tocOpen: false,
  lineWrap: true,
};

const KEY = 'md-viewer.settings.v1';

let current: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* localStorage muze byt nedostupny v privatnim rezimu - nastaveni pak plati jen pro session */
  }
  return current;
}

/** Normalizuje URL serveru: odstrani koncove lomitko i pripadny /svg suffix. */
export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  return trimmed.replace(/\/(svg|png|txt|uml)$/i, '');
}

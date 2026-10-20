/**
 * Druh dokumentu podle pripony souboru.
 *
 * Samostatny PlantUML soubor (.puml a spol.) neni Markdown - nahled ho musi
 * poslat rovnou na PlantUML server, jinak z nej marked udela jeden odstavec.
 * YAML a JSON se v nahledu zobrazi jako OpenAPI dokumentace, pokud obsahuji
 * specifikaci (rozhoduje obsah, ne pripona), jinak jako zvyrazneny kod.
 */
export type DocKind = 'markdown' | 'plantuml' | 'yaml' | 'json';

export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'txt'];
export const PLANTUML_EXTENSIONS = ['puml', 'plantuml', 'pu', 'iuml'];
export const YAML_EXTENSIONS = ['yaml', 'yml'];
export const JSON_EXTENSIONS = ['json'];
export const DATA_EXTENSIONS = [...YAML_EXTENSIONS, ...JSON_EXTENSIONS];

function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Neulozeny tab (bez cesty) je vzdy Markdown. */
export function docKind(path: string | null): DocKind {
  if (!path) return 'markdown';
  const ext = extensionOf(path);
  if (PLANTUML_EXTENSIONS.includes(ext)) return 'plantuml';
  if (YAML_EXTENSIONS.includes(ext)) return 'yaml';
  if (JSON_EXTENSIONS.includes(ext)) return 'json';
  return 'markdown';
}

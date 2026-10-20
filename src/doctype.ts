/**
 * Druh dokumentu podle pripony souboru.
 *
 * Samostatny PlantUML soubor (.puml a spol.) neni Markdown - nahled ho musi
 * poslat rovnou na PlantUML server, jinak z nej marked udela jeden odstavec.
 */
export type DocKind = 'markdown' | 'plantuml';

export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'txt'];
export const PLANTUML_EXTENSIONS = ['puml', 'plantuml', 'pu', 'iuml'];

function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Neulozeny tab (bez cesty) je vzdy Markdown. */
export function docKind(path: string | null): DocKind {
  if (path && PLANTUML_EXTENSIONS.includes(extensionOf(path))) return 'plantuml';
  return 'markdown';
}

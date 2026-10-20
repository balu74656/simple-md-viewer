import { parseDocument } from 'yaml';

/**
 * Nacteni YAML/JSON a rozbalovani $ref, vcetne odkazu do jinych souboru
 * (`common.yaml#/components/schemas/Error`). Externi soubory se nactou
 * predem (render je synchronni), cesty se resi relativne k souboru,
 * ve kterem $ref stoji.
 */

export type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class DataParseError extends Error {
  /** Radek chyby od 1, pokud ho parser zna. */
  line?: number;
  constructor(message: string, line?: number) {
    super(message);
    this.line = line;
  }
}

/** Radek (od 1) z pozice znaku. */
function lineAt(source: string, pos: number): number {
  return source.slice(0, pos).split('\n').length;
}

export function parseData(source: string, format: 'yaml' | 'json'): unknown {
  if (format === 'json') {
    try {
      return JSON.parse(source);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const lc = /line (\d+)/.exec(msg);
      const pos = /position (\d+)/.exec(msg);
      const line = lc ? Number(lc[1]) : pos ? lineAt(source, Number(pos[1])) : undefined;
      throw new DataParseError(msg, line);
    }
  }
  const doc = parseDocument(source, { uniqueKeys: false });
  const err = doc.errors[0];
  // Zprava konci vypisem kontextu (radek se znackou) - ten ukazuje nahled jinak
  if (err) throw new DataParseError(err.message.split(/ at line \d+|\n/)[0], err.linePos?.[0].line);
  return doc.toJS({ maxAliasCount: 10000 });
}

/** Je to OpenAPI 3.x nebo Swagger 2.0? Rozhoduje obsah, ne pripona. */
export function isOpenApi(doc: unknown): doc is Obj {
  return isObj(doc) && (typeof doc.openapi === 'string' || String(doc.swagger ?? '').startsWith('2'));
}

/** Rychly odhad bez parsovani - aby rozbity OpenAPI soubor ukazal chybu, ne jen kod. */
export function looksLikeOpenApi(source: string): boolean {
  return /^\s*["']?(openapi|swagger)["']?\s*:/m.test(source);
}

/* ------------------------------------------------------------------ */
/* Cesty                                                               */
/* ------------------------------------------------------------------ */

export function formatOf(path: string): 'yaml' | 'json' {
  return /\.json$/i.test(path) ? 'json' : 'yaml';
}

function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.slice(0, i) : '';
}

/** Spoji adresar s relativni cestou a vyresi `.` a `..`. Zachova styl lomitek. */
export function joinPath(base: string, rel: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  const absolute = /^([a-zA-Z]:)?[\\/]/.test(rel);
  let raw = absolute ? rel : `${dirname(base)}/${rel}`;
  // Sitova cesta \\server\share - prvni dve lomitka nejsou prazdne segmenty
  const unc = /^[\\/]{2}[^\\/]/.test(raw);
  if (unc) raw = raw.slice(2);
  const out: string[] = [];
  for (const part of raw.split(/[\\/]/)) {
    if (part === '.') continue;
    if (part === '..' && out.length > 1) out.pop();
    else if (part !== '' || out.length === 0) out.push(part);
  }
  return (unc ? sep + sep : '') + out.join(sep);
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Resolver                                                            */
/* ------------------------------------------------------------------ */

export interface Resolved {
  value: unknown;
  /** Soubor, ve kterem hodnota lezi - proti nemu se resi jeji dalsi $ref. */
  base: string;
  /** Posledni segment ukazatele, napr. jmeno schematu. */
  name?: string;
  /** Kanonicky klic cile (soubor#ukazatel) - pro detekci cyklu. */
  key?: string;
  error?: string;
}

const MAX_FILES = 50;

export class RefResolver {
  private docs = new Map<string, unknown>();
  private failed = new Map<string, string>();

  /**
   * @param rootPath cesta otevreneho souboru; '' pro neulozeny tab
   *                 (externi odkazy pak nejdou nacist).
   */
  constructor(
    root: unknown,
    readonly rootPath: string,
  ) {
    this.docs.set(this.key(rootPath), root);
  }

  private key(path: string): string {
    return path.replace(/\\/g, '/').toLowerCase();
  }

  isRoot(base: string): boolean {
    return samePath(base, this.rootPath);
  }

  /** Nacte vsechny soubory, na ktere vedou externi $ref (i tranzitivne). */
  async loadExternal(read: (path: string) => Promise<string>): Promise<void> {
    const queue: Array<[unknown, string]> = [[this.docs.get(this.key(this.rootPath)), this.rootPath]];
    while (queue.length) {
      const [doc, base] = queue.shift()!;
      for (const file of externalFiles(doc)) {
        if (!this.rootPath) {
          this.failed.set(file, 'dokument není uložený, relativní cestu nelze určit');
          continue;
        }
        const path = joinPath(base, file);
        const k = this.key(path);
        if (this.docs.has(k) || this.failed.has(k)) continue;
        if (this.docs.size >= MAX_FILES) {
          this.failed.set(k, `překročen limit ${MAX_FILES} souborů`);
          continue;
        }
        try {
          const parsed = parseData(await read(path), formatOf(path));
          this.docs.set(k, parsed);
          queue.push([parsed, path]);
        } catch (e) {
          this.failed.set(k, e instanceof Error ? e.message : String(e));
        }
      }
    }
  }

  /** Vyresi jeden $ref relativne k souboru `base`. */
  resolve(ref: string, base: string): Resolved {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) {
      return { value: undefined, base, error: 'odkaz na URL se nenačítá' };
    }
    const hash = ref.indexOf('#');
    const file = hash >= 0 ? ref.slice(0, hash) : ref;
    const pointer = hash >= 0 ? ref.slice(hash + 1) : '';
    const target = file ? (this.rootPath ? joinPath(base, file) : file) : base;
    const k = this.key(target);

    const doc = this.docs.get(k);
    if (doc === undefined) {
      const why = this.failed.get(k) ?? this.failed.get(file) ?? 'soubor nenačten';
      return { value: undefined, base, error: `${file}: ${why}` };
    }

    let value: unknown = doc;
    const segments = pointer
      .split('/')
      .slice(1)
      .map((s) => decodeURIComponent(s.replace(/~1/g, '/').replace(/~0/g, '~')));
    for (const s of segments) {
      value = Array.isArray(value) ? value[Number(s)] : isObj(value) ? value[s] : undefined;
      if (value === undefined) {
        return { value, base, error: `cíl ${ref} neexistuje` };
      }
    }
    const name = segments.length ? segments[segments.length - 1] : file.split(/[\\/]/).pop();
    return { value, base: target, name, key: `${k}#${pointer}` };
  }

  /** Projde retez $ref az k hodnote. Bez $ref vrati hodnotu beze zmeny. */
  deref(value: unknown, base: string): Resolved {
    let current: Resolved = { value, base };
    for (let i = 0; i < 32; i++) {
      const v = current.value;
      if (!isObj(v) || typeof v.$ref !== 'string') return current;
      const next = this.resolve(v.$ref, current.base);
      if (next.error) return { ...next, name: next.name ?? refName(v.$ref) };
      // Jmeno nese prvni odkaz v retezu
      current = { ...next, name: current.name ?? next.name, key: current.key ?? next.key };
    }
    return { value: undefined, base, error: 'zacyklený $ref' };
  }
}

/** Jmeno z $ref pro popisky: `#/components/schemas/Pet` -> Pet. */
export function refName(ref: string): string {
  const parts = ref.split(/[#/]/).filter(Boolean);
  return parts[parts.length - 1] ?? ref;
}

/** Soubory, na ktere vedou $ref v dokumentu (bez URL a interních odkazu). */
function externalFiles(doc: unknown): Set<string> {
  const out = new Set<string>();
  const stack: unknown[] = [doc];
  const seen = new Set<unknown>();
  while (stack.length) {
    const v = stack.pop();
    if (typeof v !== 'object' || v === null || seen.has(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) {
      stack.push(...v);
      continue;
    }
    const ref = (v as Obj).$ref;
    if (typeof ref === 'string' && !ref.startsWith('#') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) {
      const file = ref.split('#')[0];
      if (file) out.add(file);
    }
    stack.push(...Object.values(v));
  }
  return out;
}

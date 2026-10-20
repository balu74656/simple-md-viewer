import { Facet, type Extension, type Text } from '@codemirror/state';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import type { DocKind } from '../doctype';
import { checkPlantUml, plantUmlBody, type PlantUmlError } from '../render/plantuml';

/**
 * Kontrola syntaxe PlantUML v editoru. Kazdy diagram v dokumentu se posle
 * na nastaveny PlantUML server, ktery vrati chybu a cislo radku. Chyba se
 * v editoru podtrhne, oznaci v gutteru a jeji text je v tooltipu.
 */

/** Druh dokumentu v editoru - samostatny .puml vs. Markdown s bloky. */
export const docKindFacet = Facet.define<DocKind, DocKind>({
  combine: (values) => values[values.length - 1] ?? 'markdown',
});

export type PumlCheckStatus =
  | { state: 'off' }
  | { state: 'ok'; diagrams: number }
  | { state: 'errors'; count: number; firstLine: number }
  | { state: 'unreachable' };

export interface PumlLintOptions {
  /** Normalizovana URL serveru, prazdna = kontrola vypnuta. */
  server(): string;
  onStatus(status: PumlCheckStatus): void;
}

interface DiagramRange {
  /** Pozice zacatku zdroje diagramu v dokumentu. */
  from: number;
  source: string;
}

const PUML_FILE_RE = /^[ \t]*@start(\w+)\b[\s\S]*?^[ \t]*@end\1\b.*$/gm;
// Stejne jazyky jako v nahledu (DIAGRAM_LANGS v render/markdown.ts)
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*(?:plantuml|puml|uml)\b[^\n]*\n([\s\S]*?)^ {0,3}\1[`~]*[ \t]*$/gim;

/** Najde diagramy tak, jak je pak vykresli nahled. */
export function findDiagrams(text: string, kind: DocKind): DiagramRange[] {
  if (kind === 'plantuml') {
    const found = Array.from(text.matchAll(PUML_FILE_RE), (m) => ({ from: m.index, source: m[0] }));
    if (found.length === 0 && text.trim()) found.push({ from: 0, source: text });
    return found;
  }
  return Array.from(text.matchAll(FENCE_RE), (m) => ({
    from: m.index + m[0].indexOf('\n') + 1,
    // Nahled dostava obsah bloku bez koncoveho odradkovani
    source: m[2].replace(/\n$/, ''),
  }));
}

/** Prevede chybu ze serveru na rozsah v editoru (cely chybny radek). */
function toDiagnostic(doc: Text, range: DiagramRange, err: PlantUmlError, lineOffset: number): Diagnostic {
  const firstLine = doc.lineAt(range.from).number;
  const sourceLines = range.source.split('\n').length;
  // Chyba na doplnenem @enduml patri na posledni radek bloku
  const rel = Math.min(Math.max(err.line - lineOffset, 1), sourceLines);
  const line = doc.line(Math.min(firstLine + rel - 1, doc.lines));
  return {
    from: line.from,
    to: line.to,
    severity: 'error',
    source: 'PlantUML',
    message: err.message,
  };
}

// Stejny diagram se nekontroluje dvakrat - psani v jinem bloku
// nema poslat na server vsechny diagramy znovu.
const cache = new Map<string, PlantUmlError | null>();
const CACHE_LIMIT = 200;

async function check(body: string, server: string): Promise<PlantUmlError | null> {
  const key = `${server}\n${body}`;
  if (cache.has(key)) return cache.get(key)!;
  const result = await checkPlantUml(body, server);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}

export function plantumlLint(opts: PumlLintOptions): Extension {
  return [
    lintGutter(),
    linter(
      async (view) => {
        const server = opts.server();
        if (!server) {
          opts.onStatus({ state: 'off' });
          return [];
        }

        const doc = view.state.doc;
        const diagrams = findDiagrams(doc.toString(), view.state.facet(docKindFacet));
        if (diagrams.length === 0) {
          opts.onStatus({ state: 'off' });
          return [];
        }

        const results = await Promise.allSettled(
          diagrams.map(async (d) => {
            const { body, lineOffset } = plantUmlBody(d.source);
            const err = await check(body, server);
            return err ? toDiagnostic(doc, d, err, lineOffset) : null;
          }),
        );

        // Dokument se mezitim mohl zmenit - lint pak stejne pobezi znovu
        if (view.state.doc !== doc) return [];

        if (results.every((r) => r.status === 'rejected')) {
          opts.onStatus({ state: 'unreachable' });
          return [];
        }

        const found = results.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
        opts.onStatus(
          found.length === 0
            ? { state: 'ok', diagrams: diagrams.length }
            : { state: 'errors', count: found.length, firstLine: doc.lineAt(found[0].from).number },
        );
        return found;
      },
      {
        delay: 1000,
        // Ulozit jako s jinou priponou meni druh dokumentu, ne text
        needsRefresh: (u) => u.startState.facet(docKindFacet) !== u.state.facet(docKindFacet),
      },
    ),
  ];
}

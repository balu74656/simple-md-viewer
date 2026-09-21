/**
 * Hledani v dokumentu.
 *
 * View rezim pouziva CSS Custom Highlight API - nezasahuje do DOM,
 * takze nerozbije uz vyrenderovane SVG diagramy ani KaTeX vystup.
 * WebView2 na Win10/11 i Chrome 105+ ho podporuji; bez nej zustane
 * funkcni skok na vyskyt, jen bez zvyrazneni.
 */

import type { EditorHandle } from './editor';

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

const highlightRegistry: HighlightRegistry | null =
  typeof CSS !== 'undefined' && 'highlights' in CSS
    ? ((CSS as unknown as { highlights: HighlightRegistry }).highlights)
    : null;

const HighlightCtor: (new (...ranges: Range[]) => unknown) | null =
  typeof (globalThis as { Highlight?: unknown }).Highlight === 'function'
    ? ((globalThis as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight)
    : null;

export interface FindElements {
  bar: HTMLElement;
  input: HTMLInputElement;
  count: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  close: HTMLButtonElement;
}

export interface FindHost {
  /** Aktualni rezim rozhoduje, kde se hleda. */
  getMode(): 'view' | 'edit' | 'split';
  /** Nahled aktivniho tabu - meni se pri prepnuti. */
  preview(): HTMLElement;
  previewScroller: HTMLElement;
  editor: EditorHandle;
}

export interface FindState {
  open: boolean;
  query: string;
}

export function createFind(els: FindElements, host: FindHost) {
  let ranges: Range[] = [];
  let editorHits: number[] = [];
  let index = -1;
  let query = '';

  function clearHighlights(): void {
    highlightRegistry?.delete('md-find');
    highlightRegistry?.delete('md-find-current');
  }

  function searchTarget(): 'preview' | 'editor' {
    // Ve split rezimu hledame tam, kde je fokus; jinak podle rezimu
    if (host.getMode() === 'edit') return 'editor';
    if (host.getMode() === 'view') return 'preview';
    return host.editor.hasFocus() ? 'editor' : 'preview';
  }

  function collectPreviewRanges(q: string): Range[] {
    const out: Range[] = [];
    if (!q) return out;
    const needle = q.toLowerCase();
    const walker = document.createTreeWalker(host.preview(), NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = (node as Text).parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        // Uvnitr SVG a KaTeX MathML by zvyraznovani jen matlo
        if (parent.closest('svg, .katex-mathml, .render-error')) return NodeFilter.FILTER_REJECT;
        return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });

    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = (node.nodeValue ?? '').toLowerCase();
      let from = 0;
      for (;;) {
        const at = text.indexOf(needle, from);
        if (at === -1) break;
        const r = document.createRange();
        r.setStart(node, at);
        r.setEnd(node, at + needle.length);
        out.push(r);
        from = at + needle.length;
      }
    }
    return out;
  }

  function collectEditorHits(q: string): number[] {
    const out: number[] = [];
    if (!q) return out;
    const hay = host.editor.getValue().toLowerCase();
    const needle = q.toLowerCase();
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at === -1) break;
      out.push(at);
      from = at + needle.length;
    }
    return out;
  }

  function total(): number {
    return searchTarget() === 'editor' ? editorHits.length : ranges.length;
  }

  function paint(): void {
    els.count.textContent = total() === 0 ? (query ? '0/0' : '') : `${index + 1}/${total()}`;
    els.bar.classList.toggle('no-match', Boolean(query) && total() === 0);

    if (searchTarget() !== 'preview' || !highlightRegistry || !HighlightCtor) return;
    clearHighlights();
    if (ranges.length === 0) return;

    const others = ranges.filter((_, i) => i !== index);
    if (others.length) highlightRegistry.set('md-find', new HighlightCtor(...others));
    if (index >= 0) highlightRegistry.set('md-find-current', new HighlightCtor(ranges[index]));
  }

  function scrollToCurrent(): void {
    if (index < 0) return;
    if (searchTarget() === 'editor') {
      const start = editorHits[index];
      host.editor.selectRange(start, start + query.length);
      return;
    }
    const rect = ranges[index]?.getBoundingClientRect();
    if (!rect) return;
    const hostRect = host.previewScroller.getBoundingClientRect();
    const delta = rect.top - hostRect.top - host.previewScroller.clientHeight / 3;
    host.previewScroller.scrollTop += delta;
  }

  function run(q: string, keepIndex = false): void {
    query = q;
    ranges = collectPreviewRanges(q);
    editorHits = collectEditorHits(q);
    const n = total();
    if (n === 0) index = -1;
    else if (!keepIndex || index < 0 || index >= n) index = 0;
    paint();
    scrollToCurrent();
  }

  function step(delta: number): void {
    const n = total();
    if (n === 0) return;
    index = (index + delta + n) % n;
    paint();
    scrollToCurrent();
  }

  function open(): void {
    els.bar.hidden = false;
    els.input.focus();
    els.input.select();
    if (els.input.value) run(els.input.value);
  }

  function close(): void {
    els.bar.hidden = true;
    clearHighlights();
    ranges = [];
    editorHits = [];
    index = -1;
    query = '';
  }

  /** Po novem renderu jsou stare Range neplatne. */
  function refresh(): void {
    if (els.bar.hidden || !query) return;
    run(query, true);
  }

  els.input.addEventListener('input', () => run(els.input.value));
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  els.next.addEventListener('click', () => step(1));
  els.prev.addEventListener('click', () => step(-1));
  els.close.addEventListener('click', close);

  return {
    open,
    close,
    refresh,
    isOpen: () => !els.bar.hidden,

    /** Stav pro ulozeni do tabu. */
    getState(): FindState {
      return { open: !els.bar.hidden, query: els.input.value };
    },

    /** Obnova stavu po prepnuti tabu - matche se pocitaji znovu. */
    restore(s: FindState): void {
      els.input.value = s.query;
      if (!s.open) {
        close();
        return;
      }
      els.bar.hidden = false;
      if (s.query) run(s.query);
      else paint();
    },
  };
}

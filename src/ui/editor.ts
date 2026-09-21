import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { tags as t } from '@lezer/highlight';

export interface EditorHandle {
  /** Novy stav pro dalsi tab. Stav nese obsah i undo historii. */
  createState(doc: string): EditorState;
  getState(): EditorState;
  /** Prepne editor na stav jineho tabu. */
  setState(state: EditorState): void;

  getValue(): string;
  focus(): void;
  hasFocus(): boolean;
  /** Element, ktery skutecne scrolluje - pro synchronizaci se nahledem. */
  scrollDOM: HTMLElement;
  getScroll(): number;
  setScroll(top: number): void;

  setTheme(theme: 'light' | 'dark'): void;
  setLineWrapping(on: boolean): void;
  selectRange(from: number, to: number): void;
  stats(): { lines: number; chars: number; words: number };
  refresh(): void;
}

/* ------------------------------------------------------------------ */
/* Motiv                                                               */
/* ------------------------------------------------------------------ */

// Barvy jdou pres CSS promenne aplikace, takze editor se prepina
// spolu se zbytkem UI a nepotrebuje dve sady definic.
const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: 'var(--bg-sunken)',
    color: 'var(--fg)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
    overflow: 'auto',
  },
  '.cm-content': { padding: '14px 0 40vh' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-sunken)',
    color: 'var(--fg-muted)',
    border: 'none',
    borderRight: '1px solid var(--border-soft)',
    paddingRight: '4px',
    minWidth: '44px',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  // Prubezne barvy (aktivni radek, vyber, zavorky) jsou ve styles.css,
  // aby mohly mit fallback pro WebView2 bez podpory color-mix().
});

const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, color: 'var(--fg)', fontWeight: '700', fontSize: '1.35em' },
  { tag: t.heading2, color: 'var(--fg)', fontWeight: '700', fontSize: '1.2em' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], color: 'var(--fg)', fontWeight: '600' },
  { tag: t.strong, fontWeight: '700', color: 'var(--fg)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--fg-muted)' },
  { tag: t.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--accent)' },
  { tag: t.monospace, color: 'var(--hl-string)' },
  { tag: t.quote, color: 'var(--fg-muted)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--hl-number)' },
  { tag: t.contentSeparator, color: 'var(--hl-keyword)' },
  // Znacky samotne (##, **, ```) drzime potlacene, at nerusi cteni
  { tag: t.processingInstruction, color: 'var(--fg-muted)', opacity: '0.7' },
  // Zvyrazneni uvnitr fenced bloku
  { tag: t.keyword, color: 'var(--hl-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--hl-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--hl-number)' },
  { tag: t.comment, color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.labelName], color: 'var(--hl-function)' },
  { tag: [t.typeName, t.className, t.standard(t.name)], color: 'var(--hl-type)' },
  { tag: [t.attributeName, t.propertyName], color: 'var(--hl-attr)' },
]);

/* ------------------------------------------------------------------ */

export function createEditor(parent: HTMLElement, onChange: () => void): EditorHandle {
  const themeCompartment = new Compartment();
  const wrapCompartment = new Compartment();

  // Compartment patri stavu, ne pohledu. Kazdy tab ma vlastni stav, takze
  // si aktualni motiv a zalamovani drzime tady a po kazdem prepnuti tabu
  // je do noveho stavu znovu vlozime.
  let theme: 'light' | 'dark' = 'light';
  let wrap = true;
  let suppress = false;

  function extensions(): Extension[] {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      rectangularSelection(),
      indentOnInput(),
      bracketMatching(),
      // Bez searchKeymap - Ctrl+F obsluhuje panel aplikace, ne CodeMirror
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(mdHighlight),
      baseTheme,
      themeCompartment.of(EditorView.theme({}, { dark: theme === 'dark' })),
      wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !suppress) onChange();
      }),
    ];
  }

  function createState(doc: string): EditorState {
    return EditorState.create({ doc, extensions: extensions() });
  }

  const view = new EditorView({ parent, state: createState('') });

  function applyCompartments(): void {
    view.dispatch({
      effects: [
        themeCompartment.reconfigure(EditorView.theme({}, { dark: theme === 'dark' })),
        wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []),
      ],
    });
  }

  return {
    createState,
    getState: () => view.state,

    setState(state: EditorState) {
      suppress = true;
      view.setState(state);
      // Stav noveho tabu si nese compartmenty z doby sveho vzniku,
      // proto je srovname s aktualnim nastavenim.
      applyCompartments();
      suppress = false;
    },

    getValue: () => view.state.doc.toString(),
    focus: () => view.focus(),
    hasFocus: () => view.hasFocus,
    scrollDOM: view.scrollDOM,
    getScroll: () => view.scrollDOM.scrollTop,
    setScroll(top: number) {
      view.scrollDOM.scrollTop = top;
    },

    setTheme(next) {
      theme = next;
      applyCompartments();
    },

    setLineWrapping(on) {
      wrap = on;
      applyCompartments();
    },

    selectRange(from, to) {
      view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
      view.focus();
    },

    stats() {
      const text = view.state.doc.toString();
      return {
        lines: view.state.doc.lines,
        chars: text.length,
        words: text.trim() ? text.trim().split(/\s+/).length : 0,
      };
    },

    /** Po prepnuti z rezimu, kde byl editor skryty, je nutne premerit. */
    refresh() {
      view.requestMeasure();
    },
  };
}

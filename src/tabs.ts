import type { EditorState } from '@codemirror/state';
import type { Mode } from './settings';

export interface Tab {
  id: string;
  path: string | null;
  /** Obsah tak, jak je na disku - proti nemu se pozna zmena. */
  savedContent: string;
  /** Konce radku puvodniho souboru zustavaji zachovane. */
  crlf: boolean;
  dirty: boolean;
  mode: Mode;
  /** Stav CodeMirroru: obsah i undo historie patri tabu. */
  editorState: EditorState;
  /** Vlastni uzel nahledu - prepnuti tabu tak nevyzaduje prekresleni. */
  previewEl: HTMLElement;
  previewScroll: number;
  editorScroll: number;
  find: { open: boolean; query: string };
}

export interface TabInit {
  path: string | null;
  savedContent: string;
  crlf: boolean;
  mode: Mode;
  editorState: EditorState;
}

export interface TabsOptions {
  list: HTMLElement;
  /** Kontejner, do ktereho se vkladaji uzly nahledu jednotlivych tabu. */
  previewHost: HTMLElement;
  onActivate(tab: Tab, previous: Tab | null): void;
  /** Vraci true, kdyz se tab smi zavrit (potvrzeni neulozenych zmen). */
  onRequestClose(tab: Tab): Promise<boolean>;
  /** Zavren posledni tab. */
  onEmpty(): void;
}

let seq = 0;

/** Windows nerozlisuje velikost pismen ani smer lomitek. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

export function tabTitle(tab: Tab): string {
  if (!tab.path) return 'Bez názvu';
  return tab.path.split(/[\\/]/).pop() || tab.path;
}

export function createTabs(o: TabsOptions) {
  const tabs: Tab[] = [];
  let activeId: string | null = null;

  function active(): Tab | null {
    return tabs.find((t) => t.id === activeId) ?? null;
  }

  function indexOf(id: string): number {
    return tabs.findIndex((t) => t.id === id);
  }

  /* ---------------- lista ---------------- */

  function renderBar(): void {
    o.list.replaceChildren();

    for (const tab of tabs) {
      const el = document.createElement('div');
      el.className = 'tab';
      el.dataset.id = tab.id;
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', String(tab.id === activeId));
      el.classList.toggle('active', tab.id === activeId);
      el.classList.toggle('dirty', tab.dirty);
      el.title = tab.path ?? 'Neuložený dokument';

      const dot = document.createElement('span');
      dot.className = 'tab-dot';
      dot.setAttribute('aria-hidden', 'true');

      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = tabTitle(tab);

      const close = document.createElement('button');
      close.className = 'tab-close';
      close.type = 'button';
      close.setAttribute('aria-label', `Zavřít ${tabTitle(tab)}`);
      close.textContent = '×';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        void close_(tab.id);
      });

      el.append(dot, title, close);
      el.addEventListener('click', () => activate(tab.id));
      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          void close_(tab.id);
        }
      });

      o.list.appendChild(el);
    }

    o.list.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // Lista se skryje, dokud je otevreny jen jeden dokument
    o.list.parentElement?.toggleAttribute('hidden', tabs.length < 2);
  }

  /* ---------------- operace ---------------- */

  function add(init: TabInit, activateIt = true): Tab {
    const previewEl = document.createElement('article');
    previewEl.className = 'markdown-body';
    previewEl.hidden = true;
    o.previewHost.appendChild(previewEl);

    const tab: Tab = {
      id: `t${++seq}`,
      path: init.path,
      savedContent: init.savedContent,
      crlf: init.crlf,
      dirty: false,
      mode: init.mode,
      editorState: init.editorState,
      previewEl,
      previewScroll: 0,
      editorScroll: 0,
      find: { open: false, query: '' },
    };

    tabs.push(tab);
    if (activateIt) activate(tab.id);
    else renderBar();
    return tab;
  }

  function activate(id: string): void {
    if (id === activeId) return;
    const next = tabs.find((t) => t.id === id);
    if (!next) return;

    const previous = active();
    activeId = id;

    if (previous) previous.previewEl.hidden = true;
    next.previewEl.hidden = false;

    renderBar();
    o.onActivate(next, previous);
  }

  async function close_(id: string): Promise<boolean> {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return false;

    if (tab.dirty && !(await o.onRequestClose(tab))) return false;

    const at = indexOf(id);
    tabs.splice(at, 1);
    tab.previewEl.remove();

    if (tabs.length === 0) {
      activeId = null;
      renderBar();
      o.onEmpty();
      return true;
    }

    if (activeId === id) {
      // Prebira sousedni tab vpravo, jinak vlevo
      const nextTab = tabs[Math.min(at, tabs.length - 1)];
      activeId = null;
      activate(nextTab.id);
    } else {
      renderBar();
    }
    return true;
  }

  return {
    list: () => tabs,
    active,
    add,
    activate,
    close: close_,
    renderBar,

    byPath(path: string): Tab | null {
      const want = normalizePath(path);
      return tabs.find((t) => t.path && normalizePath(t.path) === want) ?? null;
    },

    /** Posun o delta s prechodem pres okraj. */
    cycle(delta: number): void {
      if (tabs.length < 2 || !activeId) return;
      const at = indexOf(activeId);
      const to = (at + delta + tabs.length) % tabs.length;
      activate(tabs[to].id);
    },

    /** index 0-7, nebo -1 pro posledni. */
    goto(index: number): void {
      const tab = index < 0 ? tabs[tabs.length - 1] : tabs[index];
      if (tab) activate(tab.id);
    },

    dirtyCount(): number {
      return tabs.filter((t) => t.dirty).length;
    },
  };
}

export type TabsController = ReturnType<typeof createTabs>;

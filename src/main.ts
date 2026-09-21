import './styles.css';

import { renderMarkdown } from './render/markdown';
import { postProcess, resetMermaidTheme, type RenderToken } from './render/postprocess';
import {
  closeWindow,
  confirmDiscard,
  confirmDiscardAll,
  isTauri,
  onCloseRequested,
  onOpenFile,
  pickOpenPath,
  pickSavePath,
  readFile,
  setWindowTitle,
  takePendingFile,
  writeFile,
} from './fs/bridge';
import { getSettings, normalizeServerUrl, updateSettings, type Mode } from './settings';
import { applyTheme, onSystemThemeChange, resolveTheme } from './ui/theme';
import { createToc } from './ui/toc';
import { createFind } from './ui/find';
import { createEditor } from './ui/editor';
import { createTabs, tabTitle, type Tab, type TabsController } from './tabs';

/* ------------------------------------------------------------------ */
/* DOM                                                                 */
/* ------------------------------------------------------------------ */

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Chybí element ${sel}`);
  return el;
};

const workspace = $<HTMLElement>('#workspace');
const viewPane = $<HTMLElement>('#view-pane');
const tocPane = $<HTMLElement>('#toc');
const tocList = $<HTMLElement>('#toc-list');
const filenameEl = $<HTMLElement>('#filename');
const statusLeft = $<HTMLElement>('#status-left');
const statusRight = $<HTMLElement>('#status-right');
const btnSave = $<HTMLButtonElement>('#btn-save');
const settingsDialog = $<HTMLDialogElement>('#settings-dialog');

/* ------------------------------------------------------------------ */
/* Jadro: editor, osnova, hledani, taby                                */
/* ------------------------------------------------------------------ */

const editor = createEditor($<HTMLElement>('#editor'), onEditorChange);
const toc = createToc(viewPane, tocList);

const find = createFind(
  {
    bar: $('#findbar'),
    input: $('#find-input'),
    count: $('#find-count'),
    prev: $('#find-prev'),
    next: $('#find-next'),
    close: $('#find-close'),
  },
  {
    getMode: () => tabs.active()?.mode ?? 'view',
    preview: () => tabs.active()?.previewEl ?? viewPane,
    previewScroller: viewPane,
    editor,
  },
);

const tabs: TabsController = createTabs({
  list: $('#tab-list'),
  previewHost: viewPane,
  onActivate,
  onRequestClose: (tab) => confirmDiscard(tabTitle(tab)),
  onEmpty: () => void closeWindow(),
});

/** Obsah, pro ktery je nahled tabu aktualni. */
const renderedFor = new WeakMap<Tab, string>();

let renderToken: RenderToken = { cancelled: false };
let renderTimer: number | undefined;

/* ------------------------------------------------------------------ */
/* Prepinani tabu                                                      */
/* ------------------------------------------------------------------ */

/** Ulozi zivy stav editoru a scrollu zpet do tabu, ze ktereho odchazime. */
function capture(tab: Tab): void {
  tab.editorState = editor.getState();
  tab.editorScroll = editor.getScroll();
  tab.previewScroll = viewPane.scrollTop;
  tab.find = find.getState();
}

function onActivate(tab: Tab, previous: Tab | null): void {
  if (previous) capture(previous);

  editor.setState(tab.editorState);
  applyModeUI(tab.mode);
  updateChrome();

  if (renderedFor.get(tab) !== editor.getValue()) {
    void render();
  } else {
    toc.rebuild(tab.previewEl);
  }

  // Scroll az po rozlozeni - skryty uzel nema vysku
  requestAnimationFrame(() => {
    editor.setScroll(tab.editorScroll);
    viewPane.scrollTop = tab.previewScroll;
    find.restore(tab.find);
  });
}

/* ------------------------------------------------------------------ */
/* Stav aktivniho tabu                                                 */
/* ------------------------------------------------------------------ */

function onEditorChange(): void {
  const tab = tabs.active();
  if (!tab) return;
  setDirty(tab, editor.getValue() !== tab.savedContent);
  updateStats();
  scheduleRender();
}

function setDirty(tab: Tab, dirty: boolean): void {
  if (tab.dirty === dirty) {
    updateChrome();
    return;
  }
  tab.dirty = dirty;
  tabs.renderBar();
  updateChrome();
}

function updateChrome(): void {
  const tab = tabs.active();
  if (!tab) return;
  const name = tabTitle(tab);
  const mark = tab.dirty ? '• ' : '';
  filenameEl.textContent = `${mark}${name}`;
  filenameEl.title = tab.path ?? '';
  btnSave.disabled = !tab.dirty;
  document.body.dataset.clean = tabs.dirtyCount() ? '' : '1';
  void setWindowTitle(`${mark}${name} — MD Viewer`);
  updateStats();
}

function updateStats(): void {
  const { lines, words, chars } = editor.stats();
  statusRight.textContent = `${lines} řádků · ${words} slov · ${chars} znaků`;
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

async function render(): Promise<void> {
  const tab = tabs.active();
  if (!tab) return;

  renderToken.cancelled = true;
  const token: RenderToken = { cancelled: false };
  renderToken = token;

  const settings = getSettings();
  const source = editor.getValue();
  const target = tab.previewEl;
  const t0 = performance.now();

  try {
    const { html, blocks } = renderMarkdown(source);
    if (token.cancelled) return;
    target.innerHTML = html;
    renderedFor.set(tab, source);

    if (tabs.active() === tab) toc.rebuild(target);

    await postProcess(
      target,
      blocks,
      {
        theme: resolveTheme(settings.theme),
        plantumlServer: normalizeServerUrl(settings.plantumlServer),
        plantumlFormat: settings.plantumlFormat,
      },
      token,
    );
    if (token.cancelled) return;

    if (tabs.active() === tab) {
      toc.rebuild(target);
      find.refresh();
    }
    statusLeft.textContent = `render ${Math.round(performance.now() - t0)} ms`;
  } catch (e) {
    target.innerHTML = `<div class="render-error"><strong>Chyba renderu</strong><pre>${String(e)}</pre></div>`;
    statusLeft.textContent = 'chyba renderu';
  }
}

function scheduleRender(delay = 180): void {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => void render(), delay);
}

/* ------------------------------------------------------------------ */
/* Rezimy                                                              */
/* ------------------------------------------------------------------ */

function applyModeUI(mode: Mode): void {
  workspace.dataset.mode = mode;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#mode-switch button')) {
    b.classList.toggle('active', b.dataset.mode === mode);
  }
  if (mode !== 'view') {
    // CodeMirror si musi premerit rozmery, jakmile je pane viditelny
    requestAnimationFrame(() => {
      editor.refresh();
      editor.focus();
    });
  }
}

function setMode(mode: Mode): void {
  const tab = tabs.active();
  if (!tab) return;
  tab.mode = mode;
  applyModeUI(mode);
}

function toggleViewEdit(): void {
  const mode = tabs.active()?.mode ?? 'view';
  setMode(mode === 'view' ? 'edit' : 'view');
}

function toggleSplit(): void {
  const mode = tabs.active()?.mode ?? 'view';
  setMode(mode === 'split' ? 'view' : 'split');
}

function toggleToc(): void {
  const open = tocPane.hidden;
  tocPane.hidden = !open;
  updateSettings({ tocOpen: open });
  const tab = tabs.active();
  if (open && tab) toc.rebuild(tab.previewEl);
}

/* ------------------------------------------------------------------ */
/* Synchronni scroll ve split rezimu                                   */
/* ------------------------------------------------------------------ */

let syncing = false;

function ratio(el: HTMLElement): number {
  const max = el.scrollHeight - el.clientHeight;
  return max <= 0 ? 0 : el.scrollTop / max;
}

function applyRatio(el: HTMLElement, r: number): void {
  const max = el.scrollHeight - el.clientHeight;
  el.scrollTop = Math.max(0, r * max);
}

function linkScroll(from: HTMLElement, to: HTMLElement): void {
  from.addEventListener('scroll', () => {
    if (tabs.active()?.mode !== 'split' || syncing) return;
    syncing = true;
    applyRatio(to, ratio(from));
    requestAnimationFrame(() => {
      syncing = false;
    });
  });
}

linkScroll(editor.scrollDOM, viewPane);
linkScroll(viewPane, editor.scrollDOM);

/* ------------------------------------------------------------------ */
/* Soubory a taby                                                      */
/* ------------------------------------------------------------------ */

function newTab(content: string, init?: { path?: string; crlf?: boolean }): Tab {
  return tabs.add({
    path: init?.path ?? null,
    savedContent: content,
    crlf: init?.crlf ?? false,
    mode: getSettings().defaultMode,
    editorState: editor.createState(content),
  });
}

async function openPath(path: string): Promise<void> {
  // Tentyz soubor nechceme mit ve dvou tabech - druhy by po ulozeni
  // prvniho drzel zastaraly obsah.
  const existing = tabs.byPath(path);
  if (existing) {
    tabs.activate(existing.id);
    statusLeft.textContent = `${tabTitle(existing)} už je otevřený`;
    return;
  }

  try {
    const file = await readFile(path);
    newTab(file.content, { path: file.path, crlf: file.crlf });
    if (file.lossy) {
      statusLeft.textContent =
        'Pozor: soubor není validní UTF-8, část znaků se nemusí zobrazit správně.';
    }
  } catch (e) {
    statusLeft.textContent = `Nepodařilo se otevřít: ${String(e)}`;
  }
}

async function openFileDialog(): Promise<void> {
  try {
    const path = await pickOpenPath();
    if (path) await openPath(path);
  } catch (e) {
    statusLeft.textContent = String(e);
  }
}

async function saveFile(saveAs = false): Promise<void> {
  const tab = tabs.active();
  if (!tab) return;

  let target = tab.path;
  if (!target || saveAs) {
    target = await pickSavePath(target ?? 'dokument.md');
    if (!target) return;
  }

  try {
    const content = editor.getValue();
    await writeFile(target, content, tab.crlf);
    tab.path = target;
    tab.savedContent = content;
    setDirty(tab, false);
    tabs.renderBar();
    statusLeft.textContent = `Uloženo ${new Date().toLocaleTimeString('cs-CZ')}`;
  } catch (e) {
    statusLeft.textContent = `Uložení selhalo: ${String(e)}`;
  }
}

async function closeActiveTab(): Promise<void> {
  const tab = tabs.active();
  if (tab) await tabs.close(tab.id);
}

/* ------------------------------------------------------------------ */
/* Nastaveni                                                           */
/* ------------------------------------------------------------------ */

function openSettings(): void {
  const s = getSettings();
  $<HTMLInputElement>('#set-puml').value = s.plantumlServer;
  $<HTMLSelectElement>('#set-puml-format').value = s.plantumlFormat;
  $<HTMLSelectElement>('#set-mode').value = s.defaultMode;
  $<HTMLSelectElement>('#set-theme').value = s.theme;
  $<HTMLInputElement>('#set-wrap').checked = s.lineWrap;
  settingsDialog.showModal();
}

settingsDialog.addEventListener('close', () => {
  if (settingsDialog.returnValue !== 'save') return;
  updateSettings({
    plantumlServer: normalizeServerUrl($<HTMLInputElement>('#set-puml').value),
    plantumlFormat: $<HTMLSelectElement>('#set-puml-format').value as 'svg' | 'png',
    defaultMode: $<HTMLSelectElement>('#set-mode').value as Mode,
    theme: $<HTMLSelectElement>('#set-theme').value as 'auto' | 'light' | 'dark',
    lineWrap: $<HTMLInputElement>('#set-wrap').checked,
  });
  const s = getSettings();
  editor.setTheme(applyTheme(s.theme));
  editor.setLineWrapping(s.lineWrap);
  resetMermaidTheme();
  invalidateAllPreviews();
  void render();
});

function cycleTheme(): void {
  const order = ['auto', 'light', 'dark'] as const;
  const next = order[(order.indexOf(getSettings().theme) + 1) % order.length];
  updateSettings({ theme: next });
  editor.setTheme(applyTheme(next));
  resetMermaidTheme();
  invalidateAllPreviews();
  statusLeft.textContent = `Motiv: ${next}`;
  void render();
}

/** Po zmene motivu nebo PlantUML serveru je nahled kazdeho tabu zastaraly. */
function invalidateAllPreviews(): void {
  for (const tab of tabs.list()) renderedFor.delete(tab);
}

/* ------------------------------------------------------------------ */
/* Udalosti                                                            */
/* ------------------------------------------------------------------ */

$('#btn-open').addEventListener('click', () => void openFileDialog());
$('#btn-save').addEventListener('click', () => void saveFile());
$('#btn-toc').addEventListener('click', toggleToc);
$('#btn-find').addEventListener('click', () => find.open());
$('#btn-theme').addEventListener('click', cycleTheme);
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-newtab').addEventListener('click', () => newTab(''));

for (const b of document.querySelectorAll<HTMLButtonElement>('#mode-switch button')) {
  b.addEventListener('click', () => setMode(b.dataset.mode as Mode));
}

// Capture faze: zkratky aplikace maji prednost pred klavesovou mapou
// CodeMirroru, jinak by si Ctrl+F odchytil editor.
window.addEventListener(
  'keydown',
  (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) {
      if (e.key === 'Escape' && find.isOpen()) find.close();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      tabs.cycle(e.shiftKey ? -1 : 1);
      return;
    }

    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      tabs.goto(e.key === '9' ? -1 : Number(e.key) - 1);
      return;
    }

    switch (e.key.toLowerCase()) {
      case 's':
        e.preventDefault();
        void saveFile(e.shiftKey);
        break;
      case 'o':
        e.preventDefault();
        if (e.shiftKey) toggleToc();
        else void openFileDialog();
        break;
      case 't':
        e.preventDefault();
        newTab('');
        break;
      case 'w':
        e.preventDefault();
        void closeActiveTab();
        break;
      case 'e':
        e.preventDefault();
        toggleViewEdit();
        break;
      case '\\':
        e.preventDefault();
        toggleSplit();
        break;
      case 'f':
        e.preventDefault();
        find.open();
        break;
    }
  },
  { capture: true },
);

// Odkazy na externi weby otevrit v systemovem prohlizeci, ne ve webview
viewPane.addEventListener('click', (e) => {
  const link = (e.target as HTMLElement).closest('a');
  if (!link) return;
  const href = link.getAttribute('href') ?? '';
  if (href.startsWith('#')) {
    e.preventDefault();
    tabs.active()?.previewEl.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)
      ?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (/^https?:/i.test(href) && isTauri) {
    e.preventDefault();
    void (async () => {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(href);
    })();
  }
});

onSystemThemeChange(() => {
  if (getSettings().theme !== 'auto') return;
  editor.setTheme(applyTheme('auto'));
  resetMermaidTheme();
  invalidateAllPreviews();
  void render();
});

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

const WELCOME = `# MD Viewer

Otevři soubor přes **Otevřít** (\`Ctrl+O\`), nebo si aplikaci nastav ve Windows
jako výchozí pro \`.md\` soubory a otevírej je dvojklikem.

## Klávesové zkratky

| Zkratka | Akce |
|---|---|
| \`Ctrl+O\` | Otevřít soubor v novém tabu |
| \`Ctrl+T\` | Nový prázdný tab |
| \`Ctrl+W\` | Zavřít tab |
| \`Ctrl+Tab\` | Další tab (se Shiftem předchozí) |
| \`Ctrl+1\`–\`8\`, \`Ctrl+9\` | Skok na N-tý / poslední tab |
| \`Ctrl+S\` | Uložit |
| \`Ctrl+Shift+S\` | Uložit jako |
| \`Ctrl+E\` | Přepnout View / Edit |
| \`Ctrl+\\\\\` | Přepnout Split |
| \`Ctrl+F\` | Hledat |
| \`Ctrl+Shift+O\` | Osnova |

## Co umí náhled

- GFM: tabulky, ~~škrtnutí~~, task listy
- Zvýraznění syntaxe v blocích kódu
- Mermaid diagramy
- PlantUML přes vlastní server
- Matematiku v \`$…$\` a \`$$…$$\`
`;

async function init(): Promise<void> {
  const s = getSettings();
  editor.setTheme(applyTheme(s.theme));
  editor.setLineWrapping(s.lineWrap);
  tocPane.hidden = !s.tocOpen;

  await onOpenFile((path) => void openPath(path));

  await onCloseRequested(async () => {
    const dirty = tabs.dirtyCount();
    if (dirty === 0) return true;
    return await confirmDiscardAll(dirty);
  });

  const pending = await takePendingFile();
  if (pending) {
    await openPath(pending);
    // Kdyby se soubor nepodarilo nacist, at uzivatel nezustane s prazdnym oknem
    if (tabs.list().length === 0) newTab(WELCOME);
  } else {
    newTab(WELCOME);
  }
}

void init();

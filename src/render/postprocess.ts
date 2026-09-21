import { plantUmlUrl } from './plantuml';
import type { DeferredBlock } from './markdown';

export interface PostOptions {
  theme: 'light' | 'dark';
  plantumlServer: string;
  plantumlFormat: 'svg' | 'png';
}

/** Token pro zruseni zastaraleho renderu (uzivatel mezitim napsal dalsi znak). */
export interface RenderToken {
  cancelled: boolean;
}

type Blocks = Map<string, DeferredBlock>;

let mermaidMod: typeof import('mermaid') | null = null;
let katexMod: typeof import('katex') | null = null;
let mermaidTheme: string | null = null;
let mermaidSeq = 0;

function escape(s: string): string {
  return s.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));
}

function showError(node: HTMLElement, message: string, detail?: string): void {
  node.classList.remove('deferred');
  node.innerHTML =
    `<div class="render-error"><strong>${escape(message)}</strong>` +
    (detail ? `<pre>${escape(detail)}</pre>` : '') +
    '</div>';
}

function collect(root: HTMLElement, cls: string, blocks: Blocks) {
  return Array.from(root.querySelectorAll<HTMLElement>(`.${cls}`)).map((node) => ({
    node,
    block: blocks.get(node.dataset.block ?? ''),
  }));
}

/* ------------------------------------------------------------------ */
/* KaTeX                                                               */
/* ------------------------------------------------------------------ */

async function renderMath(root: HTMLElement, blocks: Blocks, token: RenderToken): Promise<void> {
  const items = collect(root, 'math-placeholder', blocks);
  if (items.length === 0) return;

  if (!katexMod) {
    katexMod = await import('katex');
    await import('katex/dist/katex.min.css');
  }
  if (token.cancelled) return;

  const katex = katexMod.default;

  for (const { node, block } of items) {
    if (!block) continue;
    const displayMode = block.kind === 'math-block';
    try {
      node.innerHTML = katex.renderToString(block.source, {
        displayMode,
        throwOnError: false,
        output: 'htmlAndMathml',
        strict: false,
      });
      node.classList.remove('math-placeholder', 'deferred');
      node.classList.add(displayMode ? 'math-block' : 'math-inline');
    } catch (e) {
      showError(node, 'Chyba KaTeX', String(e));
    }
  }
}

/* ------------------------------------------------------------------ */
/* Mermaid                                                             */
/* ------------------------------------------------------------------ */

async function renderMermaid(
  root: HTMLElement,
  blocks: Blocks,
  opts: PostOptions,
  token: RenderToken,
): Promise<void> {
  const items = collect(root, 'mermaid-placeholder', blocks);
  if (items.length === 0) return;

  if (!mermaidMod) {
    mermaidMod = await import('mermaid');
  }
  if (token.cancelled) return;

  const mermaid = mermaidMod.default;
  const wanted = opts.theme === 'dark' ? 'dark' : 'default';
  if (mermaidTheme !== wanted) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: wanted });
    mermaidTheme = wanted;
  }

  for (const { node, block } of items) {
    if (!block) continue;
    const id = `mermaid-render-${++mermaidSeq}`;
    try {
      const { svg } = await mermaid.render(id, block.source);
      if (token.cancelled) return;
      node.innerHTML = svg;
      node.classList.remove('mermaid-placeholder', 'deferred');
      node.classList.add('mermaid-figure');
    } catch (e) {
      // Mermaid si pri chybe nekdy nechava v DOM docasny element
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
      node.classList.remove('mermaid-placeholder');
      showError(node, 'Chyba v Mermaid diagramu', String(e));
    }
  }
}

/* ------------------------------------------------------------------ */
/* PlantUML                                                            */
/* ------------------------------------------------------------------ */

function renderPlantUml(root: HTMLElement, blocks: Blocks, opts: PostOptions): void {
  const items = collect(root, 'puml-placeholder', blocks);
  if (items.length === 0) return;

  for (const { node, block } of items) {
    if (!block) continue;
    node.classList.remove('puml-placeholder', 'deferred');
    node.classList.add('puml-figure');

    const url = plantUmlUrl(block.source, opts.plantumlServer, opts.plantumlFormat);
    if (!url) {
      showError(node, 'PlantUML server není nakonfigurován', 'Doplň URL v Nastavení.');
      continue;
    }

    const img = document.createElement('img');
    img.className = 'puml-img';
    img.alt = 'PlantUML diagram';
    img.loading = 'lazy';
    img.addEventListener('error', () => {
      showError(node, 'PlantUML diagram se nepodařilo načíst', `Server: ${opts.plantumlServer}`);
    });
    img.src = url;
    node.replaceChildren(img);
  }
}

/* ------------------------------------------------------------------ */

/** Dorenderuje vsechny placeholdery. Chyba jednoho typu nezastavi ostatni. */
export async function postProcess(
  root: HTMLElement,
  blocks: Blocks,
  opts: PostOptions,
  token: RenderToken,
): Promise<void> {
  renderPlantUml(root, blocks, opts);
  const results = await Promise.allSettled([
    renderMath(root, blocks, token),
    renderMermaid(root, blocks, opts, token),
  ]);
  for (const r of results) {
    if (r.status === 'rejected') console.error('post-process selhal:', r.reason);
  }
}

/** Vynuti nove nacteni mermaid tematu pri prepnuti svetly/tmavy. */
export function resetMermaidTheme(): void {
  mermaidTheme = null;
}

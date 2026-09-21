import { Marked, type Tokens, type TokenizerAndRendererExtension } from 'marked';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';

export type BlockKind = 'mermaid' | 'plantuml' | 'math-block' | 'math-inline';

export interface DeferredBlock {
  kind: BlockKind;
  source: string;
}

export interface RenderResult {
  html: string;
  /** Zdroje diagramu a vzorcu podle id placeholderu. */
  blocks: Map<string, DeferredBlock>;
}

/* ------------------------------------------------------------------ */
/* Pomocne funkce                                                      */
/* ------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Slug odolny vuci diakritice - "Návrh řešení" -> "navrh-reseni". */
export function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

/* ------------------------------------------------------------------ */
/* Registr odlozenych bloku                                            */
/* ------------------------------------------------------------------ */

/**
 * Zdroje diagramu NESMI cestovat v data-* atributu: DOMPurify 3.1+
 * kvuli ochrane proti mXSS zahazuje atributy obsahujici "-->", coz
 * potka prakticky kazdy mermaid flowchart. Placeholder proto nese jen
 * id a skutecny text si postprocessor vyzvedne z teto mapy.
 */
let blocks = new Map<string, DeferredBlock>();
let blockSeq = 0;

function defer(kind: BlockKind, source: string): string {
  const id = `b${++blockSeq}`;
  blocks.set(id, { kind, source });
  return id;
}

/* ------------------------------------------------------------------ */
/* Math extension: $$blok$$ a $inline$                                  */
/* ------------------------------------------------------------------ */

const mathBlock: TokenizerAndRendererExtension = {
  name: 'mathBlock',
  level: 'block',
  start(src: string) {
    return src.indexOf('$$');
  },
  tokenizer(src: string) {
    const match = /^\$\$([\s\S]+?)\$\$(?:\n+|$)/.exec(src);
    if (!match) return undefined;
    return { type: 'mathBlock', raw: match[0], text: match[1].trim() };
  },
  renderer(token) {
    const id = defer('math-block', token.text as string);
    return `<div class="deferred math-placeholder" data-block="${id}"></div>`;
  },
};

const mathInline: TokenizerAndRendererExtension = {
  name: 'mathInline',
  level: 'inline',
  start(src: string) {
    return src.indexOf('$');
  },
  tokenizer(src: string) {
    // Prisna pravidla, aby "$5 a $10" nebylo matematika:
    // za otviracim $ nesmi byt mezera, pred zaviracim taky ne.
    const match = /^\$(?!\s)((?:[^$\n]|\\\$)+?)(?<!\s)\$(?!\d)/.exec(src);
    if (!match) return undefined;
    return { type: 'mathInline', raw: match[0], text: match[1] };
  },
  renderer(token) {
    const id = defer('math-inline', token.text as string);
    return `<span class="deferred math-placeholder" data-block="${id}"></span>`;
  },
};

/* ------------------------------------------------------------------ */
/* Instance marked                                                     */
/* ------------------------------------------------------------------ */

const DIAGRAM_LANGS = new Set(['plantuml', 'puml', 'uml']);

function buildMarked(): Marked {
  const m = new Marked({ gfm: true, breaks: false });

  m.use({ extensions: [mathBlock, mathInline] });

  const usedSlugs = new Map<string, number>();

  m.use({
    hooks: {
      preprocess(markdown: string) {
        usedSlugs.clear();
        return markdown;
      },
    },
    renderer: {
      code({ text, lang }: Tokens.Code): string {
        const language = (lang ?? '').trim().split(/\s+/)[0].toLowerCase();

        if (language === 'mermaid') {
          return `<div class="deferred mermaid-placeholder" data-block="${defer('mermaid', text)}"></div>`;
        }
        if (DIAGRAM_LANGS.has(language)) {
          return `<div class="deferred puml-placeholder" data-block="${defer('plantuml', text)}"></div>`;
        }

        let body: string;
        let cls = 'hljs';
        if (language && hljs.getLanguage(language)) {
          body = hljs.highlight(text, { language, ignoreIllegals: true }).value;
          cls += ` language-${language}`;
        } else {
          body = escapeHtml(text);
        }
        return `<pre class="code-block"><code class="${cls}">${body}</code></pre>\n`;
      },

      heading(token: Tokens.Heading): string {
        const inner = this.parser.parseInline(token.tokens);
        const base = slugify(token.text);
        const seen = usedSlugs.get(base) ?? 0;
        usedSlugs.set(base, seen + 1);
        const id = seen === 0 ? base : `${base}-${seen}`;
        return `<h${token.depth} id="${id}">${inner}<a class="anchor" href="#${id}" aria-hidden="true">#</a></h${token.depth}>\n`;
      },

      link(token: Tokens.Link): string {
        const inner = this.parser.parseInline(token.tokens);
        const href = token.href ?? '';
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        const external = /^(https?:)?\/\//i.test(href);
        const attrs = external ? ' target="_blank" rel="noreferrer noopener"' : '';
        return `<a href="${escapeHtml(href)}"${title}${attrs}>${inner}</a>`;
      },
    },
  });

  return m;
}

const marked = buildMarked();

/* ------------------------------------------------------------------ */
/* Sanitizace                                                          */
/* ------------------------------------------------------------------ */

// Task listy potrebuji <input type="checkbox">, nic jineho z formularovych
// prvku v dokumentu nechceme. Ostatni inputy proto zahazuje tento hook.
let hookInstalled = false;
function installHooks(): void {
  if (hookInstalled) return;
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName !== 'input') return;
    const el = node as unknown as Element;
    const type = (el.getAttribute?.('type') ?? '').toLowerCase();
    if (type !== 'checkbox') el.remove?.();
  });
  hookInstalled = true;
}

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true, svg: true, mathMl: true },
  ADD_ATTR: ['target', 'id', 'class', 'align', 'colspan', 'rowspan', 'checked', 'disabled', 'type'],
  FORBID_TAGS: ['style', 'form', 'button', 'iframe', 'object', 'embed', 'textarea', 'select'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'srcdoc', 'formaction', 'name'],
};

/** Markdown -> bezpecny HTML + mapa odlozenych bloku k dorenderovani. */
export function renderMarkdown(source: string): RenderResult {
  installHooks();
  blocks = new Map();
  blockSeq = 0;

  const raw = marked.parse(source, { async: false }) as string;
  const html = DOMPurify.sanitize(raw, PURIFY_CONFIG);
  return { html, blocks };
}

import hljs from 'highlight.js/lib/common';
import { renderMarkdown, slugify } from './markdown';
import {
  DataParseError,
  RefResolver,
  isObj,
  isOpenApi,
  looksLikeOpenApi,
  parseData,
  refName,
  type Obj,
} from './openapi-refs';

/**
 * Nahled YAML/JSON souboru. OpenAPI 3.x a Swagger 2.0 se vykresli jako
 * dokumentace ve stylu Swagger UI (jen ke cteni), ostatni data jako
 * zvyrazneny kod.
 *
 * Detaily operaci a schemat se generuji az pri rozbaleni (`data-lazy`):
 * velka specifikace se stovkami operaci a cyklickymi schematy by jinak
 * vyrobila obrovsky DOM. Obsah nedodava DOMPurify - kazdy text ze
 * specifikace jde pres esc(), popisy pres sanitizovany renderMarkdown.
 */

export interface DataRenderResult {
  html: string;
  /** Generatory obsahu rozbalovacich bloku podle `data-lazy`. */
  lazy: Map<string, () => string>;
}

export interface DataRenderOptions {
  /** Cesta souboru ('' u neulozeneho tabu) - pro relativni $ref. */
  path: string;
  format: 'yaml' | 'json';
  /** Nacteni externiho souboru; bez nej zustanou externi $ref nevyresene. */
  read?: (path: string) => Promise<string>;
}

type Lazy = Map<string, () => string>;

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function esc(v: unknown): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function md(text: unknown): string {
  if (typeof text !== 'string' || !text.trim()) return '';
  return `<div class="oa-md">${renderMarkdown(text).html}</div>`;
}

function codeBlock(text: string, language: string): string {
  const body = hljs.getLanguage(language)
    ? hljs.highlight(text, { language, ignoreIllegals: true }).value
    : esc(text);
  return `<pre class="code-block"><code class="hljs language-${language}">${body}</code></pre>`;
}

const LOCK_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 7V5a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7H4Zm1.5 0h5V5a2.5 2.5 0 0 0-5 0v2Z"/></svg>';

/* ------------------------------------------------------------------ */
/* Vstup                                                               */
/* ------------------------------------------------------------------ */

export async function renderDataFile(source: string, o: DataRenderOptions): Promise<DataRenderResult> {
  const lazy: Lazy = new Map();
  const plain = () => codeBlock(source, o.format);

  let doc: unknown;
  let warning: DataParseError | undefined;
  try {
    ({ value: doc, warning } = parseData(source, o.format));
  } catch (e) {
    // Rozbity OpenAPI soubor chce videt chybu, jiny YAML/JSON staci jako kod
    if (!looksLikeOpenApi(source)) return { html: plain(), lazy };
    const where = e instanceof DataParseError && e.line ? ` na řádku ${e.line}` : '';
    const msg = e instanceof Error ? e.message : String(e);
    return {
      html: `<div class="render-error"><strong>Chyba ${o.format.toUpperCase()}${where}</strong><pre>${esc(msg)}</pre></div>${plain()}`,
      lazy,
    };
  }

  if (!isOpenApi(doc)) return { html: plain(), lazy };

  const resolver = new RefResolver(doc, o.path);
  if (o.read) await resolver.loadExternal(o.read);
  const warnings = [
    ...(warning ? [{ path: '', error: warning }] : []),
    ...resolver.warnings,
  ].map(({ path, error }) => {
    const file = path ? `${esc(path.split(/[\\/]/).pop())}: ` : '';
    const where = error.line ? `řádek ${error.line} – ` : '';
    return `<li>${file}${where}${esc(error.message)}</li>`;
  });
  const banner = warnings.length
    ? `<div class="oa-lenient"><strong>Soubor není striktně validní YAML.</strong> Zobrazeno tolerantně, stejně jako ve Swagger UI. ` +
      `Jiné nástroje (validátory, generátory kódu) ho můžou odmítnout.<ul>${warnings.join('')}</ul></div>`
    : '';
  return { html: banner + new SpecRenderer(doc, resolver, lazy).render(), lazy };
}

/* ------------------------------------------------------------------ */
/* Renderer specifikace                                                */
/* ------------------------------------------------------------------ */

interface Operation {
  method: string;
  path: string;
  op: Obj;
  /** Parametry z urovne cesty doplnene o parametry operace. */
  params: unknown[];
}

class SpecRenderer {
  private seq = 0;
  /** Klic otevirane operace a poradi media bloku v ni - pro stabilni `data-key`. */
  private scope = '';
  private mediaSeq = 0;
  private readonly swagger2: boolean;
  private readonly root: string;

  constructor(
    private readonly spec: Obj,
    private readonly refs: RefResolver,
    private readonly lazy: Lazy,
  ) {
    this.swagger2 = spec.openapi == null;
    this.root = refs.rootPath;
  }

  /** Rozbalovaci blok, jehoz obsah vznikne az pri prvnim otevreni. */
  private lazyDetails(cls: string, key: string, summary: string, body: () => string, id?: string): string {
    const lid = `L${++this.seq}`;
    this.lazy.set(lid, body);
    const idAttr = id ? ` id="${esc(id)}"` : '';
    return (
      `<details class="${cls}"${idAttr} data-lazy="${lid}" data-key="${esc(key)}">` +
      `<summary>${summary}</summary><div class="oa-lazy-body"></div></details>`
    );
  }

  render(): string {
    return (
      '<div class="oa">' +
      this.renderHeader() +
      this.renderOperations() +
      this.renderSecuritySchemes() +
      this.renderModels() +
      '</div>'
    );
  }

  /* ---------------- hlavicka ---------------- */

  private renderHeader(): string {
    const info = isObj(this.spec.info) ? this.spec.info : {};
    const title = typeof info.title === 'string' && info.title ? info.title : 'API';
    const version = info.version != null ? `<span class="oa-badge oa-badge-version">${esc(info.version)}</span>` : '';
    const oas = this.swagger2
      ? `Swagger ${esc(this.spec.swagger)}`
      : `OAS ${esc(String(this.spec.openapi).split('.').slice(0, 2).join('.'))}`;

    const meta: string[] = [];
    for (const s of this.servers()) {
      meta.push(`<li><code>${esc(s.url)}</code>${s.description ? ` — ${esc(s.description)}` : ''}</li>`);
    }
    const contact = isObj(info.contact) ? info.contact : null;
    const license = isObj(info.license) ? info.license : null;
    const extra: string[] = [];
    if (contact) {
      const parts = [contact.name, contact.email, contact.url].filter((v) => typeof v === 'string');
      if (parts.length) extra.push(`Kontakt: ${parts.map(esc).join(' · ')}`);
    }
    if (license?.name) extra.push(`Licence: ${esc(license.name)}`);
    if (typeof info.termsOfService === 'string') extra.push(`Podmínky: ${esc(info.termsOfService)}`);
    const ext = this.externalDocs(this.spec.externalDocs);

    return (
      '<header class="oa-head">' +
      `<h1 id="api">${esc(title)} ${version}<span class="oa-badge oa-badge-oas">${oas}</span></h1>` +
      md(info.description) +
      (meta.length ? `<div class="oa-servers"><span class="oa-label">Servery</span><ul>${meta.join('')}</ul></div>` : '') +
      (extra.length ? `<p class="oa-muted">${extra.join(' · ')}</p>` : '') +
      ext +
      '</header>'
    );
  }

  private servers(): Array<{ url: string; description?: string }> {
    if (!this.swagger2) {
      const list = Array.isArray(this.spec.servers) ? this.spec.servers : [];
      return list.filter(isObj).map((s) => ({ url: String(s.url ?? ''), description: s.description as string }));
    }
    if (typeof this.spec.host !== 'string') {
      return typeof this.spec.basePath === 'string' ? [{ url: this.spec.basePath }] : [];
    }
    const schemes = Array.isArray(this.spec.schemes) && this.spec.schemes.length ? this.spec.schemes : ['https'];
    return schemes.map((s) => ({ url: `${s}://${this.spec.host}${this.spec.basePath ?? ''}` }));
  }

  private externalDocs(v: unknown): string {
    if (!isObj(v) || typeof v.url !== 'string') return '';
    const label = typeof v.description === 'string' && v.description ? v.description : v.url;
    return `<p class="oa-muted">Dokumentace: <a href="${esc(v.url)}" target="_blank" rel="noreferrer noopener">${esc(label)}</a></p>`;
  }

  /* ---------------- operace podle tagu ---------------- */

  private operations(): Operation[] {
    const out: Operation[] = [];
    const paths = isObj(this.spec.paths) ? this.spec.paths : {};
    for (const [path, rawItem] of Object.entries(paths)) {
      const item = this.refs.deref(rawItem, this.root).value;
      if (!isObj(item)) continue;
      const shared = Array.isArray(item.parameters) ? item.parameters : [];
      for (const method of METHODS) {
        const op = item[method];
        if (!isObj(op)) continue;
        out.push({ method, path, op, params: this.mergeParams(shared, op.parameters) });
      }
    }
    return out;
  }

  /** Parametr operace prepisuje stejnojmenny parametr cesty (name + in). */
  private mergeParams(shared: unknown[], own: unknown): unknown[] {
    const ownList = Array.isArray(own) ? own : [];
    const id = (p: unknown) => {
      const v = this.refs.deref(p, this.root).value;
      return isObj(v) ? `${v.in}:${v.name}` : '';
    };
    const ownIds = new Set(ownList.map(id));
    return [...shared.filter((p) => !ownIds.has(id(p))), ...ownList];
  }

  private renderOperations(): string {
    const ops = this.operations();
    if (ops.length === 0) return '<p class="oa-muted">Specifikace neobsahuje žádné operace.</p>';

    const tagInfo = new Map<string, Obj>();
    const order: string[] = [];
    for (const t of Array.isArray(this.spec.tags) ? this.spec.tags : []) {
      if (isObj(t) && typeof t.name === 'string' && !tagInfo.has(t.name)) {
        tagInfo.set(t.name, t);
        order.push(t.name);
      }
    }
    const byTag = new Map<string, Operation[]>();
    for (const o of ops) {
      const tags = Array.isArray(o.op.tags) && o.op.tags.length ? o.op.tags.map(String) : ['default'];
      for (const t of tags) {
        if (!byTag.has(t)) byTag.set(t, []);
        byTag.get(t)!.push(o);
        if (!order.includes(t)) order.push(t);
      }
    }

    return order
      .filter((t) => byTag.has(t))
      .map((tag) => {
        const info = tagInfo.get(tag);
        const desc = typeof info?.description === 'string' ? `<span class="oa-tag-desc">${esc(info.description)}</span>` : '';
        const body = byTag.get(tag)!.map((o) => this.renderOperation(o, tag)).join('');
        return (
          `<details class="oa-tag" open data-key="tag:${esc(tag)}">` +
          `<summary><h2 id="tag-${esc(slugify(tag))}">${esc(tag)}</h2>${desc}</summary>` +
          `${this.externalDocs(info?.externalDocs)}<div class="oa-ops">${body}</div></details>`
        );
      })
      .join('');
  }

  private security(op: Obj): Array<Record<string, string[]>> {
    const req = op.security ?? this.spec.security;
    return Array.isArray(req) ? req.filter(isObj).map((r) => r as Record<string, string[]>) : [];
  }

  private renderOperation(o: Operation, tag: string): string {
    const { method, path, op } = o;
    const sec = this.security(op).filter((r) => Object.keys(r).length > 0);
    const lock = sec.length
      ? `<span class="oa-lock" title="Vyžaduje autorizaci: ${esc(sec.map((r) => Object.keys(r).join(' + ')).join(' nebo '))}">${LOCK_SVG}</span>`
      : '';
    const summary =
      `<span class="oa-method">${method.toUpperCase()}</span>` +
      `<span class="oa-path">${esc(path)}</span>` +
      (typeof op.summary === 'string' ? `<span class="oa-summary">${esc(op.summary)}</span>` : '') +
      lock;
    const cls = `oa-op oa-m-${method}${op.deprecated ? ' oa-deprecated' : ''}`;
    const key = `op:${tag}:${method} ${path}`;
    return this.lazyDetails(cls, key, summary, () => {
      this.scope = key;
      this.mediaSeq = 0;
      return this.renderOperationBody(o);
    });
  }

  private renderOperationBody(o: Operation): string {
    const { op } = o;
    const parts: string[] = [];
    if (op.deprecated) parts.push('<p class="oa-warn">Operace je označená jako zastaralá (deprecated).</p>');
    parts.push(md(op.description));
    if (typeof op.operationId === 'string') {
      parts.push(`<p class="oa-muted">operationId: <code>${esc(op.operationId)}</code></p>`);
    }
    parts.push(this.externalDocs(op.externalDocs));

    const params: Obj[] = [];
    const bodyParams: Obj[] = [];
    const formParams: Obj[] = [];
    for (const raw of o.params) {
      const p = this.refs.deref(raw, this.root).value;
      if (!isObj(p)) continue;
      if (p.in === 'body') bodyParams.push(p);
      else if (p.in === 'formData') formParams.push(p);
      else params.push(p);
    }

    parts.push(this.section('Parametry', params.length ? this.renderParams(params) : '<p class="oa-muted">Žádné parametry</p>'));

    const body = this.swagger2 ? this.swagger2Body(op, bodyParams, formParams) : this.renderRequestBody(op.requestBody);
    if (body) parts.push(this.section('Tělo požadavku', body));

    parts.push(this.section('Odpovědi', this.renderResponses(op)));

    const sec = this.security(op);
    if (sec.length) {
      const rows = sec.map((r) => {
        const names = Object.entries(r).map(
          ([n, scopes]) => `<code>${esc(n)}</code>${Array.isArray(scopes) && scopes.length ? ` (${scopes.map(esc).join(', ')})` : ''}`,
        );
        return `<li>${names.length ? names.join(' + ') : 'bez autorizace'}</li>`;
      });
      parts.push(this.section('Autorizace', `<ul class="oa-sec-list">${rows.join('')}</ul>`));
    }
    if (isObj(op.callbacks) && Object.keys(op.callbacks).length) {
      parts.push(this.section('Callbacky', `<p class="oa-muted">${Object.keys(op.callbacks).map(esc).join(', ')}</p>`));
    }
    return `<div class="oa-op-body">${parts.join('')}</div>`;
  }

  private section(title: string, body: string): string {
    return `<div class="oa-section"><div class="oa-section-head">${title}</div>${body}</div>`;
  }

  /* ---------------- parametry ---------------- */

  private renderParams(params: Obj[]): string {
    const rows = params.map((p) => {
      // OAS 3: typ ve `schema`, Swagger 2: primo na parametru
      const schema = this.swagger2 ? p : p.schema ?? (isObj(p.content) ? Object.values(p.content).find(isObj)?.schema : undefined);
      const info = schema !== undefined ? this.schemaFacts(schema, this.root) : '';
      return (
        '<tr>' +
        `<td class="oa-pname"><div>${esc(p.name)}${p.required ? '<span class="oa-req" title="povinný">*</span>' : ''}</div>` +
        `<div class="oa-in">(${esc(p.in)})</div>${p.deprecated ? '<div class="oa-warn">deprecated</div>' : ''}</td>` +
        `<td>${md(p.description)}${info}${p.example !== undefined ? `<div class="oa-muted">Příklad: <code>${esc(JSON.stringify(p.example))}</code></div>` : ''}</td>` +
        '</tr>'
      );
    });
    return `<table class="oa-table"><thead><tr><th>Název</th><th>Popis</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  /* ---------------- telo pozadavku ---------------- */

  private renderRequestBody(raw: unknown): string {
    if (raw === undefined) return '';
    const r = this.refs.deref(raw, this.root);
    if (r.error) return this.refError(raw, r.error);
    const rb = r.value;
    if (!isObj(rb)) return '';
    return (
      (rb.required ? '<p class="oa-muted"><span class="oa-req">*</span> povinné</p>' : '') +
      md(rb.description) +
      this.renderContent(rb.content, r.base)
    );
  }

  private swagger2Body(op: Obj, body: Obj[], form: Obj[]): string {
    const consumes = this.mediaTypes(op.consumes ?? this.spec.consumes, 'application/json');
    if (body.length) {
      const p = body[0];
      return (
        (p.required ? '<p class="oa-muted"><span class="oa-req">*</span> povinné</p>' : '') +
        md(p.description) +
        consumes.map((mt) => this.renderMedia(mt, p.schema, undefined, this.root)).join('')
      );
    }
    if (form.length) {
      const schema: Obj = { type: 'object', properties: {}, required: [] as string[] };
      for (const p of form) {
        (schema.properties as Obj)[String(p.name)] = { ...p, name: undefined, in: undefined, required: undefined };
        if (p.required) (schema.required as string[]).push(String(p.name));
      }
      const mt = form.some((p) => p.type === 'file') ? 'multipart/form-data' : consumes[0];
      return this.renderMedia(mt, schema, undefined, this.root);
    }
    return '';
  }

  private mediaTypes(v: unknown, fallback: string): string[] {
    return Array.isArray(v) && v.length ? v.map(String) : [fallback];
  }

  private renderContent(content: unknown, base: string): string {
    if (!isObj(content)) return '';
    return Object.entries(content)
      .map(([mt, media]) => {
        const m = isObj(media) ? media : {};
        return this.renderMedia(mt, m.schema, m, base);
      })
      .join('');
  }

  /**
   * Blok jednoho media typu: prepinac Priklad / Schema jako ve Swagger UI.
   * Priklad bere `example`, `examples` nebo ho vygeneruje ze schematu.
   */
  private renderMedia(mediaType: string, schema: unknown, media: Obj | undefined, base: string): string {
    const examples: Array<{ label?: string; value: unknown }> = [];
    if (media?.example !== undefined) examples.push({ value: media.example });
    if (isObj(media?.examples)) {
      for (const [name, raw] of Object.entries(media.examples)) {
        const ex = this.refs.deref(raw, base).value;
        if (isObj(ex) && ex.value !== undefined) {
          examples.push({ label: typeof ex.summary === 'string' ? ex.summary : name, value: ex.value });
        } else if (isObj(ex) && typeof ex.externalValue === 'string') {
          examples.push({ label: name, value: `externí příklad: ${ex.externalValue}` });
        }
      }
    }
    if (examples.length === 0 && schema !== undefined) {
      const generated = this.example(schema, base, 0, new Set());
      if (generated !== undefined) examples.push({ value: generated });
    }

    const head = `<code class="oa-mt">${esc(mediaType)}</code>`;
    if (schema === undefined && examples.length === 0) {
      return `<div class="oa-media"><div class="oa-media-head">${head}</div></div>`;
    }

    const exampleHtml = examples
      .map((ex) => {
        const text = typeof ex.value === 'string' ? ex.value : JSON.stringify(ex.value, null, 2);
        const lang = typeof ex.value === 'string' ? (/xml/.test(mediaType) ? 'xml' : 'plaintext') : 'json';
        return (ex.label ? `<div class="oa-ex-label">${esc(ex.label)}</div>` : '') + codeBlock(text ?? '', lang);
      })
      .join('');
    const schemaHtml = schema !== undefined ? this.schemaTree(schema, base, `${this.scope}|m${++this.mediaSeq}`) : '';

    const view = examples.length ? 'example' : 'schema';
    const tabs =
      `<span class="oa-tabs">` +
      (examples.length ? `<button type="button" data-tab="example">Příklad</button>` : '') +
      (schemaHtml ? `<button type="button" data-tab="schema">Schéma</button>` : '') +
      '</span>';
    return (
      `<div class="oa-media" data-view="${view}"><div class="oa-media-head">${head}${tabs}</div>` +
      `<div class="oa-pane oa-pane-example">${exampleHtml}</div>` +
      `<div class="oa-pane oa-pane-schema">${schemaHtml}</div></div>`
    );
  }

  /* ---------------- odpovedi ---------------- */

  private renderResponses(op: Obj): string {
    const responses = isObj(op.responses) ? op.responses : {};
    const entries = Object.entries(responses);
    if (entries.length === 0) return '<p class="oa-muted">Bez popsaných odpovědí</p>';
    const produces = this.mediaTypes(op.produces ?? this.spec.produces, 'application/json');

    const rows = entries.map(([code, raw]) => {
      const r = this.refs.deref(raw, this.root);
      let body: string;
      if (r.error) {
        body = this.refError(raw, r.error);
      } else {
        const resp = isObj(r.value) ? r.value : {};
        body = md(resp.description) + this.renderHeaders(resp.headers, r.base);
        if (this.swagger2) {
          if (resp.schema !== undefined || isObj(resp.examples)) {
            const ex = isObj(resp.examples) ? resp.examples : {};
            const types = Object.keys(ex).length ? Object.keys(ex) : produces;
            body += types
              .map((mt) => this.renderMedia(mt, resp.schema, ex[mt] !== undefined ? { example: ex[mt] } : undefined, r.base))
              .join('');
          }
        } else {
          body += this.renderContent(resp.content, r.base);
          if (isObj(resp.links) && Object.keys(resp.links).length) {
            body += `<p class="oa-muted">Odkazy: ${Object.keys(resp.links).map(esc).join(', ')}</p>`;
          }
        }
      }
      const cls = /^2/.test(code) ? 'ok' : /^[45]/.test(code) ? 'err' : 'other';
      return `<tr><td class="oa-code oa-code-${cls}">${esc(code)}</td><td>${body}</td></tr>`;
    });
    return `<table class="oa-table"><thead><tr><th>Kód</th><th>Popis</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  private renderHeaders(headers: unknown, base: string): string {
    if (!isObj(headers) || Object.keys(headers).length === 0) return '';
    const rows = Object.entries(headers).map(([name, raw]) => {
      const h = this.refs.deref(raw, base);
      const v = isObj(h.value) ? h.value : {};
      const schema = this.swagger2 ? v : v.schema;
      return `<tr><td><code>${esc(name)}</code></td><td>${md(v.description)}${schema !== undefined ? this.schemaFacts(schema, h.base) : ''}</td></tr>`;
    });
    return `<div class="oa-subhead">Hlavičky</div><table class="oa-table oa-table-compact"><tbody>${rows.join('')}</tbody></table>`;
  }

  private refError(raw: unknown, error: string): string {
    const ref = isObj(raw) && typeof raw.$ref === 'string' ? raw.$ref : '';
    return `<div class="oa-ref-error">Nelze rozbalit <code>${esc(ref)}</code>: ${esc(error)}</div>`;
  }

  /* ---------------- autorizace ---------------- */

  private renderSecuritySchemes(): string {
    const comps = isObj(this.spec.components) ? this.spec.components : {};
    const schemes = this.swagger2 ? this.spec.securityDefinitions : comps.securitySchemes;
    if (!isObj(schemes) || Object.keys(schemes).length === 0) return '';
    const rows = Object.entries(schemes).map(([name, raw]) => {
      const s = this.refs.deref(raw, this.root).value;
      const v = isObj(s) ? s : {};
      const facts: string[] = [`typ: <code>${esc(v.type)}</code>`];
      if (v.scheme) facts.push(`schéma: <code>${esc(v.scheme)}</code>`);
      if (v.bearerFormat) facts.push(`formát: <code>${esc(v.bearerFormat)}</code>`);
      if (v.in) facts.push(`<code>${esc(v.name)}</code> v ${esc(v.in)}`);
      if (v.flow) facts.push(`flow: <code>${esc(v.flow)}</code>`);
      if (v.openIdConnectUrl) facts.push(`OIDC: <code>${esc(v.openIdConnectUrl)}</code>`);
      let flows = '';
      const flowList: Array<[string, Obj]> = isObj(v.flows)
        ? Object.entries(v.flows).filter((e): e is [string, Obj] => isObj(e[1]))
        : v.flow
          ? [[String(v.flow), v]]
          : [];
      if (flowList.length) {
        flows = flowList
          .map(([fname, f]) => {
            const urls = ['authorizationUrl', 'tokenUrl', 'refreshUrl']
              .filter((k) => typeof f[k] === 'string')
              .map((k) => `${k}: <code>${esc(f[k])}</code>`);
            const scopes = isObj(f.scopes) ? Object.keys(f.scopes) : [];
            return `<div class="oa-muted">${esc(fname)}: ${urls.join(', ')}${scopes.length ? ` · scopes: ${scopes.map(esc).join(', ')}` : ''}</div>`;
          })
          .join('');
      }
      return `<tr><td><code>${esc(name)}</code></td><td>${facts.join(' · ')}${md(v.description)}${flows}</td></tr>`;
    });
    return (
      `<details class="oa-tag oa-block" open data-key="security"><summary><h2 id="autorizace">Autorizace</h2></summary>` +
      `<table class="oa-table"><tbody>${rows.join('')}</tbody></table></details>`
    );
  }

  /* ---------------- schemata ---------------- */

  private renderModels(): string {
    const comps = isObj(this.spec.components) ? this.spec.components : {};
    const models = this.swagger2 ? this.spec.definitions : comps.schemas;
    if (!isObj(models) || Object.keys(models).length === 0) return '';
    const pointer = this.swagger2 ? '#/definitions/' : '#/components/schemas/';
    const items = Object.keys(models).map((name) => {
      const schema = { $ref: pointer + name.replace(/~/g, '~0').replace(/\//g, '~1') };
      const r = this.refs.deref(schema, this.root);
      const v = isObj(r.value) ? r.value : {};
      const desc = typeof v.title === 'string' ? v.title : '';
      const summary =
        `<span class="oa-model-name">${esc(name)}</span>` +
        `<span class="oa-type">${this.typeLabel(v, r.base, false)}</span>` +
        (desc ? `<span class="oa-model-desc">${esc(desc)}</span>` : '');
      return this.lazyDetails(
        'oa-model',
        `model:${name}`,
        summary,
        () => this.schemaBody(r.value, r.base, `model:${name}`),
        this.modelId(name),
      );
    });
    return (
      `<details class="oa-tag oa-models" open data-key="models"><summary><h2 id="schemata">Schémata</h2></summary>` +
      `<div class="oa-model-list">${items.join('')}</div></details>`
    );
  }

  private modelId(name: string): string {
    return `schema-${name}`;
  }

  /** Odkaz na schema v sekci Schemata - jen pro schemata korenoveho souboru. */
  private modelLink(ref: string, base: string): string | null {
    if (!ref.startsWith('#') || !this.refs.isRoot(base)) return null;
    const m = (this.swagger2 ? /^#\/definitions\/([^/]+)$/ : /^#\/components\/schemas\/([^/]+)$/).exec(ref);
    if (!m) return null;
    const name = decodeURIComponent(m[1].replace(/~1/g, '/').replace(/~0/g, '~'));
    return `<a class="oa-ref-link" href="#${esc(this.modelId(name))}">${esc(name)}</a>`;
  }

  /** Strucny typ: `string($date-time)`, `array[Pet]`, `Pet`. */
  private typeLabel(raw: unknown, base: string, link = true): string {
    if (isObj(raw) && typeof raw.$ref === 'string') {
      const r = this.refs.deref(raw, base);
      if (r.error) return `<span class="oa-ref-error" title="${esc(r.error)}">${esc(refName(raw.$ref))}?</span>`;
      return (link && this.modelLink(raw.$ref, base)) || `<span class="oa-ref-name">${esc(r.name ?? refName(raw.$ref))}</span>`;
    }
    if (!isObj(raw)) return raw === true ? 'any' : '';
    const s = raw;
    if (Array.isArray(s.allOf)) return s.allOf.map((x) => this.typeLabel(x, base, link)).join(' &amp; ') || 'object';
    for (const k of ['oneOf', 'anyOf'] as const) {
      if (Array.isArray(s[k])) return `${k}(${s[k].map((x) => this.typeLabel(x, base, link)).join(' | ')})`;
    }
    const types = Array.isArray(s.type) ? s.type.map(String) : s.type ? [String(s.type)] : [];
    const nullable = s.nullable === true || types.includes('null');
    const main = types.filter((t) => t !== 'null');
    let label: string;
    if (main.includes('array') || (!main.length && s.items !== undefined)) {
      label = `array[${this.typeLabel(s.items, base, link) || 'any'}]`;
    } else if (main.length) {
      label = main.map(esc).join(' | ');
    } else if (s.properties || s.additionalProperties) {
      label = 'object';
    } else {
      label = 'any';
    }
    if (typeof s.format === 'string') label += `<span class="oa-format">($${esc(s.format)})</span>`;
    return nullable ? `${label} | null` : label;
  }

  /** Omezeni a popis schematu na jednom radku (parametry, hlavicky). */
  private schemaFacts(raw: unknown, base: string): string {
    const r = this.refs.deref(raw, base);
    const s = isObj(r.value) ? r.value : {};
    const facts: string[] = [];
    const add = (label: string, v: unknown) => {
      if (v !== undefined) facts.push(`${label}: <code>${esc(typeof v === 'string' ? v : JSON.stringify(v))}</code>`);
    };
    if (Array.isArray(s.enum)) facts.push(`enum: ${s.enum.map((e) => `<code>${esc(JSON.stringify(e))}</code>`).join(' ')}`);
    add('default', s.default);
    add('min', s.minimum ?? s.exclusiveMinimum);
    add('max', s.maximum ?? s.exclusiveMaximum);
    add('min. délka', s.minLength);
    add('max. délka', s.maxLength);
    add('min. položek', s.minItems);
    add('max. položek', s.maxItems);
    add('pattern', s.pattern);
    if (s.uniqueItems) facts.push('unikátní položky');
    if (s.readOnly) facts.push('jen pro čtení');
    if (s.writeOnly) facts.push('jen pro zápis');
    if (s.deprecated) facts.push('<span class="oa-warn">deprecated</span>');
    return (
      `<div class="oa-facts"><span class="oa-type">${this.typeLabel(raw, base)}</span>` +
      (facts.length ? ` <span class="oa-muted">${facts.join(' · ')}</span>` : '') +
      '</div>'
    );
  }

  /** Ma schema strukturu, kterou jde rozbalit? */
  private expandable(raw: unknown, base: string, depth = 0): boolean {
    if (depth > 8) return false;
    const r = this.refs.deref(raw, base);
    const s = r.value;
    if (!isObj(s)) return false;
    if (isObj(s.properties) && Object.keys(s.properties).length) return true;
    if (isObj(s.additionalProperties)) return true;
    if (['allOf', 'oneOf', 'anyOf'].some((k) => Array.isArray(s[k]))) return true;
    if (s.items !== undefined) return this.expandable(s.items, r.base, depth + 1);
    return false;
  }

  /** Strom schematu: typ a pod nim jedna uroven obsahu. */
  private schemaTree(raw: unknown, base: string, key: string): string {
    const r = this.refs.deref(raw, base);
    if (r.error) return this.refError(raw, r.error);
    return (
      `<div class="oa-schema"><div class="oa-schema-type">${this.typeLabel(raw, base)}</div>` +
      this.schemaBody(r.value, r.base, key) +
      '</div>'
    );
  }

  /** Obsah jedne urovne schematu (vlastnosti, varianty, polozky pole). */
  private schemaBody(value: unknown, base: string, key: string): string {
    if (!isObj(value)) return '';
    const s = value;
    const out: string[] = [];
    out.push(md(s.description));

    // allOf: slouceni vlastnosti vsech casti, jako to dela Swagger UI
    const merged = this.mergeAllOf(s, base);
    const facts = this.ownFacts(s);
    if (facts) out.push(`<div class="oa-muted">${facts}</div>`);
    if (isObj(s.discriminator) && typeof s.discriminator.propertyName === 'string') {
      out.push(`<div class="oa-muted">Diskriminátor: <code>${esc(s.discriminator.propertyName)}</code></div>`);
    }

    for (const k of ['oneOf', 'anyOf'] as const) {
      const list = s[k];
      if (!Array.isArray(list)) continue;
      const rows = list.map((v, i) => {
        const label = isObj(v) && typeof v.$ref === 'string' ? '' : `varianta ${i + 1}`;
        return this.propRow(label, v, base, false, `${key}/${k}${i}`);
      });
      out.push(`<div class="oa-comp">${k === 'oneOf' ? 'jedna z (oneOf)' : 'kterákoli z (anyOf)'}</div><div class="oa-props">${rows.join('')}</div>`);
    }

    if (merged.props.length) {
      const required = new Set(merged.required);
      const rows = merged.props.map(([name, v, b]) => this.propRow(name, v, b, required.has(name), `${key}/${name}`));
      out.push(`<div class="oa-props">${rows.join('')}</div>`);
    }
    if (isObj(s.additionalProperties) || s.additionalProperties === true) {
      out.push(`<div class="oa-props">${this.propRow('{klíč}', s.additionalProperties, base, false, `${key}/*`)}</div>`);
    }

    const types = Array.isArray(s.type) ? s.type : [s.type];
    if ((types.includes('array') || s.items !== undefined) && s.items !== undefined) {
      out.push(`<div class="oa-props">${this.propRow('[položka]', s.items, base, false, `${key}/[]`)}</div>`);
    }
    return out.join('');
  }

  private mergeAllOf(s: Obj, base: string, depth = 0): { props: Array<[string, unknown, string]>; required: string[] } {
    const props: Array<[string, unknown, string]> = [];
    const required: string[] = [];
    const add = (v: Obj, b: string) => {
      if (isObj(v.properties)) {
        for (const [n, p] of Object.entries(v.properties)) {
          const i = props.findIndex((x) => x[0] === n);
          if (i >= 0) props[i] = [n, p, b];
          else props.push([n, p, b]);
        }
      }
      if (Array.isArray(v.required)) required.push(...v.required.map(String));
    };
    if (Array.isArray(s.allOf) && depth < 16) {
      for (const part of s.allOf) {
        const r = this.refs.deref(part, base);
        if (!isObj(r.value)) continue;
        const sub = this.mergeAllOf(r.value, r.base, depth + 1);
        for (const [n, p, b] of sub.props) add({ properties: { [n]: p } }, b);
        required.push(...sub.required);
      }
    }
    add(s, base);
    return { props, required };
  }

  /** Omezeni jako kratky text, bez typu (ten je ve sloupci typu). */
  private ownFacts(s: Obj): string {
    const facts: string[] = [];
    const show = (v: unknown) => `<code>${esc(typeof v === 'string' ? v : JSON.stringify(v))}</code>`;
    if (Array.isArray(s.enum)) facts.push(`enum: ${s.enum.map(show).join(' ')}`);
    if (s.const !== undefined) facts.push(`const: ${show(s.const)}`);
    if (s.default !== undefined) facts.push(`default: ${show(s.default)}`);
    if (s.example !== undefined && typeof s.example !== 'object') facts.push(`příklad: ${show(s.example)}`);
    const range = (lo: unknown, hi: unknown, unit: string) => {
      if (lo === undefined && hi === undefined) return;
      facts.push(`${unit}: ${lo ?? '…'}–${hi ?? '…'}`);
    };
    range(s.minimum ?? s.exclusiveMinimum, s.maximum ?? s.exclusiveMaximum, 'rozsah');
    range(s.minLength, s.maxLength, 'délka');
    range(s.minItems, s.maxItems, 'položek');
    if (typeof s.pattern === 'string') facts.push(`pattern: ${show(s.pattern)}`);
    if (s.uniqueItems) facts.push('unikátní');
    if (s.readOnly) facts.push('jen pro čtení');
    if (s.writeOnly) facts.push('jen pro zápis');
    if (s.deprecated) facts.push('<span class="oa-warn">deprecated</span>');
    return facts.join(' · ');
  }

  /** Radek vlastnosti; strukturovany typ se rozbali az na klik. */
  private propRow(name: string, raw: unknown, base: string, required: boolean, key: string): string {
    const r = this.refs.deref(raw, base);
    const v = isObj(r.value) ? r.value : {};
    const nameHtml = name
      ? `<span class="oa-prop-name">${esc(name)}</span>${required ? '<span class="oa-req" title="povinné">*</span>' : ''}`
      : '';
    const facts = this.ownFacts(v);
    const desc = typeof v.description === 'string' && v.description.trim() ? md(v.description) : '';
    const type = this.typeLabel(raw, base);
    const info = (facts ? `<div class="oa-muted">${facts}</div>` : '') + desc;

    if (r.error) {
      return `<div class="oa-prop"><div class="oa-prop-head">${nameHtml}<span class="oa-type">${type}</span></div>${this.refError(raw, r.error)}</div>`;
    }
    if (this.expandable(raw, base)) {
      const summary = `${nameHtml}<span class="oa-type">${type}</span>`;
      // Popis a omezeni patri do rozbaleneho obsahu, souhrn zustava na jeden radek
      return (
        '<div class="oa-prop">' +
        this.lazyDetails('oa-sub', key, summary, () => this.schemaBody(r.value, r.base, key)) +
        '</div>'
      );
    }
    return `<div class="oa-prop"><div class="oa-prop-head">${nameHtml}<span class="oa-type">${type}</span></div>${info}</div>`;
  }

  /* ---------------- generovany priklad ---------------- */

  private example(raw: unknown, base: string, depth: number, chain: Set<string>): unknown {
    if (depth > 10) return undefined;
    const r = this.refs.deref(raw, base);
    if (r.error || !isObj(r.value)) return raw === true ? {} : undefined;
    if (r.key) {
      if (chain.has(r.key)) return undefined; // cyklus
      chain = new Set(chain).add(r.key);
    }
    const s = r.value;
    if (s.example !== undefined) return s.example;
    if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
    if (s.const !== undefined) return s.const;
    if (s.default !== undefined) return s.default;
    if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];

    if (Array.isArray(s.allOf)) {
      const out: Obj = {};
      for (const part of s.allOf) {
        const v = this.example(part, r.base, depth + 1, chain);
        if (isObj(v)) Object.assign(out, v);
        else if (v !== undefined && s.allOf.length === 1) return v;
      }
      return this.objectExample(s, r.base, depth, chain, out);
    }
    for (const k of ['oneOf', 'anyOf'] as const) {
      if (Array.isArray(s[k]) && s[k].length) return this.example(s[k][0], r.base, depth + 1, chain);
    }

    const types = (Array.isArray(s.type) ? s.type : [s.type]).filter((t) => t && t !== 'null');
    const type = types[0] ?? (s.properties ? 'object' : s.items ? 'array' : undefined);
    switch (type) {
      case 'object':
        return this.objectExample(s, r.base, depth, chain, {});
      case 'array': {
        const item = this.example(s.items, r.base, depth + 1, chain);
        return item === undefined ? [] : [item];
      }
      case 'integer':
      case 'number':
        return typeof s.minimum === 'number' ? s.minimum : 0;
      case 'boolean':
        return true;
      case 'file':
        return '(binary)';
      case 'string':
        return stringExample(s.format);
      default:
        return types.includes('null') ? null : undefined;
    }
  }

  private objectExample(s: Obj, base: string, depth: number, chain: Set<string>, out: Obj): Obj {
    if (isObj(s.properties)) {
      for (const [name, p] of Object.entries(s.properties)) {
        const v = this.example(p, base, depth + 1, chain);
        if (v !== undefined) out[name] = v;
      }
    }
    if (isObj(s.additionalProperties)) {
      const v = this.example(s.additionalProperties, base, depth + 1, chain);
      if (v !== undefined) out.additionalProp1 = v;
    }
    return out;
  }
}

function stringExample(format: unknown): string {
  switch (format) {
    case 'date-time':
      return '2026-01-31T12:00:00Z';
    case 'date':
      return '2026-01-31';
    case 'time':
      return '12:00:00';
    case 'uuid':
      return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    case 'email':
      return 'user@example.com';
    case 'uri':
    case 'url':
      return 'https://example.com';
    case 'ipv4':
      return '192.168.0.1';
    case 'byte':
      return 'U3dhZ2dlcg==';
    case 'binary':
      return '(binary)';
    default:
      return 'string';
  }
}

/* ------------------------------------------------------------------ */
/* Interakce v nahledu                                                 */
/* ------------------------------------------------------------------ */

const lazyByRoot = new WeakMap<HTMLElement, Lazy>();

function fill(root: HTMLElement, d: HTMLDetailsElement): void {
  const id = d.dataset.lazy;
  if (!id) return;
  const make = lazyByRoot.get(root)?.get(id);
  delete d.dataset.lazy;
  const body = d.querySelector<HTMLElement>(':scope > .oa-lazy-body');
  if (make && body) body.innerHTML = make();
}

/**
 * Napoji rozbalovani, prepinac Priklad/Schema a odkazy na schemata.
 * Volat po kazdem vlozeni HTML; posluchace se na uzel pridaji jen jednou.
 */
export function hydrateOpenApi(root: HTMLElement, lazy: Lazy): void {
  lazyByRoot.set(root, lazy);
  if (root.dataset.oaHydrated) return;
  root.dataset.oaHydrated = '1';

  // `toggle` nebubla - proto capture
  root.addEventListener(
    'toggle',
    (e) => {
      const d = e.target as HTMLElement;
      if (d instanceof HTMLDetailsElement && d.open) fill(root, d);
    },
    true,
  );

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const tab = target.closest<HTMLButtonElement>('.oa-tabs button');
    if (tab) {
      const media = tab.closest<HTMLElement>('.oa-media');
      if (media && tab.dataset.tab) media.dataset.view = tab.dataset.tab;
      return;
    }
    // Odkaz na schema: otevrit cil (i nadrazene bloky); scroll zaridi main.ts
    const link = target.closest<HTMLAnchorElement>('a.oa-ref-link');
    if (link) {
      const id = (link.getAttribute('href') ?? '').slice(1);
      const dest = root.querySelector<HTMLDetailsElement>(`[id="${CSS.escape(id)}"]`);
      for (let d: HTMLElement | null = dest; d && d !== root; d = d.parentElement) {
        if (d instanceof HTMLDetailsElement && !d.open) {
          d.open = true;
          fill(root, d);
        }
      }
    }
  });
}

/** Stav rozbaleni podle `data-key` - aby prekresleni pri psani nic nezavrelo. */
export function captureOpenState(root: HTMLElement): Map<string, boolean> {
  const state = new Map<string, boolean>();
  for (const d of root.querySelectorAll<HTMLDetailsElement>('details[data-key]')) {
    state.set(d.dataset.key!, d.open);
  }
  return state;
}

export function restoreOpenState(root: HTMLElement, state: Map<string, boolean>): void {
  if (state.size === 0) return;
  const done = new Set<HTMLDetailsElement>();
  // Otevreni bloku vyrobi vnorene bloky, proto opakovat, dokud pribyvaji
  for (let changed = true; changed; ) {
    changed = false;
    for (const d of root.querySelectorAll<HTMLDetailsElement>('details[data-key]')) {
      if (done.has(d)) continue;
      done.add(d);
      const open = state.get(d.dataset.key!);
      if (open === undefined || open === d.open) {
        if (d.open && d.dataset.lazy) {
          fill(root, d);
          changed = true;
        }
        continue;
      }
      d.open = open;
      if (open) {
        fill(root, d);
        changed = true;
      }
    }
  }
}

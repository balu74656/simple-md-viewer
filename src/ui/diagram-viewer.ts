/**
 * Celookenny prohlizec diagramu: klik na PlantUML nebo Mermaid diagram
 * v nahledu ho otevre pres cele okno s volnym zoomem a posunem.
 *
 * Diagram se vzdy otevre "na sirku okna" (Fit), stav se nepamatuje.
 * Kolecko zoomuje ke kurzoru, tazeni posouva, dvojklik vraci Fit.
 */

export interface DiagramViewer {
  isOpen(): boolean;
  close(): void;
}

/** Figury, ktere jdou otevrit. Chybova hlaska uvnitr figury se neotvira. */
const FIGURE_SELECTOR = '.puml-figure, .mermaid-figure';

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const WHEEL_STEP = 1.15;
const BUTTON_STEP = 1.25;
const KEY_PAN = 60;
const FIT_MARGIN = 24;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Kopie obsahu figury pro prohlizec + jeji prirozena velikost. */
function cloneDiagram(figure: HTMLElement): { el: HTMLElement | SVGSVGElement; w: number; h: number } | null {
  const img = figure.querySelector<HTMLImageElement>('img.puml-img');
  if (img) {
    if (!img.complete || img.naturalWidth === 0) return null;
    const copy = document.createElement('img');
    copy.className = 'puml-img';
    copy.alt = img.alt;
    copy.src = img.src;
    copy.draggable = false;
    return { el: copy, w: img.naturalWidth, h: img.naturalHeight };
  }

  const svg = figure.querySelector<SVGSVGElement>('svg');
  if (svg) {
    const vb = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    const w = vb && vb.width ? vb.width : rect.width;
    const h = vb && vb.height ? vb.height : rect.height;
    if (!w || !h) return null;
    const copy = svg.cloneNode(true) as SVGSVGElement;
    // Mermaid nastavuje max-width a width="100%" - v prohlizeci chceme
    // pevnou velikost, se kterou pak pracuje transform.
    copy.removeAttribute('style');
    copy.setAttribute('width', String(w));
    copy.setAttribute('height', String(h));
    return { el: copy, w, h };
  }
  return null;
}

export function createDiagramViewer(host: HTMLElement): DiagramViewer {
  const dialog = document.createElement('dialog');
  dialog.id = 'diagram-viewer';
  dialog.innerHTML = `
    <div class="dv-toolbar" role="toolbar" aria-label="Zoom diagramu">
      <button type="button" data-act="out" title="Oddálit (−)">&minus;</button>
      <span class="dv-zoom" aria-live="polite">100 %</span>
      <button type="button" data-act="in" title="Přiblížit (+)">+</button>
      <button type="button" data-act="fit" title="Na velikost okna (0, dvojklik)">Fit</button>
      <button type="button" data-act="one" title="Skutečná velikost (1)">1:1</button>
      <button type="button" data-act="close" class="dv-close" title="Zavřít (Esc)">&#10005;</button>
    </div>
    <div class="dv-viewport" tabindex="-1">
      <div class="dv-stage"></div>
    </div>`;
  document.body.append(dialog);

  const viewport = dialog.querySelector<HTMLElement>('.dv-viewport')!;
  const stage = dialog.querySelector<HTMLElement>('.dv-stage')!;
  const zoomLabel = dialog.querySelector<HTMLElement>('.dv-zoom')!;

  let natW = 0;
  let natH = 0;
  let scale = 1;
  let x = 0;
  let y = 0;

  function apply(): void {
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    zoomLabel.textContent = `${Math.round(scale * 100)} %`;
  }

  function fit(): void {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    // Male diagramy nezvetsujeme nad 100 %, jen vystredime
    scale = clamp(Math.min((vw - FIT_MARGIN * 2) / natW, (vh - FIT_MARGIN * 2) / natH, 1), MIN_SCALE, MAX_SCALE);
    x = (vw - natW * scale) / 2;
    y = (vh - natH * scale) / 2;
    apply();
  }

  /** Zoom s pevnym bodem (cx, cy) v souradnicich viewportu. */
  function zoomAt(factor: number, cx: number, cy: number): void {
    const next = clamp(scale * factor, MIN_SCALE, MAX_SCALE);
    const k = next / scale;
    x = cx - (cx - x) * k;
    y = cy - (cy - y) * k;
    scale = next;
    apply();
  }

  function zoomCenter(factor: number): void {
    zoomAt(factor, viewport.clientWidth / 2, viewport.clientHeight / 2);
  }

  function actualSize(): void {
    zoomCenter(1 / scale);
  }

  function open(figure: HTMLElement): void {
    const diagram = cloneDiagram(figure);
    if (!diagram) return;
    natW = diagram.w;
    natH = diagram.h;
    stage.style.width = `${natW}px`;
    stage.style.height = `${natH}px`;
    stage.replaceChildren(diagram.el);
    dialog.showModal();
    // Rozmery viewportu jsou zname az po zobrazeni dialogu
    fit();
    viewport.focus();
  }

  function close(): void {
    if (!dialog.open) return;
    dialog.close();
  }

  dialog.addEventListener('close', () => {
    stage.replaceChildren();
    pointers.clear();
  });

  /* ---- Mys, touchpad, dotyk ---- */

  // Kolecko vzdy zoomuje. Ctrl+kolecko (a pinch na touchpadu, ktery
  // WebView2 posila jako wheel s ctrlKey) by jinak zvetsil celou stranku.
  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = viewport.getBoundingClientRect();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      // Plynuly zoom: kratke kroky touchpadu = male zmeny
      const factor = Math.pow(WHEEL_STEP, -delta / 100);
      zoomAt(factor, e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );

  // Aktivni ukazatele: jeden = posun, dva = pinch zoom
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;

  function pinchState(): { cx: number; cy: number; dist: number } {
    const [a, b] = Array.from(pointers.values());
    const r = viewport.getBoundingClientRect();
    return {
      cx: (a.x + b.x) / 2 - r.left,
      cy: (a.y + b.y) / 2 - r.top,
      dist: Math.hypot(a.x - b.x, a.y - b.y),
    };
  }

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) pinchDist = pinchState().dist;
    viewport.classList.add('dragging');
  });

  viewport.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;

    if (pointers.size === 1) {
      x += e.clientX - prev.x;
      y += e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      apply();
      return;
    }

    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinchState();
    if (pinchDist > 0) zoomAt(p.dist / pinchDist, p.cx, p.cy);
    pinchDist = p.dist;
  });

  function endPointer(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    pinchDist = pointers.size === 2 ? pinchState().dist : 0;
    if (pointers.size === 0) viewport.classList.remove('dragging');
  }
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);

  viewport.addEventListener('dblclick', fit);

  // Klik na ztmavene pozadi mimo dialog (::backdrop) dialog zavre
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });

  /* ---- Tlacitka a klavesy ---- */

  dialog.querySelector('.dv-toolbar')!.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.act;
    if (act === 'in') zoomCenter(BUTTON_STEP);
    else if (act === 'out') zoomCenter(1 / BUTTON_STEP);
    else if (act === 'fit') fit();
    else if (act === 'one') actualSize();
    else if (act === 'close') close();
  });

  dialog.addEventListener('keydown', (e) => {
    // Esc obslouzi <dialog> sam. Zkratky aplikace (Ctrl+W apod.) tu neplati.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let handled = true;
    switch (e.key) {
      case '+':
      case '=':
        zoomCenter(BUTTON_STEP);
        break;
      case '-':
        zoomCenter(1 / BUTTON_STEP);
        break;
      case '0':
        fit();
        break;
      case '1':
        actualSize();
        break;
      case 'ArrowLeft':
        x += KEY_PAN;
        apply();
        break;
      case 'ArrowRight':
        x -= KEY_PAN;
        apply();
        break;
      case 'ArrowUp':
        y += KEY_PAN;
        apply();
        break;
      case 'ArrowDown':
        y -= KEY_PAN;
        apply();
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  });

  window.addEventListener('resize', () => {
    if (dialog.open) fit();
  });

  /* ---- Otevreni klikem v nahledu ---- */

  host.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    // Odkaz v Mermaid diagramu (click ... href) ma prednost
    if (target.closest('a')) return;
    const figure = target.closest<HTMLElement>(FIGURE_SELECTOR);
    if (!figure || !host.contains(figure)) return;
    if (figure.querySelector('.render-error')) return;
    open(figure);
  });

  return { isOpen: () => dialog.open, close };
}

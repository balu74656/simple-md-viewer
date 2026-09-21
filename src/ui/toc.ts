export interface TocController {
  /** Postavi osnovu z nadpisu v zadanem uzlu (nahled aktivniho tabu). */
  rebuild(root: HTMLElement): void;
  dispose(): void;
}

/**
 * Postavi osnovu z nadpisu v nahledu a sleduje, ktery je prave videt.
 * Scroll-spy resi IntersectionObserver - levnejsi nez scroll listener
 * a nevadi mu asynchronne dorenderovane diagramy menici vysku dokumentu.
 */
export function createToc(scroller: HTMLElement, list: HTMLElement): TocController {
  let observer: IntersectionObserver | null = null;
  const visible = new Set<string>();

  function markActive(): void {
    const links = list.querySelectorAll<HTMLAnchorElement>('a');
    let activeId: string | null = null;

    // Prvni viditelny nadpis v poradi dokumentu
    for (const link of links) {
      const id = link.dataset.target ?? '';
      if (visible.has(id)) {
        activeId = id;
        break;
      }
    }
    for (const link of links) {
      link.classList.toggle('active', link.dataset.target === activeId);
    }
  }

  function rebuild(root: HTMLElement): void {
    observer?.disconnect();
    visible.clear();
    list.replaceChildren();

    const headings = Array.from(
      root.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6'),
    ).filter((h) => h.id);

    if (headings.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'toc-empty';
      empty.textContent = 'Dokument nemá nadpisy.';
      list.appendChild(empty);
      return;
    }

    const minDepth = Math.min(...headings.map((h) => Number(h.tagName[1])));

    for (const h of headings) {
      const depth = Number(h.tagName[1]);
      const a = document.createElement('a');
      a.href = `#${h.id}`;
      a.dataset.target = h.id;
      a.className = `toc-l${Math.min(depth - minDepth, 4)}`;
      // textContent nadpisu obsahuje i kotvu "#", tu vyradime
      a.textContent = (h.textContent ?? '').replace(/#$/, '').trim();
      a.addEventListener('click', (e) => {
        e.preventDefault();
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      list.appendChild(a);
    }

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        markActive();
      },
      { root: scroller, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );
    for (const h of headings) observer.observe(h);
  }

  return {
    rebuild,
    dispose() {
      observer?.disconnect();
      observer = null;
    },
  };
}

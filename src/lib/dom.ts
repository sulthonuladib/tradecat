/**
 * Small DOM helpers shared by the orderbook engine and the exchange adapters.
 *
 * The one important rule: the exchange's own text must always stay readable,
 * even after we have rewritten a cell. Badges and overlays we create carry the
 * `tc-injected` class, and every text read filters those out.
 */

export const INJECTED = 'tc-injected';
export const PRICE_IDR = 'tc-idr-price';

export const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'CANVAS',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'OPTION',
  'svg',
  'path',
  'TEMPLATE',
]);

/** textContent, but ignoring anything this script injected. */
export function cleanText(el: Element): string {
  const raw = el.textContent;
  if (!raw) return '';
  if (!el.querySelector('.' + INJECTED)) return raw.trim();

  let out = '';
  const visit = (node: Node): void => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent ?? '';
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = child as Element;
        if (!childEl.classList.contains(INJECTED)) visit(childEl);
      }
    });
  };
  visit(el);
  return out.trim();
}

/** Last text we wrote into an element, so we can still recover the site value. */
const rendered = new WeakMap<HTMLElement, string>();

export function markRendered(el: HTMLElement, text: string): void {
  rendered.set(el, text);
}

/** The value the exchange itself put in this element (not our conversion). */
export function siteText(el: HTMLElement): string {
  const current = cleanText(el);
  const previous = rendered.get(el);
  if (previous !== undefined && previous === current) {
    const original = el.dataset['tcOrig'];
    if (original !== undefined) return original;
  }
  return current;
}

/** Cheap visibility test that does not force a layout when checkVisibility exists. */
export function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;

  const candidate = el as HTMLElement & {
    checkVisibility?: (options?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean;
  };
  if (typeof candidate.checkVisibility === 'function') {
    try {
      return candidate.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    } catch {
      /* fall through */
    }
  }
  return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
}

/**
 * Text that belongs to the element itself, ignoring child elements.
 *
 * Exchanges mix text and markup inside one cell all the time: gate's amount cell
 * is `<div>4.904710 <div class="animating"/></div>`, so the number lives in a
 * direct text node and a "leaf element only" walk would miss it.
 */
export function ownText(el: Element): string {
  let out = '';
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? '';
  });
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Collect elements that own a short piece of text (their direct text nodes).
 * Children are still visited, so mixed cells expose both the number they own
 * and any numbers nested in them.
 */
export function walkLeaves(root: Element, out: HTMLElement[], maxLeaves = 1200, maxNodes = 20000): void {
  let visited = 0;
  const filter: NodeFilter = {
    acceptNode(node: Node): number {
      const el = node as HTMLElement;
      visited += 1;
      if (visited > maxNodes || out.length >= maxLeaves) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
      if (el.classList.contains(INJECTED)) return NodeFilter.FILTER_REJECT;

      const text = ownText(el);
      if (text && text.length <= 32) {
        out.push(el);
        return out.length >= maxLeaves ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_SKIP;
    },
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, filter);
  walker.nextNode();
}

/** The ancestor of `leaf` whose parent is the row (i.e. the visible cell). */
export function cellOf(leaf: HTMLElement, row: HTMLElement): HTMLElement {
  let node: HTMLElement = leaf;
  while (node.parentElement && node.parentElement !== row) node = node.parentElement;
  return node;
}

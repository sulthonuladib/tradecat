/**
 * Generic orderbook converter.
 *
 * Gate and MEXC (and most other exchanges) render the orderbook differently and
 * change their class names on every deploy, so nothing here depends on class
 * names. Instead we:
 *
 *   1. find the "Price (USDT)" column header,
 *   2. walk up until we find the element that actually contains the rows,
 *   3. inside that element look for numeric leaves where
 *
 *          price * amount ≈ total        (within 2%)
 *
 *      which is exactly what an orderbook row is. That triple check is what
 *      makes the whole thing layout agnostic and safe (it will not touch the
 *      open-orders table, the trade history, or the B/S ratio bar).
 *
 * Then we append an IDR badge after the price and swap the total for its IDR
 * value. Everything is re-applied on a heartbeat + mutation observer, so SPA
 * re-renders, live price flashes and pair switches all keep working.
 */
import { formatIdr, parseNumber, parseNumberInfo, type IdrMode } from './format';

export interface OrderbookConfig {
  showPrice: boolean;
  convertTotal: boolean;
  priceMode: IdrMode;
  volumeMode: IdrMode;
  prefix: string;
  /** Colour for the IDR price badge. Empty = inherit the row colour. */
  priceColor: string;
  /** Colour for the IDR volume. Empty = inherit the cell colour. */
  volumeColor: string;
}

export interface OrderbookHandle {
  rescan(): void;
  stop(): void;
}

interface Triple {
  row: HTMLElement;
  price: HTMLElement;
  amount: HTMLElement;
  total: HTMLElement;
}

const INJECTED = 'tc-injected';
const PRICE_IDR = 'tc-idr-price';

const PRICE_IDR_BASE_STYLE = [
  'margin-left:6px',
  'font-size:0.82em',
  'font-weight:400',
  'line-height:1',
  'white-space:nowrap',
  'letter-spacing:0',
  'display:inline-block',
  'vertical-align:baseline',
  'pointer-events:none',
];

const COLOR_RE = /^(#[0-9a-f]{3,8}|[a-z]{3,24}|rgba?\([\d.,%\s/]+\)|hsla?\([\d.,%\s/]+\))$/i;

/** Only let sane CSS colour values through. */
function sanitizeColor(value: string | null | undefined): string {
  if (!value) return '';
  const candidate = String(value).trim();
  return COLOR_RE.test(candidate) ? candidate : '';
}

function priceBadgeStyle(config: OrderbookConfig): string {
  const color = sanitizeColor(config.priceColor);
  return [...PRICE_IDR_BASE_STYLE, color ? `color:${color}` : 'color:inherit', color ? 'opacity:1' : 'opacity:0.72'].join(';');
}

/** last text we wrote into an element, so we can still read the site's value */
const rendered = new WeakMap<HTMLElement, string>();

/** textContent, but ignoring anything this script injected. */
function cleanText(el: Element): string {
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

/** The value the exchange itself put in this element (not our conversion). */
function siteText(el: HTMLElement): string {
  const current = cleanText(el);
  const previous = rendered.get(el);
  if (previous !== undefined && previous === current) {
    const original = el.dataset.tcOrig;
    if (original !== undefined) return original;
  }
  return current;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CANVAS', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'svg', 'path']);

/** Collect elements that directly hold a short piece of text. */
function walkLeaves(root: Element, out: HTMLElement[], maxLeaves = 1200, maxNodes = 20000): void {
  let visited = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node: Node): number {
      const el = node as HTMLElement;
      visited += 1;
      if (visited > maxNodes || out.length >= maxLeaves) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
      if (el.classList && el.classList.contains(INJECTED)) return NodeFilter.FILTER_REJECT;

      const kids = el.children;
      let hasRealChild = false;
      for (let index = 0; index < kids.length; index += 1) {
        if (!kids[index].classList.contains(INJECTED)) {
          hasRealChild = true;
          break;
        }
      }
      if (hasRealChild) return NodeFilter.FILTER_SKIP;

      const text = cleanText(el);
      if (!text || text.length > 24) return NodeFilter.FILTER_REJECT;

      out.push(el);
      return NodeFilter.FILTER_REJECT;
    },
  } as any);

  walker.nextNode();
}

function lowestCommonAncestor(a: Node, b: Node): Node | null {
  const ancestors = new Set<Node>();
  for (let node: Node | null = a; node; node = node.parentNode) ancestors.add(node);
  for (let node: Node | null = b; node; node = node.parentNode) {
    if (ancestors.has(node)) return node;
  }
  return null;
}

function numericLeavesIn(row: HTMLElement, leaves: HTMLElement[], parsed: Array<{ value: number } | null>): number {
  let count = 0;
  for (let index = 0; index < leaves.length; index += 1) {
    if (parsed[index] == null) continue;
    if (row.contains(leaves[index])) {
      count += 1;
      if (count > 8) break;
    }
  }
  return count;
}

/** Find price/amount/total triples inside `root`. */
function collectTriples(root: HTMLElement): Triple[] {
  const leaves: HTMLElement[] = [];
  walkLeaves(root, leaves);
  if (leaves.length < 3) return [];

  const parsed = leaves.map((el) => parseNumberInfo(siteText(el)));
  const triples: Triple[] = [];
  const seen = new Set<HTMLElement>();

  let i = 0;
  while (i < leaves.length) {
    const priceInfo = parsed[i];
    if (!priceInfo || priceInfo.value <= 0) {
      i += 1;
      continue;
    }
    const price = priceInfo.value;

    let matched = false;
    const maxJ = Math.min(i + 5, leaves.length);
    for (let j = i + 1; j < maxJ && !matched; j += 1) {
      const amountInfo = parsed[j];
      if (!amountInfo || amountInfo.value <= 0) continue;
      const amount = amountInfo.value;
      const maxK = Math.min(j + 5, leaves.length);
      for (let k = j + 1; k < maxK; k += 1) {
        const totalInfo = parsed[k];
        if (!totalInfo || totalInfo.value <= 0) continue;
        const total = totalInfo.value;

        // Tolerance has to cover display rounding of both amount and total,
        // otherwise a tiny price can "match" the fee column by accident.
        const tolerance =
          Math.max(total * 0.02, totalInfo.step * 1.05, price * amountInfo.step * 1.05) + 1e-12;
        if (Math.abs(price * amount - total) > tolerance) continue;

        const rowNode = lowestCommonAncestor(leaves[i], lowestCommonAncestor(leaves[j], leaves[k]) ?? leaves[k]);
        if (!rowNode || !(rowNode instanceof HTMLElement) || rowNode === root || !root.contains(rowNode)) continue;

        const numeric = numericLeavesIn(rowNode, leaves, parsed);
        if (numeric < 3 || numeric > 8) continue;
        if (seen.has(rowNode)) continue;

        seen.add(rowNode);
        triples.push({ row: rowNode, price: leaves[i], amount: leaves[j], total: leaves[k] });
        i = k + 1;
        matched = true;
        break;
      }
    }
    if (!matched) i += 1;
  }

  return triples;
}

function headerKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, '');
}

const PRICE_HEADER_KEYS = new Set(['priceusdt', 'pricetusdt', 'priceusdtprice']);
const TOTAL_HEADER_KEYS = new Set(['totalusdt', 'totaltusdt']);

function isPriceHeader(text: string): boolean {
  return PRICE_HEADER_KEYS.has(headerKey(text));
}

function isTotalHeader(text: string): boolean {
  return TOTAL_HEADER_KEYS.has(headerKey(text));
}

/** Find the "Price (USDT)" / "Total (USDT)" header cells. */
function findHeaders(doc: Document): { price?: HTMLElement; total?: HTMLElement } {
  const result: { price?: HTMLElement; total?: HTMLElement } = {};
  const body = doc.body;
  if (!body) return result;

  // Walk text nodes: headers often live next to a sort arrow or an icon, so
  // matching on element textContent alone is not reliable.
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const raw = (node.nodeValue || '').trim();
      if (!raw || raw.length > 24) return NodeFilter.FILTER_REJECT;
      const parent = (node as Text).parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;

      // Text nodes can be split ("Price " + "(USDT)"); use the whole element
      // text when the element has no element children of its own.
      const text = parent.children.length === 0 ? (parent.textContent || '').trim() : raw;
      if (isPriceHeader(text)) {
        if (!result.price) result.price = parent;
      } else if (isTotalHeader(text)) {
        if (!result.total) result.total = parent;
      }
      return NodeFilter.FILTER_REJECT;
    },
  } as any);

  walker.nextNode();
  return result;
}

function findContainer(anchor: HTMLElement, totalHeader?: HTMLElement): HTMLElement | null {
  let fallback: HTMLElement | null = null;
  let node: HTMLElement | null = anchor;
  for (let depth = 0; node && depth < 14; depth += 1, node = node.parentElement) {
    const triples = collectTriples(node);
    if (triples.length >= 2) return node;
    // A collapsed orderbook can show a single row; accept that only when the
    // container also holds the Total header, to stay on the safe side.
    if (!fallback && triples.length === 1 && totalHeader && node.contains(totalHeader)) fallback = node;
  }
  return fallback;
}

function cellOf(leaf: HTMLElement, row: HTMLElement): HTMLElement {
  let node: HTMLElement = leaf;
  while (node.parentElement && node.parentElement !== row) node = node.parentElement;
  return node;
}

function applyTriples(triples: Triple[], rate: number, config: OrderbookConfig): void {
  const badgeStyle = priceBadgeStyle(config);
  const volumeColor = sanitizeColor(config.volumeColor);

  for (const triple of triples) {
    if (config.showPrice) {
      const price = parseNumber(siteText(triple.price));
      if (price != null && price > 0) {
        const text = formatIdr(price * rate, { prefix: config.prefix, mode: config.priceMode });
        const cell = cellOf(triple.price, triple.row);
        let badge = cell.querySelector<HTMLElement>(':scope > .' + PRICE_IDR);
        if (!badge) {
          badge = document.createElement('span');
          badge.className = `${INJECTED} ${PRICE_IDR}`;
          cell.appendChild(badge);
        }
        if (badge.dataset.tcStyle !== badgeStyle) {
          badge.dataset.tcStyle = badgeStyle;
          badge.setAttribute('style', badgeStyle);
        }
        if (badge.textContent !== text) badge.textContent = text;
      }
    }

    if (config.convertTotal) {
      const target = triple.total;
      const original = siteText(target);
      const total = parseNumber(original);
      if (total == null || total <= 0) continue;

      if ((target.dataset.tcVolColor ?? '') !== volumeColor) {
        target.dataset.tcVolColor = volumeColor;
        target.style.color = volumeColor;
      }

      const text = formatIdr(total * rate, { prefix: config.prefix, mode: config.volumeMode });
      if (cleanText(target) === text) continue;
      rendered.set(target, text);
      target.dataset.tcOrig = original;
      target.textContent = text;
    }
  }
}

/** Debug helper: what the engine currently sees. */
export function describeOrderbook(): { header: string | null; container: string | null; rows: number; sample: string[] } {
  const headers = findHeaders(document);
  const anchor = headers.price ?? headers.total ?? null;
  const container = anchor ? findContainer(anchor, headers.total) : null;
  const triples = container ? collectTriples(container) : [];
  return {
    header: anchor ? cleanText(anchor) : null,
    container: container ? `${container.tagName.toLowerCase()}${container.className ? '.' + String(container.className).split(/\s+/).join('.') : ''}` : null,
    rows: triples.length,
    sample: triples.slice(0, 3).map((t) => `${siteText(t.price)} × ${siteText(t.amount)} = ${siteText(t.total)}`),
  };
}

export function startOrderbook(options: {
  getRate: () => number;
  getConfig: () => OrderbookConfig;
}): OrderbookHandle {
  let container: HTMLElement | null = null;
  let anchor: HTMLElement | null = null;
  let observer: MutationObserver | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const observe = (el: HTMLElement): void => {
    observer?.disconnect();
    observer = new MutationObserver(() => schedule(80));
    observer.observe(el, { childList: true, subtree: true, characterData: true });
  };

  const locate = (): boolean => {
    const headers = findHeaders(document);
    anchor = headers.price ?? headers.total ?? null;
    if (!anchor) return false;
    const found = findContainer(anchor, headers.total);
    if (!found) return false;
    container = found;
    observe(found);
    return true;
  };

  const tick = (): void => {
    if (stopped) return;
    if (!container || !container.isConnected) {
      container = null;
      if (!locate()) return;
    }
    if (!container) return;
    const config = options.getConfig();
    const triples = collectTriples(container);
    if (triples.length === 0) {
      // The layout changed under us - look again on the next beat.
      container = null;
      return;
    }
    applyTriples(triples, options.getRate(), config);
  };

  const schedule = (delay = 120): void => {
    if (stopped || debounce !== null) return;
    debounce = setTimeout(() => {
      debounce = null;
      tick();
    }, delay);
  };

  const start = (): void => {
    if (!locate()) {
      // Not rendered yet (SPA hydration) - keep retrying from the heartbeat.
    }
    tick();
    heartbeat = setInterval(tick, 700);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  return {
    rescan: () => {
      container = null;
      schedule(0);
    },
    stop: () => {
      stopped = true;
      if (debounce) clearTimeout(debounce);
      if (heartbeat) clearInterval(heartbeat);
      observer?.disconnect();
    },
  };
}

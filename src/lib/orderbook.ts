/**
 * Orderbook converter engine.
 *
 * Locating rows is delegated to a per-exchange adapter (see `./exchanges`).
 * This module owns everything else:
 *
 *   - re-locating when the exchange re-renders (SPA route changes, payload
 *     swaps, virtualised scrolling) and throttling the expensive scans,
 *   - appending the IDR price badge next to every price,
 *   - replacing the Total (USDT) cell with its IDR value,
 *   - keeping all of that stable under React-style re-renders.
 *
 * Layout safety: a badge is never wider than the price cell. When the configured
 * format does not fit, the badge degrades to compact (`1,44 M`) and then to a
 * tight compact (`1,44M`, smaller font). A `title` always carries the full IDR
 * value, and the volume column does the same (compact when full would clip).
 */
import { cleanText, INJECTED, markRendered, PRICE_IDR, siteText } from './dom';
import type { OrderRow } from './detect';
import { adapterFor, type ExchangeAdapter } from './exchanges';
import { formatIdr, parseNumber, type IdrMode } from './format';
import type { SiteId } from './site';

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
  /** Degrade to compact / smaller text when the full number would be clipped. */
  fit: boolean;
}

export interface OrderbookHandle {
  rescan(): void;
  stop(): void;
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|[a-z]{3,24}|rgba?\([\d.,%\s/]+\)|hsla?\([\d.,%\s/]+\))$/i;

/** Only let sane CSS colour values through. */
function sanitizeColor(value: string | null | undefined): string {
  if (!value) return '';
  const candidate = String(value).trim();
  return COLOR_RE.test(candidate) ? candidate : '';
}

const PRICE_IDR_BASE_STYLE = [
  'font-weight:400',
  'line-height:1',
  'white-space:nowrap',
  'letter-spacing:0',
  'display:inline-block',
  'vertical-align:baseline',
  'pointer-events:none',
  'user-select:none',
  'font-variant-numeric:tabular-nums',
];

function priceBadgeStyle(config: OrderbookConfig, fontSizeEm: number, gapPx: number): string {
  const color = sanitizeColor(config.priceColor);
  return [
    ...PRICE_IDR_BASE_STYLE,
    `margin-left:${gapPx}px`,
    `font-size:${fontSizeEm}em`,
    `color:${color || 'inherit'}`,
    `opacity:${color ? '1' : '0.72'}`,
  ].join(';');
}

function ensureBadge(cell: HTMLElement): HTMLElement {
  let badge = cell.querySelector<HTMLElement>(':scope > .' + PRICE_IDR);
  if (!badge) {
    badge = document.createElement('span');
    badge.className = `${INJECTED} ${PRICE_IDR}`;
    badge.setAttribute('aria-hidden', 'true');
    cell.appendChild(badge);
  }
  return badge;
}

// --- text measurement ----------------------------------------------------
//
// Deciding whether the full IDR number fits must not force a layout on every
// price tick, so widths come from a canvas plus one cached `clientWidth` read
// per cell. The width is pinned for the current layout and only re-read after a
// window resize, so the badge can never grow its own budget.

interface CellMetrics {
  contentWidth: number;
  fontPx: number;
  weight: string;
  family: string;
  epoch: number;
}

const metricsCache = new WeakMap<HTMLElement, CellMetrics>();

// A cell's width is captured *before* the badge exists and then kept for the
// current layout. Re-measuring after insertion would let the badge enlarge its
// own budget and squeeze the amount columns of a flex row.
let widthEpoch = 0;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'resize',
    () => {
      widthEpoch += 1;
    },
    { passive: true },
  );
}
let canvasCtx: CanvasRenderingContext2D | null | undefined;

function measureText(text: string, font: string): number {
  if (!text) return 0;
  if (canvasCtx === undefined) {
    try {
      canvasCtx = document.createElement('canvas').getContext('2d');
    } catch {
      canvasCtx = null;
    }
  }
  if (!canvasCtx) return text.length * 7;
  canvasCtx.font = font;
  return canvasCtx.measureText(text).width;
}

function metricsFor(cell: HTMLElement): CellMetrics | null {
  const cached = metricsCache.get(cell);
  if (cached && cached.epoch === widthEpoch) return cached;

  let style: CSSStyleDeclaration;
  try {
    style = getComputedStyle(cell);
  } catch {
    return null;
  }

  const fontPx = parseFloat(style.fontSize) || 12;
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const contentWidth = cell.clientWidth - padding;
  if (!(contentWidth > 0)) return null;

  const metrics: CellMetrics = {
    contentWidth,
    fontPx,
    weight: style.fontWeight || '400',
    family: style.fontFamily || 'sans-serif',
    epoch: widthEpoch,
  };
  metricsCache.set(cell, metrics);
  return metrics;
}

interface TextChoice {
  text: string;
  fontEm: number;
  gapPx: number;
}

/**
 * Full IDR, compact IDR or tight compact - whichever fits the cell. Narrow
 * exchange columns (MEXC's price cell is ~82px) can need the smallest tier.
 */
function choosePriceText(
  full: string,
  compact: string,
  priceText: string,
  metrics: CellMetrics | null,
  fit: boolean,
): TextChoice {
  const regular: TextChoice = { text: full, fontEm: 0.82, gapPx: 6 };
  if (!fit || !metrics) return regular;

  const font = (em: number): string =>
    `${metrics.weight} ${Math.max(8, metrics.fontPx * em).toFixed(2)}px ${metrics.family}`;
  const base = measureText(priceText, font(1));
  const tight = compact.replace(/\s+/g, '');
  const fits = (text: string, em: number, gap: number): boolean =>
    base + gap + measureText(text, font(em)) <= metrics.contentWidth + 0.5;

  if (fits(regular.text, regular.fontEm, regular.gapPx)) return regular;

  const compactChoice: TextChoice = { text: compact, fontEm: 0.82, gapPx: 6 };
  if (fits(compactChoice.text, compactChoice.fontEm, compactChoice.gapPx)) return compactChoice;

  const tightChoice: TextChoice = { text: tight, fontEm: 0.68, gapPx: 4 };
  if (fits(tightChoice.text, tightChoice.fontEm, tightChoice.gapPx)) return tightChoice;

  return { text: tight, fontEm: 0.62, gapPx: 2 };
}

/** Should the full IDR volume be replaced by compact text? */
function chooseVolumeText(full: string, compact: string, metrics: CellMetrics | null, fit: boolean): string {
  if (!fit || !metrics) return full;
  const font = `${metrics.weight} ${metrics.fontPx}px ${metrics.family}`;
  return measureText(full, font) <= metrics.contentWidth + 0.5 ? full : compact;
}

// --- rendering -----------------------------------------------------------

interface PriceWrite {
  cell: HTMLElement;
  text: string;
  full: string;
  style: string;
}

interface VolumeWrite {
  target: HTMLElement;
  text: string;
  original: string;
  color: string;
}

function planRows(
  rows: OrderRow[],
  rate: number,
  config: OrderbookConfig,
): { prices: PriceWrite[]; volumes: VolumeWrite[] } {
  const prices: PriceWrite[] = [];
  const volumes: VolumeWrite[] = [];
  const volumeColor = sanitizeColor(config.volumeColor);

  for (const row of rows) {
    const priceText = siteText(row.price.el);
    const price = parseNumber(priceText);

    if (config.showPrice && price != null && price > 0) {
      const idr = price * rate;
      const full = formatIdr(idr, { prefix: config.prefix, mode: config.priceMode });
      const compact = formatIdr(idr, { prefix: config.prefix, mode: 'compact' });
      const metrics = metricsFor(row.priceCell);
      const choice = choosePriceText(full, compact, priceText, metrics, config.fit);
      prices.push({
        cell: row.priceCell,
        text: choice.text,
        full,
        style: priceBadgeStyle(config, choice.fontEm, choice.gapPx),
      });
    }

    if (config.convertTotal) {
      const original = siteText(row.total.el);
      const total = parseNumber(original);
      if (total == null || total <= 0) continue;

      const idr = total * rate;
      const full = formatIdr(idr, { prefix: config.prefix, mode: config.volumeMode });
      const compact = formatIdr(idr, { prefix: config.prefix, mode: 'compact' });
      const metrics = metricsFor(row.totalCell);
      volumes.push({
        target: row.total.el,
        text: chooseVolumeText(full, compact, metrics, config.fit),
        original,
        color: volumeColor,
      });
    }
  }

  return { prices, volumes };
}

function applyPlan(plan: { prices: PriceWrite[]; volumes: VolumeWrite[] }): void {
  for (const write of plan.prices) {
    const badge = ensureBadge(write.cell);
    if (badge.dataset['tcStyle'] !== write.style) {
      badge.dataset['tcStyle'] = write.style;
      badge.setAttribute('style', write.style);
    }
    if (badge.textContent !== write.text) badge.textContent = write.text;
    if (badge.getAttribute('title') !== write.full) badge.setAttribute('title', write.full);
  }

  for (const write of plan.volumes) {
    if (write.color) {
      if (write.target.style.color !== write.color) write.target.style.color = write.color;
    }
    if (cleanText(write.target) === write.text) continue;
    markRendered(write.target, write.text);
    write.target.dataset['tcOrig'] = write.original;
    write.target.textContent = write.text;
  }
}

// --- lifecycle -----------------------------------------------------------

/** Element that covers all rows, used as the mutation-observer root. */
function rootFor(rows: OrderRow[]): HTMLElement | null {
  const first = rows[0];
  if (!first) return null;
  let node: HTMLElement | null = first.row.parentElement;
  for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
    if (rows.every((row) => node?.contains(row.row))) return node;
  }
  return first.row.parentElement;
}

/** Debug helper: what the engine currently sees. */
export function describeOrderbook(site?: SiteId): {
  adapter: string;
  rows: number;
  sample: string[];
} {
  const adapter: ExchangeAdapter = adapterFor(site);
  const rows = adapter.locate(document) ?? [];
  return {
    adapter: adapter.id,
    rows: rows.length,
    sample: rows
      .slice(0, 3)
      .map((row) => {
        const amount = row.amount ? siteText(row.amount.el) : '?';
        return `${siteText(row.price.el)} × ${amount} = ${siteText(row.total.el)}`;
      }),
  };
}

export function startOrderbook(options: {
  site?: SiteId;
  getRate: () => number;
  getConfig: () => OrderbookConfig;
}): OrderbookHandle {
  const adapter = adapterFor(options.site);
  let rows: OrderRow[] | null = null;
  let locatedAt = 0;
  let observer: MutationObserver | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const observe = (root: HTMLElement | null): void => {
    observer?.disconnect();
    if (!root) return;
    observer = new MutationObserver(() => schedule(60));
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  };

  const locate = (): void => {
    const found = adapter.locate(document);
    rows = found && found.length > 0 ? found : null;
    locatedAt = Date.now();
    observe(rows ? rootFor(rows) : null);
  };

  const tick = (): void => {
    if (stopped) return;

    const stale =
      !rows ||
      rows.length === 0 ||
      Date.now() - locatedAt > adapter.cacheMs ||
      rows.some((row) => !row.row.isConnected);

    if (stale) locate();
    if (!rows || rows.length === 0) return;

    const config = options.getConfig();
    applyPlan(planRows(rows, options.getRate(), config));
  };

  const schedule = (delay = 120): void => {
    if (stopped || debounce !== null) return;
    debounce = setTimeout(() => {
      debounce = null;
      tick();
    }, delay);
  };

  const start = (): void => {
    locate();
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
      rows = null;
      locatedAt = 0;
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

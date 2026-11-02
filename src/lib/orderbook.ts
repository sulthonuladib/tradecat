/**
 * Orderbook converter engine.
 *
 * Locating rows is delegated to a per-exchange adapter (see `./exchanges`).
 * This module owns rendering, rate updates and re-render survival.
 *
 * The IDR price is drawn in an **overlay layer** (`.tc-idr-layer`) anchored to
 * the row list, not injected into the exchange's cells. Exchanges re-render
 * cells constantly (React replaces text nodes and wipes unknown children, MEXC
 * does it on every tick), so anything inside a cell disappears immediately. The
 * reference scripts solved this by absolutely positioning a column of gold
 * numbers; we do the same, but derive the position from the live row geometry
 * instead of hardcoded pixel margins, so it adapts to any panel width, row
 * height or exchange layout.
 *
 * The Total (USDT) cell is still rewritten in place: it is a value the exchange
 * itself re-renders, and the engine re-applies it right after.
 *
 * Number choice: full IDR if it fits beside the price, otherwise compact at the
 * same font size (`1,41 M`), then a tight compact. The full IDR value always
 * stays in the `title` tooltip.
 */
import { cleanText, INJECTED, markRendered, PRICE_IDR, siteText } from './dom';
import { refreshRow, type OrderRow } from './detect';
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

const LAYER = 'tc-idr-layer';
type Placement = 'price' | 'amount';

const BADGE_BASE_STYLE = [
  'position:absolute',
  'font-weight:400',
  'white-space:nowrap',
  'letter-spacing:0',
  'display:inline-block',
  'pointer-events:none',
  'user-select:none',
  'font-variant-numeric:tabular-nums',
  'z-index:1',
];

const LAYER_STYLE = [
  'position:absolute',
  'left:0',
  'top:0',
  'width:0',
  'height:0',
  'overflow:visible',
  'pointer-events:none',
  'z-index:1',
].join(';');

// --- text measurement ----------------------------------------------------
//
// Deciding whether a number fits must not force a layout on every price tick,
// so widths come from a canvas plus one cached `clientWidth` read per cell.

interface CellMetrics {
  contentWidth: number;
  fontPx: number;
  weight: string;
  family: string;
  position: string;
  epoch: number;
}

const metricsCache = new WeakMap<HTMLElement, CellMetrics>();

// Cell widths are pinned for the current layout (and re-read after a window
// resize), so the badge can never grow its own budget and squeeze the amounts.
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
    position: style.position || 'static',
    epoch: widthEpoch,
  };
  metricsCache.set(cell, metrics);
  return metrics;
}

function fontFor(metrics: CellMetrics, em: number): string {
  return `${metrics.weight} ${Math.max(8, metrics.fontPx * em).toFixed(2)}px ${metrics.family}`;
}

interface TextChoice {
  text: string;
  fontEm: number;
  placement: Placement;
}

/**
 * Full IDR, compact IDR or tight compact - whichever fits beside the price.
 *
 * Prices are left-aligned and amounts right-aligned, so the free space sits to
 * the right of the price (or the left of the amount). Compact stays at 1em:
 * `1,41 M` is readable where a shrunken `1.403.458.200` is not.
 */
function choosePriceText(
  full: string,
  compact: string,
  priceText: string,
  priceMetrics: CellMetrics | null,
  amountText: string | null,
  amountMetrics: CellMetrics | null,
  fit: boolean,
): TextChoice {
  const tight = compact.replace(/\s+/g, '');
  if (!fit || !priceMetrics) return { text: full, fontEm: 0.85, placement: 'price' };

  const tiers: Array<{ text: string; em: number }> = [
    { text: full, em: 0.85 },
    { text: compact, em: 1 },
    { text: tight, em: 1 },
    { text: tight, em: 0.85 },
  ];

  const fitsIn = (metrics: CellMetrics, leadingText: string, tier: { text: string; em: number }): boolean => {
    const free = metrics.contentWidth - measureText(leadingText, fontFor(metrics, 1)) - 2;
    return free > 0 && measureText(tier.text, fontFor(metrics, tier.em)) <= free;
  };

  for (const tier of tiers) {
    if (fitsIn(priceMetrics, priceText, tier)) {
      return { text: tier.text, fontEm: tier.em, placement: 'price' };
    }
  }

  // Very narrow price cell: use the empty left side of the right-aligned amount.
  if (amountMetrics && amountText) {
    for (const tier of tiers) {
      if (fitsIn(amountMetrics, amountText, tier)) {
        return { text: tier.text, fontEm: tier.em, placement: 'amount' };
      }
    }
  }

  const last = tiers[tiers.length - 1];
  return { text: last?.text ?? tight, fontEm: last?.em ?? 0.85, placement: 'price' };
}

/** Full IDR volume, degraded only when it would not fit the total cell. */
function chooseVolumeText(
  full: string,
  compact: string,
  metrics: CellMetrics | null,
  fit: boolean,
): string {
  if (!fit || !metrics) return full;
  const font = fontFor(metrics, 1);
  const available = metrics.contentWidth - 2;
  if (measureText(full, font) <= available) return full;
  if (measureText(compact, font) <= available) return compact;
  return compact.replace(/\s+/g, '');
}

// --- overlay -------------------------------------------------------------

interface BadgeEntry {
  badge: HTMLElement;
  host: HTMLElement;
  layer: HTMLElement;
}

const badgeState = new Map<HTMLElement, BadgeEntry>();
const layers = new Set<HTMLElement>();
const hostPositions = new WeakSet<HTMLElement>();

function layerFor(host: HTMLElement): HTMLElement {
  const existing = host.querySelector<HTMLElement>(':scope > .' + LAYER);
  if (existing) return existing;

  const layer = document.createElement('div');
  layer.className = `${INJECTED} ${LAYER}`;
  layer.setAttribute('aria-hidden', 'true');
  layer.setAttribute('style', LAYER_STYLE);
  host.appendChild(layer);
  layers.add(layer);

  if (!hostPositions.has(host)) {
    hostPositions.add(host);
    try {
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    } catch {
      /* ignore */
    }
  }
  return layer;
}

function badgeFor(row: HTMLElement, host: HTMLElement): BadgeEntry {
  const existing = badgeState.get(row);
  if (existing && existing.host === host && existing.badge.isConnected) return existing;
  if (existing) existing.badge.remove();

  const layer = layerFor(host);
  const badge = document.createElement('span');
  badge.className = `${INJECTED} ${PRICE_IDR}`;
  badge.setAttribute('aria-hidden', 'true');
  layer.appendChild(badge);

  const entry: BadgeEntry = { badge, host, layer };
  badgeState.set(row, entry);
  return entry;
}

function cleanupBadges(keep: Set<HTMLElement>): void {
  for (const [row, entry] of badgeState) {
    if (keep.has(row) && row.isConnected) continue;
    entry.badge.remove();
    badgeState.delete(row);
  }
  for (const layer of layers) {
    if (!layer.isConnected) {
      layers.delete(layer);
      continue;
    }
    if (layer.childElementCount === 0) {
      layer.remove();
      layers.delete(layer);
    }
  }
}

/** Remove every overlay (e.g. when the script is disabled at runtime). */
function clearOverlays(): void {
  for (const entry of badgeState.values()) entry.badge.remove();
  badgeState.clear();
  for (const layer of layers) layer.remove();
  layers.clear();
}

/**
 * An anchor for a row: the nearest ancestor that holds at least two rows.
 * This skips per-row wrappers (MEXC's absolutely positioned `tableRow`) and
 * lands on the list container whose coordinate space the overlay shares.
 */
function hostFor(row: HTMLElement, rowElements: HTMLElement[]): HTMLElement {
  let node = row.parentElement;
  for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
    let found = 0;
    for (const el of rowElements) {
      if (found >= 2) break;
      if (node.contains(el)) found += 1;
    }
    if (found >= 2) return node;
  }
  return row.parentElement ?? document.body;
}

// --- rendering -----------------------------------------------------------

interface PriceWrite {
  rowEl: HTMLElement;
  host: HTMLElement;
  cell: HTMLElement;
  text: string;
  full: string;
  fontEm: number;
  placement: Placement;
  textWidth: number;
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
  const rowElements = rows.map((row) => row.row);

  for (const row of rows) {
    const priceText = siteText(row.price.el);
    const price = parseNumber(priceText);

    if (config.showPrice && price != null && price > 0) {
      const idr = price * rate;
      const full = formatIdr(idr, { prefix: config.prefix, mode: config.priceMode });
      const compact = formatIdr(idr, { prefix: config.prefix, mode: 'compact' });
      const priceMetrics = metricsFor(row.priceCell);
      const amountText = row.amount ? siteText(row.amount.el) : null;
      const amountMetrics = row.amountCell ? metricsFor(row.amountCell) : null;
      const choice = choosePriceText(
        full,
        compact,
        priceText,
        priceMetrics,
        amountText,
        amountMetrics,
        config.fit,
      );
      const cell = choice.placement === 'amount' && row.amountCell ? row.amountCell : row.priceCell;
      const hostMetrics = choice.placement === 'amount' ? amountMetrics : priceMetrics;

      prices.push({
        rowEl: row.row,
        host: hostFor(row.row, rowElements),
        cell,
        text: choice.text,
        full,
        fontEm: choice.fontEm,
        placement: choice.placement,
        textWidth: hostMetrics
          ? measureText(choice.text, fontFor(hostMetrics, choice.fontEm))
          : choice.text.length * 7,
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

function applyPrices(writes: PriceWrite[], config: OrderbookConfig): void {
  const keep = new Set<HTMLElement>();
  const color = sanitizeColor(config.priceColor);

  // Pass 1: make sure every row has a badge in the right layer (no layout reads).
  const placed: Array<{ write: PriceWrite; entry: BadgeEntry }> = [];
  for (const write of writes) {
    const entry = badgeFor(write.rowEl, write.host);
    keep.add(write.rowEl);
    placed.push({ write, entry });
  }
  cleanupBadges(keep);

  // Pass 2: read geometry...
  const positions = placed.map(({ write, entry }) => {
    const cellRect = write.cell.getBoundingClientRect();
    const layerRect = entry.layer.getBoundingClientRect();
    return { write, entry, cellRect, layerRect };
  });

  // Pass 3: write styles/text.
  for (const { write, entry, cellRect, layerRect } of positions) {
    if (cellRect.width <= 0 || cellRect.height <= 0) {
      entry.badge.style.display = 'none';
      continue;
    }

    const width = write.textWidth + 2;
    const left =
      write.placement === 'price'
        ? cellRect.left - layerRect.left + cellRect.width - width - 2
        : cellRect.left - layerRect.left + 2;
    const top = cellRect.top - layerRect.top;
    const height = cellRect.height;
    const style = [
      ...BADGE_BASE_STYLE,
      `left:${Math.round(left)}px`,
      `top:${Math.round(top)}px`,
      `height:${Math.round(height)}px`,
      `line-height:${Math.round(height)}px`,
      `font-size:${write.fontEm}em`,
      `color:${color || 'inherit'}`,
      `opacity:${color ? '1' : '0.75'}`,
    ].join(';');

    if (entry.badge.dataset['tcStyle'] !== style) {
      entry.badge.dataset['tcStyle'] = style;
      entry.badge.setAttribute('style', `${style};display:inline-block`);
    } else if (entry.badge.style.display === 'none') {
      entry.badge.style.display = 'inline-block';
    }
    if (entry.badge.textContent !== write.text) entry.badge.textContent = write.text;
    if (entry.badge.getAttribute('title') !== write.full) entry.badge.setAttribute('title', write.full);
  }
}

function applyVolumes(writes: VolumeWrite[]): void {
  for (const write of writes) {
    if (write.color && write.target.style.color !== write.color) {
      write.target.style.color = write.color;
    }
    if (cleanText(write.target) === write.text) continue;
    markRendered(write.target, write.text);
    write.target.dataset['tcOrig'] = write.original;
    write.target.textContent = write.text;
  }
}

// --- lifecycle -----------------------------------------------------------

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

  const locate = (): void => {
    const found = adapter.locate(document) ?? [];

    // Keep rows we already mapped while their elements are still in the DOM.
    // Exchanges re-render text in place, and a row that is momentarily
    // mid-animation must not lose its badge (or keep a stale one).
    const merged = new Map<HTMLElement, OrderRow>();
    for (const row of rows ?? []) {
      if (row.row.isConnected) merged.set(row.row, row);
    }
    for (const row of found) merged.set(row.row, row);

    rows = merged.size > 0 ? [...merged.values()] : null;
    locatedAt = Date.now();
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

    // Cells can be replaced inside a row between ticks; re-map them from the
    // live DOM so we never write into a detached cell.
    const current: OrderRow[] = [];
    for (const row of rows) {
      const fresh = refreshRow(row);
      if (fresh) current.push(fresh);
    }
    if (current.length === 0) return;

    const config = options.getConfig();
    const plan = planRows(current, options.getRate(), config);
    applyVolumes(plan.volumes);
    applyPrices(plan.prices, config);
  };

  const schedule = (delay = 120): void => {
    if (stopped || debounce !== null) return;
    debounce = setTimeout(() => {
      debounce = null;
      tick();
    }, delay);
  };

  const start = (): void => {
    // Watch the whole document: the exchange replaces cells *and* list
    // containers, so an observer bound to the old row container goes silent.
    observer = new MutationObserver(() => schedule(60));
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

    // Overlay badges are positioned from live geometry, so keep them in sync
    // when the panel is scrolled or resized.
    document.addEventListener('scroll', () => schedule(0), { capture: true, passive: true });
    window.addEventListener('resize', () => schedule(0), { passive: true });

    locate();
    tick();
    heartbeat = setInterval(tick, 500);
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
      clearOverlays();
    },
  };
}

/**
 * Bybit converted orderbook.
 *
 * Bybit draws its spot book on a `<canvas>`, so there are no cells to overlay.
 * Instead of polling, this hooks the page's own depth feed: Bybit feeds the book
 * to a `Worker` and expects `worker.onmessage`, so the setter is wrapped (the
 * same trick as `Bybit Price Interceptor.user.js`) and every `spot.ob_` frame is
 * captured before the page handler runs.
 *
 * The panel reproduces Bybit's own orderbook component as closely as possible:
 * the same 316px width, tab header with the orange underline, 24px rows, red
 * asks / green bids, depth bars and the mid-price row. It docks between the
 * chart and the native orderbook (the chart is narrowed to make room) and can
 * be dragged away like any other panel; a dock button puts it back.
 *
 * The hook has to be installed at `document-start`, before Bybit creates its
 * worker, which is why `installBybitDepthHook()` is called at the top of
 * `main.ts` rather than from `boot()`.
 */
import { formatIdr, parseNumber } from './format';
import { currentRate } from './rate';
import { currentPair } from './site';
import { getStored, requestJson, setStored } from './store';

export interface BybitBookHandle {
  refresh(): void;
  destroy(): void;
  describe(): { adapter: string; rows: number; sample: string[] };
}

type Level = [string, string];

interface Depth {
  a: Level[];
  b: Level[];
  at: number;
}

const PANEL_WIDTH = 316;
const GAP = 4;
const HEADER_H = 42;
const SUB_H = 30;
const COLS_H = 32;
const MID_H = 40;
const MIN_ROW_H = 24;
const MAX_ROWS = 24;
const POLL_FALLBACK_MS = 4000;
const POLL_INTERVAL_MS = 3000;
const COLLAPSE_KEY = 'ui.bybit.collapsed';
const POS_KEY = 'ui.bybit.pos';

const SELL_COLOR = '#f63649';
const BUY_COLOR = '#06c167';
const ACCENT = '#ff9c2e';

// --- depth interception --------------------------------------------------

let installed = false;
let latest: Depth | null = null;
let restDepth: Depth | null = null;
const listeners = new Set<() => void>();

function ingest(a: unknown, b: unknown): void {
  if (!Array.isArray(a) || !Array.isArray(b)) return;
  const asks = a.filter((row): row is Level => Array.isArray(row) && row.length >= 2) as Level[];
  const bids = b.filter((row): row is Level => Array.isArray(row) && row.length >= 2) as Level[];
  if (!asks.length && !bids.length) return;
  latest = { a: asks, b: bids, at: Date.now() };
  for (const listener of listeners) listener();
}

/** Wrap `Worker.prototype.onmessage` so we see the same frames the page sees. */
export function installBybitDepthHook(): void {
  if (installed) return;
  if (typeof Worker === 'undefined') return;
  installed = true;

  try {
    const proto = Worker.prototype as any;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'onmessage');
    if (!descriptor?.get || !descriptor.set) return;

    Object.defineProperty(proto, 'onmessage', {
      configurable: true,
      enumerable: descriptor.enumerable ?? true,
      get: descriptor.get,
      set(this: Worker, handler: ((this: Worker, event: MessageEvent) => unknown) | null) {
        const wrapped = function (this: Worker, event: MessageEvent): unknown {
          try {
            const message = event?.data;
            if (message && message.topic === 'spot.ob_') {
              const data = message.data?.data ?? message.data;
              ingest(data?.a, data?.b);
            }
          } catch {
            /* never break the page's own handler */
          }
          return typeof handler === 'function' ? handler.call(this, event) : undefined;
        };
        return descriptor.set?.call(this, wrapped);
      },
    });
  } catch {
    /* a page with a locked-down Worker still gets the REST fallback */
  }
}

// --- rendering -----------------------------------------------------------

const CSS = `
:host { all: initial; }
.panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  font: 12px/1.2 Inter, -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif;
  color: #ffffff;
  background: #101014;
  border-radius: 0;
  overflow: hidden;
  user-select: none;
}
.panel[data-collapsed="true"] .sub,
.panel[data-collapsed="true"] .cols,
.panel[data-collapsed="true"] .rows { display: none; }
.head {
  display: flex; align-items: stretch; flex: none;
  height: ${HEADER_H}px; padding-left: 12px;
  background: #101014;
  cursor: move;
}
.tabs { display: flex; align-items: stretch; gap: 16px; flex: 1; }
.tab {
  display: flex; align-items: flex-start; padding-top: 12px;
  font-size: 14px; font-weight: 500; line-height: 18px;
  color: #ffffff; border-bottom: 2px solid transparent;
}
.tab.active { border-bottom-color: ${ACCENT}; }
.tab.muted { color: #6a6e73; cursor: default; pointer-events: none; }
.head .icons { display: flex; align-items: center; gap: 2px; padding-right: 4px; }
.icon {
  all: unset; cursor: pointer; padding: 4px 5px; border-radius: 4px;
  color: #6a6e73; font-size: 13px; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
}
.icon:hover { color: #ffffff; background: rgba(255,255,255,0.06); }
.sub {
  display: flex; align-items: center; gap: 6px; flex: none;
  height: ${SUB_H}px; padding: 0 12px;
  color: #6a6e73; font-size: 12px; font-weight: 500;
}
.sub .pair { color: #ffffff; }
.sub .status { color: #6a6e73; }
.sub .spacer { flex: 1; }
.sub .rate { color: #6a6e73; font-size: 11px; }
.cols {
  display: grid; grid-template-columns: 118px 86px 88px; gap: 0;
  align-items: center; flex: none;
  height: ${COLS_H}px; padding: 0 12px;
  color: #6a6e73; font-size: 12px; font-weight: 500;
}
.cols span:nth-child(2), .cols span:nth-child(3) { text-align: right; }
.cols .arrow { margin-left: 3px; font-size: 9px; }
.rows { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
.sell, .buy { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.row {
  position: relative; flex: 1; min-height: ${MIN_ROW_H}px;
  display: grid; grid-template-columns: 118px 86px 88px; gap: 0;
  align-items: center; padding: 0 12px; overflow: hidden;
  font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap;
}
.row .depth {
  position: absolute; right: 0; top: 0; height: 100%;
  z-index: 0; transition: width 0.15s ease-out;
}
.row.sell .depth { background: rgba(239, 69, 74, 0.34); }
.row.buy .depth { background: rgba(32, 178, 108, 0.34); }
.row .v { position: relative; z-index: 1; overflow: hidden; text-overflow: ellipsis; }
.row .v.price { color: ${SELL_COLOR}; }
.row.buy .v.price { color: ${BUY_COLOR}; }
.row .v.qty, .row .v.total { color: #ffffff; text-align: right; }
.mid {
  display: flex; align-items: center; gap: 8px; flex: none;
  height: ${MID_H}px; padding: 0 12px;
  background: #101014;
  border-top: 1px solid #1c1e24; border-bottom: 1px solid #1c1e24;
  font-variant-numeric: tabular-nums;
}
.mid .arrow {
  width: 0; height: 0; flex: none;
  border-left: 5px solid transparent; border-right: 5px solid transparent;
}
.mid.down .arrow { border-top: 8px solid ${SELL_COLOR}; }
.mid.up .arrow { border-bottom: 8px solid ${BUY_COLOR}; }
.mid .cur { font-size: 16px; font-weight: 600; line-height: 18px; }
.mid.down .cur { color: ${SELL_COLOR}; }
.mid.up .cur { color: ${BUY_COLOR}; }
.mid .approx { color: #6a6e73; font-size: 12px; }
.mid .spacer { flex: 1; }
`;

interface ConvertedRow {
  price: string;
  qty: string;
  total: string;
  pct: number;
}

interface RowParts {
  el: HTMLElement;
  depth: HTMLElement;
  price: HTMLElement;
  qty: HTMLElement;
  total: HTMLElement;
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const currency = (value: number): string => formatIdr(value, { decimals: 2 });
const compact = (value: number): string => formatIdr(value, { mode: 'compact' });
const plainUsdt = (value: number): string => {
  const fixed = Math.abs(value) >= 1;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: fixed ? 2 : 0,
    maximumFractionDigits: fixed ? 2 : 8,
  });
};

/** asks are reversed (best ask sits at the bottom, next to the mid price). */
function convertSide(levels: Level[], rate: number, side: 'sell' | 'buy'): ConvertedRow[] {
  const top = levels.slice(0, MAX_ROWS);
  let cumulative = 0;
  const rows = top.map(([priceRaw, qtyRaw]) => {
    const price = num(priceRaw);
    const qty = num(qtyRaw);
    cumulative += qty;
    const priceIdr = price * rate;
    const totalIdr = cumulative * priceIdr;
    return {
      price: currency(priceIdr),
      qty: compact(qty * priceIdr),
      total: compact(totalIdr),
      raw: totalIdr,
    };
  });
  let max = 0;
  for (const row of rows) max = Math.max(max, row.raw);
  const converted = rows.map(({ raw, ...row }) => ({ ...row, pct: max > 0 ? (raw / max) * 100 : 0 }));
  return side === 'sell' ? converted.reverse() : converted;
}

export function mountBybitBook(): BybitBookHandle {
  const host = document.createElement('div');
  host.id = 'tradecat-book-host';
  host.style.cssText = `position:fixed;z-index:2147483000;left:0;top:0;width:${PANEL_WIDTH}px;height:400px;display:none;`;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = CSS;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="head">
      <div class="tabs">
        <span class="tab active">Converted IDR</span>
        <span class="tab muted" title="Use the native panel for recent trades">Recent Trades</span>
      </div>
      <div class="icons">
        <button class="icon" data-act="refresh" title="Refresh depth">↻</button>
        <button class="icon" data-act="dock" title="Dock next to the orderbook">⊞</button>
        <button class="icon" data-act="collapse" title="Collapse">−</button>
      </div>
    </div>
    <div class="sub">
      <span class="pair">—</span>
      <span class="status">waiting…</span>
      <span class="spacer"></span>
      <span class="rate"></span>
    </div>
    <div class="cols"><span>Price (IDR)</span><span>Qty (IDR)</span><span>Total (IDR)<span class="arrow">▾</span></span></div>
    <div class="rows">
      <div class="sell"></div>
      <div class="mid down"><span class="arrow"></span><span class="cur">—</span><span class="approx"></span><span class="spacer"></span></div>
      <div class="buy"></div>
    </div>`;

  shadow.append(style, panel);

  const $ = <T extends Element>(selector: string): T => panel.querySelector(selector) as T;
  const pairEl = $<HTMLElement>('.sub .pair');
  const statusEl = $<HTMLElement>('.sub .status');
  const rateEl = $<HTMLElement>('.sub .rate');
  const sellEl = $<HTMLElement>('.sell');
  const buyEl = $<HTMLElement>('.buy');
  const midEl = $<HTMLElement>('.mid');
  const curEl = $<HTMLElement>('.mid .cur');
  const approxEl = $<HTMLElement>('.mid .approx');

  const sellRows = Array.from({ length: MAX_ROWS }, () => makeRow('sell'));
  const buyRows = Array.from({ length: MAX_ROWS }, () => makeRow('buy'));
  sellEl.append(...sellRows.map((row) => row.el));
  buyEl.append(...buyRows.map((row) => row.el));

  let stopped = false;
  let scheduled = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let layoutTimer: ReturnType<typeof setInterval> | null = null;
  let base = '';
  let quote = '';
  let perSide = 10;
  let manual: { left: number; top: number } | null = getStored<{ left: number; top: number } | null>(POS_KEY, null);
  let lastMid = 0;

  function makeRow(kind: 'sell' | 'buy'): RowParts {
    const el = document.createElement('div');
    el.className = `row ${kind}`;
    const depth = document.createElement('div');
    depth.className = 'depth';
    const price = document.createElement('span');
    price.className = 'v price';
    const qty = document.createElement('span');
    qty.className = 'v qty';
    const total = document.createElement('span');
    total.className = 'v total';
    el.append(depth, price, qty, total);
    return { el, depth, price, qty, total };
  }

  const writeSide = (rows: RowParts[], converted: ConvertedRow[]): void => {
    rows.forEach((row, index) => {
      const data = index < perSide ? converted[index] : undefined;
      if (!data) {
        row.el.style.display = 'none';
        return;
      }
      row.el.style.display = 'grid';
      row.price.textContent = data.price;
      row.qty.textContent = data.qty;
      row.total.textContent = data.total;
      row.depth.style.width = `${data.pct}%`;
      row.el.title = `${data.price} · ${data.qty} · ${data.total}`;
    });
  };

  /** The native mid-price row, so the converted panel matches its direction. */
  const nativePrice = (): { value: number; up: boolean } | null => {
    const el = document.querySelector<HTMLElement>('#orderBookArea .new-price .price');
    if (!el) return null;
    const text = el.textContent ?? '';
    const value = parseNumber(text);
    if (!value || value <= 0) return null;
    const cls = typeof el.className === 'string' ? el.className : '';
    const up = /spot-buy|themed-text-green|color-buy/i.test(cls) || (!/spot-sell/i.test(cls) && value >= lastMid);
    return { value, up };
  };

  const render = (): void => {
    if (stopped) return;
    const depth = latest ?? restDepth;
    const rate = currentRate().rate;
    pairEl.textContent = base && quote ? `${base}/${quote}` : '—';
    rateEl.textContent = rate > 0 ? `1 USDT = ${formatIdr(rate, { mode: 'full', prefix: 'Rp. ' })}` : 'rate not set';
    statusEl.textContent = latest ? 'live worker' : depth ? 'rest fallback' : 'waiting…';

    if (!depth || rate <= 0) {
      for (const row of [...sellRows, ...buyRows]) row.el.style.display = 'none';
      curEl.textContent = '—';
      approxEl.textContent = '';
      return;
    }

    const sell = convertSide(depth.a, rate, 'sell');
    const buy = convertSide(depth.b, rate, 'buy');
    writeSide(sellRows, sell);
    writeSide(buyRows, buy);

    const native = nativePrice();
    const bestAsk = num(depth.a[0]?.[0]);
    const bestBid = num(depth.b[0]?.[0]);
    const midUsdt = native?.value ?? (bestAsk && bestBid ? (bestAsk + bestBid) / 2 : bestAsk || bestBid);
    const up = native ? native.up : midUsdt >= lastMid;
    if (midUsdt > 0) lastMid = midUsdt;

    midEl.classList.toggle('up', up);
    midEl.classList.toggle('down', !up);
    curEl.textContent = midUsdt > 0 ? currency(midUsdt * rate) : '—';
    approxEl.textContent = midUsdt > 0 ? `≈ ${plainUsdt(midUsdt)} USDT` : '';
  };

  const schedule = (): void => {
    if (scheduled || stopped) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  };

  const onDepth = (): void => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    restDepth = null;
    schedule();
  };

  const loadRest = async (): Promise<void> => {
    if (stopped || !base) return;
    try {
      const body = await requestJson<any>(
        `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${encodeURIComponent(`${base}${quote}`)}&limit=50`,
        10000,
      );
      const result = body?.result;
      if (!result || latest) return;
      restDepth = { a: result.a ?? [], b: result.b ?? [], at: Date.now() };
      schedule();
    } catch {
      /* leave the panel on "waiting" */
    }
  };

  const startFallback = (): void => {
    if (pollTimer || latest || stopped) return;
    void loadRest();
    pollTimer = setInterval(() => void loadRest(), POLL_INTERVAL_MS);
  };

  // --- layout: chart | converted book | native orderbook -----------------

  const gridItemOf = (selector: string): HTMLElement | null => {
    const inner = document.querySelector<HTMLElement>(selector);
    return inner?.closest<HTMLElement>('.react-grid-item') ?? inner;
  };

  const place = (left: number, top: number, width: number, height: number): void => {
    const maxLeft = Math.max(4, window.innerWidth - width - 4);
    const maxTop = Math.max(4, window.innerHeight - 120);
    const x = Math.min(Math.max(4, left), maxLeft);
    const y = Math.min(Math.max(4, top), maxTop);
    host.style.left = `${Math.round(x)}px`;
    host.style.top = `${Math.round(y)}px`;
    host.style.width = `${Math.round(width)}px`;
    host.style.height = `${Math.round(Math.max(300, Math.min(height, window.innerHeight - y - 8)))}px`;
    host.style.display = '';
  };

  const setChartWidth = (width: number): void => {
    const chart = gridItemOf('#sfeKlineArea');
    if (!chart) return;
    const target = `${Math.round(Math.max(260, width))}px`;
    if (chart.style.width !== target) chart.style.width = target;
  };

  /** Dock between the chart and the native book; shrink the chart to fit. */
  const dock = (): boolean => {
    const chart = gridItemOf('#sfeKlineArea');
    const book = gridItemOf('#orderBookArea');
    if (!chart || !book) return false;

    const chartRect = chart.getBoundingClientRect();
    const bookRect = book.getBoundingClientRect();
    if (bookRect.width < 100 || bookRect.height < 100) return false;

    const left = bookRect.left - PANEL_WIDTH - GAP;
    const chartWidth = left - chartRect.left - GAP;

    if (chartWidth >= 300) {
      setChartWidth(chartWidth);
      place(left, bookRect.top, PANEL_WIDTH, bookRect.height);
      return true;
    }

    // Not enough room for three columns: keep the chart usable and sit to the
    // right of the book, or float at the bottom-right on narrow windows.
    setChartWidth(bookRect.left - chartRect.left - GAP);
    if (bookRect.right + GAP + PANEL_WIDTH <= window.innerWidth - 4) {
      place(bookRect.right + GAP, bookRect.top, PANEL_WIDTH, bookRect.height);
      return true;
    }
    place(
      window.innerWidth - PANEL_WIDTH - 14,
      Math.max(8, window.innerHeight - 460),
      PANEL_WIDTH,
      440,
    );
    return true;
  };

  /** Panel dragged away: give the chart its original width back. */
  const undockChart = (): void => {
    const chart = gridItemOf('#sfeKlineArea');
    const book = gridItemOf('#orderBookArea');
    if (!chart || !book) return;
    const chartRect = chart.getBoundingClientRect();
    const bookRect = book.getBoundingClientRect();
    setChartWidth(bookRect.left - chartRect.left - GAP);
  };

  const updateRowCount = (): void => {
    const collapsed = panel.dataset['collapsed'] === 'true';
    const height = host.getBoundingClientRect().height;
    if (collapsed) {
      perSide = 0;
      return;
    }
    const available = height - HEADER_H - SUB_H - COLS_H - MID_H;
    perSide = Math.max(5, Math.min(MAX_ROWS, Math.floor(available / 2 / MIN_ROW_H)));
  };

  const layout = (): void => {
    if (stopped) return;
    const collapsed = panel.dataset['collapsed'] === 'true';
    if (manual) {
      undockChart();
      place(manual.left, manual.top, PANEL_WIDTH, host.getBoundingClientRect().height || 668);
    } else if (!dock()) {
      // Native layout not ready: sit out of the way until it is.
      host.style.display = 'none';
      return;
    }
    if (collapsed) host.style.height = `${HEADER_H}px`;
    updateRowCount();
    render();
  };

  const syncPair = (): void => {
    const pair = currentPair();
    if (!pair) {
      host.style.display = 'none';
      return;
    }
    if (pair.base === base && pair.quote === quote) return;
    base = pair.base;
    quote = pair.quote;
    latest = null;
    restDepth = null;
    lastMid = 0;
    schedule();
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(startFallback, POLL_FALLBACK_MS);
  };

  const saveManual = (): void => {
    const rect = host.getBoundingClientRect();
    manual = { left: Math.round(rect.left), top: Math.round(rect.top) };
    setStored(POS_KEY, manual);
  };

  const setCollapsed = (collapsed: boolean): void => {
    panel.dataset['collapsed'] = String(collapsed);
    $<HTMLElement>('[data-act="collapse"]').textContent = collapsed ? '+' : '−';
    setStored(COLLAPSE_KEY, collapsed);
    if (collapsed) {
      host.style.height = `${HEADER_H}px`;
    } else {
      layout();
    }
    updateRowCount();
    render();
  };

  // --- interactions -------------------------------------------------------

  panel.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!target) return;
    const action = target.dataset['act'];
    if (action === 'refresh') {
      void loadRest();
      schedule();
    }
    if (action === 'dock') {
      manual = null;
      setStored(POS_KEY, null);
      layout();
    }
    if (action === 'collapse') {
      setCollapsed(panel.dataset['collapsed'] !== 'true');
    }
  });

  const head = $<HTMLElement>('.head');
  let drag: { startX: number; startY: number; left: number; top: number } | null = null;

  head.addEventListener('pointerdown', (event) => {
    if ((event.target as HTMLElement).closest('[data-act]')) return;
    const rect = host.getBoundingClientRect();
    drag = { startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top };
    try {
      head.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic events have no capture target */
    }
    event.preventDefault();
  });

  head.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const left = Math.max(4, Math.min(window.innerWidth - 120, drag.left + event.clientX - drag.startX));
    const top = Math.max(4, Math.min(window.innerHeight - 60, drag.top + event.clientY - drag.startY));
    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
    host.style.display = '';
  });

  head.addEventListener('pointerup', (event) => {
    if (!drag) return;
    drag = null;
    try {
      head.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    saveManual();
    undockChart();
  });

  const mount = (): void => {
    if (!document.body) {
      requestAnimationFrame(mount);
      return;
    }
    document.body.appendChild(host);
    if (getStored<boolean>(COLLAPSE_KEY, false)) {
      panel.dataset['collapsed'] = 'true';
      $<HTMLElement>('[data-act="collapse"]').textContent = '+';
    }
    syncPair();
    layout();
    listeners.add(onDepth);
    window.addEventListener('resize', layout, { passive: true });
    window.addEventListener('scroll', layout, { passive: true, capture: true });
    layoutTimer = setInterval(layout, 800);
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(startFallback, POLL_FALLBACK_MS);
    schedule();
  };

  mount();

  return {
    refresh: () => {
      syncPair();
      layout();
      schedule();
    },
    destroy: () => {
      stopped = true;
      listeners.delete(onDepth);
      window.removeEventListener('resize', layout);
      window.removeEventListener('scroll', layout, { capture: true });
      if (pollTimer) clearInterval(pollTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (layoutTimer) clearInterval(layoutTimer);
      host.remove();
    },
    describe: () => {
      const depth = latest ?? restDepth;
      const rows = depth ? Math.min(depth.a.length, perSide) + Math.min(depth.b.length, perSide) : 0;
      const sample = sellRows[Math.max(0, perSide - 1)]?.el.textContent?.trim().replace(/\s+/g, ' ') ?? '';
      return { adapter: 'bybit:converted-book', rows, sample: sample ? [sample] : [] };
    },
  };
}

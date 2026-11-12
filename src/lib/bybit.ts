/**
 * Bybit converted orderbook.
 *
 * Bybit draws its spot book on a `<canvas>`, so there are no cells to overlay.
 * Instead of polling, this hooks the page's own depth feed: Bybit feeds the book
 * to a `Worker` and expects `worker.onmessage`, so the setter is wrapped (the
 * same trick as `Bybit Price Interceptor.user.js`) and every `spot.ob_` frame is
 * captured before the page handler runs.
 *
 * The panel reproduces `Updated Bybit Orderbook Experiment.user.js`:
 *
 *   Price (IDR) · Qty (IDR) · Total (IDR), 8 rows per side, depth bars
 *
 * with the panel anchored just left of the original (canvas) orderbook. A
 * public REST poll is used only when no worker frame has arrived, e.g. when
 * Bybit changes the worker wiring.
 *
 * The hook has to be installed at `document-start`, before Bybit creates its
 * worker, which is why `installBybitDepthHook()` is called at the top of
 * `main.ts` rather than from `boot()`.
 */
import { formatIdr } from './format';
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

const ROWS = 8;
const WIDTH = 318;
const POLL_FALLBACK_MS = 4000;
const POLL_INTERVAL_MS = 3000;
const COLLAPSE_KEY = 'ui.bybit.collapsed';

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
  position: fixed;
  z-index: 2147483000;
  width: 318px;
  display: flex;
  flex-direction: column;
  font: 12px/1.4 Inter, Arial, ui-sans-serif, system-ui, sans-serif;
  color: #e6edf3;
  background: #0e0f13;
  border: 1px solid #24262d;
  border-radius: 6px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  user-select: none;
}
.panel[data-collapsed="true"] .cols,
.panel[data-collapsed="true"] .rows { display: none; }
.head {
  display: flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 8px; flex: none;
  background: #12141a; border-bottom: 1px solid #1c1e24;
  cursor: default;
}
.title { font-weight: 600; color: #c9d1d9; letter-spacing: 0.02em; }
.pair { color: #8b949e; font-size: 11px; }
.grow { flex: 1; }
.icon {
  all: unset; cursor: pointer; padding: 0 4px; border-radius: 4px;
  color: #8b949e; font-size: 13px; line-height: 1;
}
.icon:hover { color: #e6edf3; background: rgba(255,255,255,0.08); }
.rate { color: #6e7681; font-size: 10px; }
.cols {
  display: grid; grid-template-columns: 1fr 88px 96px; gap: 0 4px;
  padding: 3px 8px; flex: none;
  color: #6e7681; font-size: 10px; border-bottom: 1px solid #1c1e24;
}
.cols span:nth-child(2), .cols span:nth-child(3) { text-align: right; }
.rows { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
.sell, .buy { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.row {
  position: relative; flex: 1; min-height: 0;
  display: grid; grid-template-columns: 1fr 88px 96px; gap: 0 4px;
  align-items: center; padding: 0 8px; overflow: hidden;
}
.row .depth {
  position: absolute; right: 0; top: 0; height: 100%;
  opacity: 0.22; z-index: 1; transition: width 0.15s ease-out;
}
.row.sell .depth { background: #ef454a; }
.row.buy .depth { background: #20b26c; }
.row .v { position: relative; z-index: 2; font-variant-numeric: tabular-nums; white-space: nowrap; }
.row .v.price { color: #ead05a; }
.row .v.qty, .row .v.total { color: #ead05a; text-align: right; }
.mid {
  flex: none; display: flex; align-items: baseline; gap: 8px;
  padding: 6px 8px; margin: 1px 0;
  border-top: 1px solid #24262d; border-bottom: 1px solid #24262d;
}
.mid .cur { color: #ebd61e; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.mid .src { margin-left: auto; color: #6e7681; font-size: 10px; }
.empty { padding: 8px; color: #6e7681; font-size: 11px; }
`;

interface ConvertedRow {
  price: string;
  qty: string;
  total: string;
  pct: number;
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const currency = (value: number): string =>
  formatIdr(value, { prefix: '', decimals: 2 });
const compact = (value: number): string => formatIdr(value, { mode: 'compact' });

/** asks are reversed (best ask sits at the bottom, next to the mid price). */
function convertSide(levels: Level[], rate: number, side: 'sell' | 'buy'): ConvertedRow[] {
  const top = levels.slice(0, ROWS);
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
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = CSS;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="head">
      <span class="title">Converted IDR</span>
      <span class="pair">—</span>
      <span class="grow"></span>
      <span class="rate"></span>
      <button class="icon" data-act="refresh" title="Refresh">↻</button>
      <button class="icon" data-act="collapse" title="Collapse">−</button>
    </div>
    <div class="cols"><span>Price (IDR)</span><span>Qty (IDR)</span><span>Total (IDR)</span></div>
    <div class="rows">
      <div class="sell"></div>
      <div class="mid"><span class="cur">—</span><span class="src"></span></div>
      <div class="buy"></div>
    </div>`;

  shadow.append(style, panel);

  const $ = <T extends Element>(selector: string): T => panel.querySelector(selector) as T;
  const pairEl = $<HTMLElement>('.pair');
  const rateEl = $<HTMLElement>('.rate');
  const sellEl = $<HTMLElement>('.sell');
  const buyEl = $<HTMLElement>('.buy');
  const curEl = $<HTMLElement>('.mid .cur');
  const srcEl = $<HTMLElement>('.mid .src');

  const sellRows = Array.from({ length: ROWS }, () => makeRow('sell'));
  const buyRows = Array.from({ length: ROWS }, () => makeRow('buy'));
  sellEl.append(...sellRows.map((row) => row.el));
  buyEl.append(...buyRows.map((row) => row.el));

  let stopped = false;
  let scheduled = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let anchorTimer: ReturnType<typeof setInterval> | null = null;
  let base = '';
  let quote = '';

  function makeRow(kind: 'sell' | 'buy'): {
    el: HTMLElement;
    depth: HTMLElement;
    price: HTMLElement;
    qty: HTMLElement;
    total: HTMLElement;
  } {
    const el = document.createElement('div');
    el.className = `row ${kind}`;
    const depth = document.createElement('div');
    depth.className = 'depth';
    const price = document.createElement('span');
    price.className = 'v price';
    price.textContent = '—';
    const qty = document.createElement('span');
    qty.className = 'v qty';
    qty.textContent = '—';
    const total = document.createElement('span');
    total.className = 'v total';
    total.textContent = '—';
    el.append(depth, price, qty, total);
    return { el, depth, price, qty, total };
  }

  const writeSide = (
    rows: ReturnType<typeof makeRow>[],
    converted: ConvertedRow[],
  ): void => {
    rows.forEach((row, index) => {
      const data = converted[index];
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

  const render = (): void => {
    if (stopped) return;
    const depth = latest ?? restDepth;
    const rate = currentRate().rate;
    pairEl.textContent = base && quote ? `${base}/${quote}` : '—';
    rateEl.textContent = rate > 0 ? `1 USDT = ${formatIdr(rate, { mode: 'full', prefix: 'Rp. ' })}` : 'rate not set';

    if (!depth || rate <= 0) {
      for (const row of [...sellRows, ...buyRows]) row.el.style.display = 'none';
      curEl.textContent = '—';
      srcEl.textContent = depth ? 'USDT/IDR rate not set' : 'waiting for depth…';
      return;
    }

    const sell = convertSide(depth.a, rate, 'sell');
    const buy = convertSide(depth.b, rate, 'buy');
    writeSide(sellRows, sell);
    writeSide(buyRows, buy);

    const bestAsk = num(depth.a[0]?.[0]);
    const bestBid = num(depth.b[0]?.[0]);
    const mid = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : bestAsk || bestBid;
    curEl.textContent = mid > 0 ? currency(mid * rate) : '—';
    srcEl.textContent = latest ? 'live worker' : 'rest fallback';
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
    // A worker frame is fresher than the REST fallback; stop polling for good.
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

  const bybitSymbol = (): string => `${base}${quote}`;

  const loadRest = async (): Promise<void> => {
    if (stopped || !base) return;
    try {
      const body = await requestJson<any>(
        `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${encodeURIComponent(bybitSymbol())}&limit=50`,
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

  /** Keep the panel glued to the left edge of the native orderbook. */
  const anchor = (): void => {
    if (stopped) return;
    const area =
      document.querySelector<HTMLElement>('#orderBookArea') ??
      document.querySelector<HTMLElement>('.order-book-area');
    const rect = area?.getBoundingClientRect();
    if (!rect || rect.width < 100 || rect.height < 80) {
      panel.style.left = 'auto';
      panel.style.top = 'auto';
      panel.style.right = '14px';
      panel.style.bottom = '14px';
      panel.style.height = '420px';
      return;
    }

    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.top = `${Math.round(rect.top)}px`;
    const height = Math.max(280, Math.min(rect.height, window.innerHeight - rect.top - 8));
    panel.style.height = `${Math.round(height)}px`;

    // Prefer the left side (the canvas cannot be modified); if there is no
    // room, sit on the right instead of off-screen.
    const left = rect.left - WIDTH - 6;
    panel.style.left = `${Math.round(left >= 8 ? left : Math.max(8, rect.right + 6))}px`;
  };

  const syncPair = (): void => {
    const pair = currentPair();
    if (!pair) {
      host.style.display = 'none';
      return;
    }
    host.style.display = '';
    if (pair.base === base && pair.quote === quote) return;
    base = pair.base;
    quote = pair.quote;
    latest = null;
    restDepth = null;
    schedule();
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(startFallback, POLL_FALLBACK_MS);
  };

  panel.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!target) return;
    const action = target.dataset['act'];
    if (action === 'refresh') {
      void loadRest();
      schedule();
    }
    if (action === 'collapse') {
      const collapsed = panel.dataset['collapsed'] !== 'true';
      panel.dataset['collapsed'] = String(collapsed);
      target.textContent = collapsed ? '+' : '−';
      setStored(COLLAPSE_KEY, collapsed);
    }
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
    anchor();
    listeners.add(onDepth);
    window.addEventListener('resize', anchor, { passive: true });
    anchorTimer = setInterval(anchor, 800);
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(startFallback, POLL_FALLBACK_MS);
    schedule();
  };

  mount();

  return {
    refresh: () => {
      syncPair();
      anchor();
      schedule();
    },
    destroy: () => {
      stopped = true;
      listeners.delete(onDepth);
      window.removeEventListener('resize', anchor);
      if (pollTimer) clearInterval(pollTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (anchorTimer) clearInterval(anchorTimer);
      host.remove();
    },
    describe: () => {
      const depth = latest ?? restDepth;
      const rows = depth ? Math.min(depth.a.length, ROWS) + Math.min(depth.b.length, ROWS) : 0;
      const sample = sellRows[ROWS - 1]?.el.textContent?.trim().replace(/\s+/g, ' ') ?? '';
      return { adapter: 'bybit:converted-book', rows, sample: sample ? [sample] : [] };
    },
  };
}

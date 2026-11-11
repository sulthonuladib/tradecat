/**
 * API-backed orderbook panel.
 *
 * Bybit's spot orderbook is drawn on a `<canvas>`, so there are no price cells
 * the DOM engine could anchor to. Rather than leaving Bybit without the IDR
 * view, this panel fetches the public orderbook and renders a compact book
 * itself: price in USDT next to its IDR value, and the cumulative total in IDR.
 *
 * It is deliberately read-only and small; the exchange's own canvas keeps
 * working underneath.
 */
import { formatIdr } from './format';
import { currentRate } from './rate';
import { currentPair, type SiteId } from './site';
import { getStored, requestJson, setStored } from './store';
import type { OrderbookConfig } from './orderbook';

export interface ApiBookHandle {
  refresh(): void;
  destroy(): void;
  describe(): { adapter: string; rows: number; sample: string[] };
}

const POS_KEY = 'ui.book.pos';
const COLLAPSE_KEY = 'ui.book.collapsed';
const ROWS_PER_SIDE = 10;
const REFRESH_MS = 3000;

const CSS = `
:host { all: initial; }
.panel {
  position: fixed;
  z-index: 2147482999;
  width: 268px;
  font: 11px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #e6edf3;
  background: rgba(13, 17, 23, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  overflow: hidden;
  user-select: none;
}
.panel.pos-bottom-left { left: 14px; bottom: 14px; }
.panel.pos-bottom-right { right: 14px; bottom: 14px; }
.panel.pos-top-left { left: 14px; top: 70px; }
.panel.pos-top-right { right: 14px; top: 70px; }
.head { display: flex; align-items: center; gap: 4px; padding: 6px 8px; cursor: move; background: rgba(255, 255, 255, 0.04); }
.pair { font-weight: 700; letter-spacing: 0.02em; }
.grow { flex: 1; }
.icon { all: unset; cursor: pointer; padding: 0 4px; border-radius: 4px; color: #8b949e; font-size: 13px; line-height: 1; }
.icon:hover { color: #e6edf3; background: rgba(255, 255, 255, 0.08); }
.body { padding: 4px 6px 6px; }
.panel[data-collapsed="true"] .body, .panel[data-collapsed="true"] .foot { display: none; }
.cols, .row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 4px; align-items: center; }
.cols { color: #6e7681; font-size: 9px; padding: 2px 4px; }
.cols span:nth-child(2), .cols span:nth-child(3), .row span:nth-child(2), .row span:nth-child(3) { text-align: right; }
.row { padding: 1px 4px; border-radius: 3px; font-variant-numeric: tabular-nums; }
.row.ask .px { color: #ff7b72; }
.row.bid .px { color: #3fb950; }
.row .idr { color: #ead05a; }
.row .tot { color: #8b949e; }
.mid { margin: 3px 0; padding: 3px 4px; border-top: 1px solid rgba(255,255,255,0.08); border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; gap: 6px; align-items: baseline; }
.mid b { font-size: 13px; font-variant-numeric: tabular-nums; }
.mid span { color: #8b949e; margin-left: auto; }
.foot { font-size: 9px; color: #6e7681; padding: 0 8px 6px; display: flex; gap: 6px; }
.foot .err { color: #d29922; }
`;

interface Level {
  price: number;
  size: number;
}

const fmtUsdt = (value: number): string => {
  const decimals = Math.abs(value) >= 1 ? (Math.abs(value) >= 1000 ? 2 : 4) : 8;
  return value.toLocaleString('en-US', { maximumFractionDigits: decimals });
};

function parseLevels(raw: unknown): Level[] {
  if (!Array.isArray(raw)) return [];
  const levels: Level[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry)) continue;
    const price = Number(entry[0]);
    const size = Number(entry[1]);
    if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0) continue;
    levels.push({ price, size });
  }
  return levels;
}

/** Fetch the public spot book for the pair on the current page. */
async function fetchBook(site: SiteId, base: string, quote: string): Promise<{ asks: Level[]; bids: Level[] } | null> {
  const symbol = `${base}${quote}`;
  if (site === 'bybit') {
    const body = await requestJson<any>(
      `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${encodeURIComponent(symbol)}&limit=50`,
      10000,
    );
    const result = body?.result;
    if (!result) return null;
    return { asks: parseLevels(result.a), bids: parseLevels(result.b) };
  }
  return null;
}

export function mountApiBook(options: {
  site: SiteId;
  getConfig: () => OrderbookConfig;
  position: string;
}): ApiBookHandle {
  const host = document.createElement('div');
  host.id = 'tradecat-book-host';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = CSS;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="head">
      <span class="pair">—</span>
      <span class="grow"></span>
      <button class="icon" data-act="refresh" title="Refresh orderbook">↻</button>
      <button class="icon" data-act="collapse" title="Collapse">−</button>
    </div>
    <div class="body">
      <div class="cols"><span>Price</span><span>IDR</span><span>Total IDR</span></div>
      <div class="asks"></div>
      <div class="mid"><b>—</b><span></span></div>
      <div class="bids"></div>
    </div>
    <div class="foot"><span class="status">loading…</span><span class="grow"></span><span class="rate"></span></div>`;

  shadow.append(style, panel);

  const $ = <T extends Element>(selector: string): T => panel.querySelector(selector) as T;
  const pairEl = $<HTMLElement>('.pair');
  const asksEl = $<HTMLElement>('.asks');
  const bidsEl = $<HTMLElement>('.bids');
  const midEl = $<HTMLElement>('.mid b');
  const spreadEl = $<HTMLElement>('.mid span');
  const statusEl = $<HTMLElement>('.status');
  const rateEl = $<HTMLElement>('.rate');
  const footEl = $<HTMLElement>('.foot');

  let base = '';
  let quote = '';
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;
  let stopped = false;
  let lastUpdated = 0;

  const applyPosition = (): void => {
    const saved = getStored<{ left: number; top: number } | null>(POS_KEY, null);
    panel.classList.remove('pos-bottom-left', 'pos-bottom-right', 'pos-top-left', 'pos-top-right');
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      panel.style.left = `${saved.left}px`;
      panel.style.top = `${saved.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      return;
    }
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';
    panel.classList.add(`pos-${options.position || 'bottom-left'}`);
  };

  const renderSide = (
    target: HTMLElement,
    levels: Level[],
    kind: 'ask' | 'bid',
    rate: number,
    priceIdr: (value: number) => string,
    totalIdr: (value: number) => string,
    priceColor: string,
    volumeColor: string,
  ): void => {
    target.textContent = '';
    if (!levels.length) return;

    // Cumulative traded value from the top of the book, in USDT, then IDR.
    let cumulativeUsdt = 0;
    const rows = levels.slice(0, ROWS_PER_SIDE).map((level) => {
      cumulativeUsdt += level.price * level.size;
      return { level, totalIdrValue: cumulativeUsdt * rate };
    });
    if (kind === 'ask') rows.reverse();

    for (const { level, totalIdrValue } of rows) {
      const row = document.createElement('div');
      row.className = `row ${kind}`;

      const px = document.createElement('span');
      px.className = 'px';
      px.textContent = fmtUsdt(level.price);

      const idr = document.createElement('span');
      idr.className = 'idr';
      if (priceColor) idr.style.color = priceColor;
      idr.textContent = rate > 0 ? priceIdr(level.price * rate) : '—';
      idr.title = rate > 0 ? `1 ${quote} = ${formatIdr(rate, { mode: 'full', prefix: 'Rp. ' })}` : 'USDT/IDR rate not set';

      const tot = document.createElement('span');
      tot.className = 'tot';
      if (volumeColor) tot.style.color = volumeColor;
      tot.textContent = rate > 0 ? totalIdr(totalIdrValue) : '—';

      row.append(px, idr, tot);
      target.append(row);
    }
  };

  const render = (book: { asks: Level[]; bids: Level[] } | null, error?: string): void => {
    const config = options.getConfig();
    const rate = currentRate().rate;
    const priceIdr = (value: number): string => formatIdr(value, { mode: config.priceMode, prefix: config.prefix });
    const totalIdr = (value: number): string => formatIdr(value, { mode: config.volumeMode, prefix: config.prefix });

    rateEl.textContent = rate > 0 ? `1 USDT = ${formatIdr(rate, { mode: 'full', prefix: 'Rp. ' })}` : 'rate not set';

    if (!book) {
      asksEl.textContent = '';
      bidsEl.textContent = '';
      midEl.textContent = '—';
      spreadEl.textContent = '';
      statusEl.textContent = error ? 'failed' : 'no data';
      statusEl.className = `status${error ? ' err' : ''}`;
      footEl.title = error ?? '';
      return;
    }

    const priceColor = config.priceColor;
    const volumeColor = config.volumeColor;
    renderSide(asksEl, book.asks, 'ask', rate, priceIdr, totalIdr, priceColor, volumeColor);
    renderSide(bidsEl, book.bids, 'bid', rate, priceIdr, totalIdr, priceColor, volumeColor);

    const bestAsk = book.asks[0];
    const bestBid = book.bids[0];
    const mid = bestAsk && bestBid ? (bestAsk.price + bestBid.price) / 2 : bestAsk?.price ?? bestBid?.price ?? 0;
    midEl.textContent = mid > 0 ? fmtUsdt(mid) : '—';
    if (bestAsk && bestBid && bestBid.price > 0) {
      const spread = ((bestAsk.price - bestBid.price) / bestBid.price) * 100;
      spreadEl.textContent = `spread ${spread.toFixed(2)}%`;
    } else {
      spreadEl.textContent = '';
    }
    statusEl.textContent = lastUpdated ? `api · ${new Date(lastUpdated).toLocaleTimeString()}` : 'api';
    statusEl.className = 'status';
    footEl.title = '';
  };

  const load = async (): Promise<void> => {
    if (busy || stopped || !base) return;
    busy = true;
    try {
      const book = await fetchBook(options.site, base, quote);
      if (!book || (!book.asks.length && !book.bids.length)) {
        render(null, 'no data');
        return;
      }
      lastUpdated = Date.now();
      render(book);
    } catch (error) {
      render(null, error instanceof Error ? error.message : String(error));
    } finally {
      busy = false;
    }
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
    pairEl.textContent = `${base}/${quote}`;
    asksEl.textContent = '';
    bidsEl.textContent = '';
    statusEl.textContent = 'loading…';
    void load();
  };

  const schedule = (): void => {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (document.hidden) return;
      void load();
    }, REFRESH_MS);
  };

  panel.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!target) return;
    const action = target.dataset['act'];
    if (action === 'refresh') void load();
    if (action === 'collapse') {
      const collapsed = panel.dataset['collapsed'] !== 'true';
      panel.dataset['collapsed'] = String(collapsed);
      target.textContent = collapsed ? '+' : '−';
      setStored(COLLAPSE_KEY, collapsed);
    }
  });

  const head = $<HTMLElement>('.head');
  let drag: { startX: number; startY: number; left: number; top: number } | null = null;

  head.addEventListener('pointerdown', (event) => {
    if ((event.target as HTMLElement).closest('[data-act]')) return;
    const rect = panel.getBoundingClientRect();
    drag = { startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top };
    head.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  head.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const left = Math.max(0, Math.min(window.innerWidth - 80, drag.left + event.clientX - drag.startX));
    const top = Math.max(0, Math.min(window.innerHeight - 40, drag.top + event.clientY - drag.startY));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  });

  head.addEventListener('pointerup', (event) => {
    if (!drag) return;
    const rect = panel.getBoundingClientRect();
    setStored(POS_KEY, { left: Math.round(rect.left), top: Math.round(rect.top) });
    drag = null;
    try {
      head.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  });

  const mount = (): void => {
    if (!document.body) {
      requestAnimationFrame(mount);
      return;
    }
    document.body.appendChild(host);
    applyPosition();
    if (getStored<boolean>(COLLAPSE_KEY, false)) {
      panel.dataset['collapsed'] = 'true';
      $<HTMLElement>('[data-act="collapse"]').textContent = '+';
    }
    syncPair();
    schedule();
  };

  mount();

  return {
    refresh: () => {
      applyPosition();
      syncPair();
      void load();
    },
    destroy: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      host.remove();
    },
    describe: () => {
      const rows = asksEl.children.length + bidsEl.children.length;
      const first = asksEl.lastElementChild?.textContent ?? '';
      return { adapter: `${options.site}:api-book`, rows, sample: first ? [first] : [] };
    },
  };
}

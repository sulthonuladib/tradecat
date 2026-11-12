/**
 * Indodax: the simple readout.
 *
 * Indodax already quotes in rupiah, so converting its prices would just repeat
 * them. What is hard to see is the cost of a trade: the withdrawal fee of the
 * coin (network + fee in coin, valued in rupiah) and the 1% move you need just
 * to break even.
 *
 * The fee lives on the logged-in `/finance/<COIN>` page, the same place the
 * reference script read it from; the price and the lowest ask come from the
 * public ticker API, which works without a session.
 */
import { formatIdr, parseNumber } from './format';
import { currentRate } from './rate';
import { currentPair } from './site';
import { getStored, log, requestJson, requestText, setStored } from './store';

export interface SimpleHudHandle {
  refresh(): void;
  destroy(): void;
  describe(): { adapter: string; rows: number; sample: string[] };
}

const POS_KEY = 'ui.simple.pos';
const COLLAPSE_KEY = 'ui.simple.collapsed';
const FEE_TTL = 10 * 60 * 1000;
const TICKER_MS = 15_000;

const CSS = `
:host { all: initial; }
.panel {
  position: fixed;
  z-index: 2147482999;
  min-width: 232px;
  max-width: 320px;
  font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
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
.coin { font-weight: 700; letter-spacing: 0.02em; }
.quote { color: #8b949e; font-size: 11px; }
.grow { flex: 1; }
.icon { all: unset; cursor: pointer; padding: 0 4px; border-radius: 4px; color: #8b949e; font-size: 13px; line-height: 1; }
.icon:hover { color: #e6edf3; background: rgba(255, 255, 255, 0.08); }
.body { padding: 8px; display: flex; flex-direction: column; gap: 5px; }
.panel[data-collapsed="true"] .body { display: none; }
.line { display: grid; grid-template-columns: auto 1fr; align-items: baseline; gap: 8px; }
.line .k { color: #8b949e; font-size: 11px; white-space: nowrap; }
.line .v {
  text-align: right; font-weight: 600; font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere; white-space: normal;
}
.line .v.price { color: #e6edf3; }
.line .v.margin, .line .v.fee { color: #ead05a; }
.line .v.net { color: #c9d1d9; font-weight: 600; }
.hint { color: #d29922; font-size: 10px; line-height: 1.35; }
.hint:empty { display: none; }
.foot { display: flex; gap: 6px; align-items: center; font-size: 10px; color: #6e7681; }
.foot .retry { all: unset; cursor: pointer; color: #58a6ff; margin-left: auto; }
`;

interface Ticker {
  last: number | null;
  ask: number | null;
}

interface FeeInfo {
  network: string | null;
  fee: number | null;
  needsLogin: boolean;
  at: number;
}

const feeKey = (coin: string): string => `indodax.fee.${coin}`;

function parseFeePage(html: string): FeeInfo {
  if (typeof DOMParser !== 'function') return { network: null, fee: null, needsLogin: false, at: Date.now() };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const feeNode = doc.querySelector('#withdraw_fee_value');
  const netNode = doc.querySelector('#withdraw_network') as HTMLSelectElement | null;
  const network =
    (netNode?.selectedOptions?.[0]?.textContent ?? netNode?.value ?? netNode?.textContent ?? '').trim() || null;
  const feeText = (feeNode?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const fee = feeText ? parseNumber(feeText) : null;
  return { network, fee, needsLogin: !feeNode, at: Date.now() };
}

async function fetchFeePage(coin: string): Promise<string> {
  // Same-origin first: the finance page needs the user's session cookies.
  if (typeof fetch === 'function' && /(^|\.)indodax\.com$/.test(location.hostname)) {
    try {
      const response = await fetch(`/finance/${encodeURIComponent(coin)}`, { credentials: 'same-origin' });
      if (response.ok) return response.text();
    } catch {
      /* fall through to the GM request */
    }
  }
  return requestText(`https://indodax.com/finance/${encodeURIComponent(coin)}`, 15000);
}

async function readFee(coin: string, force: boolean): Promise<FeeInfo> {
  const cached = getStored<FeeInfo | null>(feeKey(coin), null);
  if (!force && cached && Date.now() - cached.at < FEE_TTL) return cached;

  try {
    const html = await fetchFeePage(coin);
    const info = parseFeePage(html);
    setStored(feeKey(coin), info);
    return info;
  } catch (error) {
    log('indodax finance failed', error);
    return cached ?? { network: null, fee: null, needsLogin: true, at: Date.now() };
  }
}

export function mountSimpleHud(options: { getConfig: () => { position: string } }): SimpleHudHandle {
  const host = document.createElement('div');
  host.id = 'tradecat-simple-host';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = CSS;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="head">
      <span class="coin">—</span>
      <span class="quote"></span>
      <span class="grow"></span>
      <button class="icon" data-act="refresh" title="Refresh fee">↻</button>
      <button class="icon" data-act="collapse" title="Collapse">−</button>
    </div>
    <div class="body">
      <div class="line"><span class="k">Harga</span><span class="v price">—</span></div>
      <div class="line"><span class="k">Selisih 1%</span><span class="v margin">—</span></div>
      <div class="line"><span class="k">Network</span><span class="v net">—</span></div>
      <div class="line"><span class="k">Fee =</span><span class="v fee">—</span></div>
      <div class="hint"></div>
    </div>
    <div class="foot"><span class="status"></span><button class="retry" data-act="refresh">retry</button></div>`;

  shadow.append(style, panel);

  const $ = <T extends Element>(selector: string): T => panel.querySelector(selector) as T;
  const coinEl = $<HTMLElement>('.coin');
  const quoteEl = $<HTMLElement>('.quote');
  const priceEl = $<HTMLElement>('.v.price');
  const marginEl = $<HTMLElement>('.v.margin');
  const feeEl = $<HTMLElement>('.v.fee');
  const netEl = $<HTMLElement>('.v.net');
  const hintEl = $<HTMLElement>('.hint');
  const statusEl = $<HTMLElement>('.status');

  let base = '';
  let quote = '';
  let ticker: Ticker = { last: null, ask: null };
  let feeInfo: FeeInfo | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

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
    panel.classList.add(`pos-${options.getConfig().position || 'bottom-left'}`);
  };

  /** A value quoted in the pair currency, valued in rupiah. */
  const toIdr = (value: number | null | undefined): number => {
    if (value == null) return 0;
    if (quote === 'IDR') return value;
    if (quote === 'USDT') return value * currentRate().rate;
    return 0;
  };

  const render = (): void => {
    coinEl.textContent = base || '—';
    quoteEl.textContent = quote ? `/${quote}` : '';

    const price = toIdr(ticker.last);
    priceEl.textContent = price > 0 ? formatIdr(price, { prefix: 'Rp. ' }) : '—';
    priceEl.title = ticker.last != null && quote !== 'IDR' ? `last ${ticker.last} ${quote}` : '';

    const ask = ticker.ask ?? ticker.last;
    const margin = toIdr(ask);
    marginEl.textContent = margin > 0 ? formatIdr(margin * 0.01, { prefix: 'Rp. ' }) : '—';

    const coinPrice = toIdr(ticker.last);
    if (feeInfo?.fee != null) {
      netEl.textContent = feeInfo.network ?? '—';
      netEl.title = feeInfo.network ?? '';
      const rupiah = coinPrice > 0 ? feeInfo.fee * coinPrice : 0;
      const coinText = `${feeInfo.fee.toLocaleString('id-ID', { maximumFractionDigits: 8 })} ${base}`;
      // Just the rupiah amount; the coin amount stays in the tooltip.
      feeEl.textContent = rupiah > 0 ? formatIdr(rupiah, { prefix: 'Rp. ' }) : '—';
      feeEl.title = rupiah > 0 ? `${coinText} × ${formatIdr(coinPrice, { prefix: 'Rp. ' })} = ${formatIdr(rupiah, { prefix: 'Rp. ' })}` : coinText;
      hintEl.textContent = '';
    } else if (feeInfo?.needsLogin) {
      netEl.textContent = '—';
      netEl.title = '';
      feeEl.textContent = '—';
      hintEl.textContent = 'Login untuk memuat fee penarikan (halaman finance).';
    } else {
      netEl.textContent = '—';
      netEl.title = '';
      feeEl.textContent = '—';
      hintEl.textContent = feeInfo ? 'Fee tidak tersedia untuk koin ini.' : 'Memuat fee…';
    }

    statusEl.textContent = ticker.last ? `api · ${new Date().toLocaleTimeString()}` : 'memuat harga…';
  };

  const loadTicker = async (): Promise<void> => {
    if (!base || stopped) return;
    try {
      const body = await requestJson<any>(`https://indodax.com/api/ticker/${base}_${quote}`.toLowerCase(), 10000);
      const raw = body?.ticker ?? body;
      ticker = {
        last: parseNumber(raw?.last ?? raw?.lastPrice),
        ask: parseNumber(raw?.sell ?? raw?.ask),
      };
      render();
    } catch (error) {
      log('indodax ticker failed', error);
      statusEl.textContent = 'harga tidak tersedia';
    }
  };

  const loadFee = async (force: boolean): Promise<void> => {
    if (!base) return;
    feeInfo = await readFee(base, force);
    render();
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
    ticker = { last: null, ask: null };
    feeInfo = null;
    render();
    void loadTicker();
    void loadFee(false);
  };

  const schedule = (): void => {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (document.hidden) return;
      void loadTicker();
    }, TICKER_MS);
  };

  panel.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!target) return;
    const action = target.dataset['act'];
    if (action === 'refresh') {
      void loadTicker();
      void loadFee(true);
    }
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
      void loadTicker();
    },
    destroy: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      host.remove();
    },
    describe: () => ({
      adapter: 'indodax:simple',
      rows: ticker.last ? 1 : 0,
      sample: [`${base}/${quote} last=${ticker.last ?? '-'} fee=${feeInfo?.fee ?? '-'} net=${feeInfo?.network ?? '-'}`],
    }),
  };
}

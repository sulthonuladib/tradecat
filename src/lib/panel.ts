/**
 * Floating panel: deposit / withdraw availability (per chain) for the coin of
 * the current pair, plus quick Deposit / Withdraw buttons.
 *
 * Rendered inside a shadow root so the exchange CSS can never leak in (or out).
 */
import { getStored, setStored } from './store';
import { depositUrl, withdrawUrl, currentPair, type SiteId } from './site';
import { getCoinInfo, type CoinInfo } from './coininfo';
import { currentRate } from './rate';
import { formatIdr } from './format';

export interface PanelConfig {
  enabled: boolean;
  showChains: boolean;
  position: string;
}

export interface PanelHandle {
  refresh(): void;
  destroy(): void;
}

const POS_KEY = 'ui.panel.pos';
const COLLAPSE_KEY = 'ui.panel.collapsed';

const CSS = `
:host { all: initial; }
.panel {
  position: fixed;
  z-index: 2147483000;
  min-width: 216px;
  max-width: 268px;
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
.head {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 8px; cursor: move;
  background: rgba(255, 255, 255, 0.04);
}
.coin { font-weight: 700; letter-spacing: 0.02em; }
.quote { color: #8b949e; font-size: 11px; }
.grow { flex: 1; }
.icon {
  all: unset; cursor: pointer; padding: 0 4px; border-radius: 4px;
  color: #8b949e; font-size: 13px; line-height: 1;
}
.icon:hover { color: #e6edf3; background: rgba(255, 255, 255, 0.08); }
.body { padding: 8px; display: flex; flex-direction: column; gap: 7px; }
.panel[data-collapsed="true"] .body { display: none; }
.chips { display: flex; gap: 6px; }
.chip {
  flex: 1; display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 6px; border-radius: 6px; font-size: 11px;
  background: rgba(255, 255, 255, 0.05); color: #8b949e;
}
.chip i { width: 6px; height: 6px; border-radius: 50%; background: #6e7681; flex: none; }
.chip b { margin-left: auto; font-weight: 600; color: #8b949e; }
.chip.ok { color: #c9d1d9; } .chip.ok i { background: #2ea043; } .chip.ok b { color: #3fb950; }
.chip.bad { color: #c9d1d9; } .chip.bad i { background: #f85149; } .chip.bad b { color: #f85149; }
.chip.warn i { background: #d29922; } .chip.warn b { color: #d29922; }
.chains { display: flex; flex-direction: column; gap: 2px; max-height: 132px; overflow-y: auto; }
.chain {
  display: flex; align-items: center; gap: 6px; font-size: 11px;
  padding: 2px 4px; border-radius: 4px; background: rgba(255, 255, 255, 0.03);
}
.chain .name { color: #c9d1d9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chain .flags { margin-left: auto; display: flex; gap: 6px; font-variant-numeric: tabular-nums; }
.chain .flags span { color: #6e7681; }
.chain .flags span.yes { color: #3fb950; }
.chain .flags span.no { color: #f85149; }
.actions { display: flex; gap: 6px; }
.btn {
  all: unset; flex: 1; text-align: center; cursor: pointer;
  padding: 5px 8px; border-radius: 6px; font-size: 11px; font-weight: 600;
  color: #e6edf3; background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.btn:hover { background: rgba(255, 255, 255, 0.14); }
.btn.primary { background: #1f6feb; border-color: #1f6feb; }
.btn.primary:hover { background: #2f81f7; }
.foot { font-size: 10px; color: #6e7681; display: flex; gap: 6px; align-items: center; }
.foot .retry { all: unset; cursor: pointer; color: #58a6ff; }
`;

function timeAgo(timestamp: number): string {
  if (!timestamp) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function mountPanel(options: { site: SiteId; getConfig: () => PanelConfig }): PanelHandle {
  const host = document.createElement('div');
  host.id = 'tradecat-panel-host';
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
      <button class="icon" data-act="refresh" title="Refresh coin info">↻</button>
      <button class="icon" data-act="collapse" title="Collapse">−</button>
    </div>
    <div class="body">
      <div class="chips">
        <span class="chip" data-kind="dep"><i></i>Deposit<b>—</b></span>
        <span class="chip" data-kind="wd"><i></i>Withdraw<b>—</b></span>
      </div>
      <div class="chains"></div>
      <div class="actions">
        <button class="btn primary" data-act="deposit">Deposit</button>
        <button class="btn" data-act="withdraw">Withdraw</button>
      </div>
      <div class="foot"></div>
    </div>`;

  shadow.append(style, panel);

  const $ = <T extends Element>(selector: string): T => panel.querySelector(selector) as T;
  const coinEl = $<HTMLElement>('.coin');
  const quoteEl = $<HTMLElement>('.quote');
  const depChip = $<HTMLElement>('.chip[data-kind="dep"]');
  const wdChip = $<HTMLElement>('.chip[data-kind="wd"]');
  const chainsEl = $<HTMLElement>('.chains');
  const footEl = $<HTMLElement>('.foot');

  let coin = '';
  let quote = '';
  let info: CoinInfo | null = null;
  let loading = false;

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
    const position = options.getConfig().position || 'bottom-left';
    panel.classList.add(`pos-${position}`);
  };

  const setChip = (chip: HTMLElement, available: boolean | null, delayed = false): void => {
    const value = chip.querySelector('b')!;
    chip.classList.remove('ok', 'bad', 'warn');
    if (available === null) {
      value.textContent = '—';
      return;
    }
    if (available) {
      chip.classList.add(delayed ? 'warn' : 'ok');
      value.textContent = delayed ? 'delayed' : 'enabled';
    } else {
      chip.classList.add('bad');
      value.textContent = 'disabled';
    }
  };

  const render = (): void => {
    coinEl.textContent = coin || '—';
    quoteEl.textContent = quote ? `/${quote}` : '';

    if (loading) {
      setChip(depChip, null);
      setChip(wdChip, null);
      footEl.textContent = 'loading coin info…';
      return;
    }

    if (!info || info.error) {
      setChip(depChip, null);
      setChip(wdChip, null);
      chainsEl.textContent = '';
      footEl.innerHTML = '';
      const message = document.createElement('span');
      message.textContent = info?.error ? `${info.error} · ` : 'no coin info · ';
      const retry = document.createElement('button');
      retry.className = 'retry';
      retry.textContent = 'retry';
      retry.addEventListener('click', () => void load(true));
      footEl.append(message, retry);
      return;
    }

    const depositDelayed = info.chains.some((chain) => chain.depositDelayed);
    const withdrawDelayed = info.chains.some((chain) => chain.withdrawDelayed);
    setChip(depChip, info.deposit, depositDelayed);
    setChip(wdChip, info.withdraw, withdrawDelayed);

    chainsEl.textContent = '';
    if (options.getConfig().showChains && info.chains.length) {
      for (const chain of info.chains) {
        const row = document.createElement('div');
        row.className = 'chain';

        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = chain.name;
        name.title = chain.name;

        const flags = document.createElement('span');
        flags.className = 'flags';
        const dep = document.createElement('span');
        dep.textContent = chain.deposit ? 'D✓' : 'D✗';
        dep.className = chain.deposit ? 'yes' : 'no';
        dep.title = chain.deposit ? 'deposit enabled' : 'deposit disabled';
        const wd = document.createElement('span');
        wd.textContent = chain.withdraw ? 'W✓' : 'W✗';
        wd.className = chain.withdraw ? 'yes' : 'no';
        wd.title = chain.withdraw ? 'withdraw enabled' : 'withdraw disabled';
        flags.append(dep, wd);

        row.append(name, flags);
        chainsEl.append(row);
      }
    }

    const rate = currentRate();
    const rateText = rate.rate ? ` · 1 USDT = ${formatIdr(rate.rate, { mode: 'full' })}` : '';
    footEl.textContent = `${timeAgo(info.updatedAt)}${rateText}`;
    footEl.title = `${info.source}${rate.source ? ` · rate from ${rate.source} (${timeAgo(rate.updatedAt)})` : ''}`;
  };

  const load = async (force = false): Promise<void> => {
    if (!coin) return;
    loading = true;
    render();
    try {
      info = await getCoinInfo(options.site, coin, force);
    } finally {
      loading = false;
      render();
    }
  };

  const syncPair = (): void => {
    const pair = currentPair();
    if (!pair) {
      host.style.display = 'none';
      return;
    }
    host.style.display = '';
    const nextCoin = pair.base;
    const nextQuote = pair.quote;
    if (nextCoin !== coin || nextQuote !== quote) {
      coin = nextCoin;
      quote = nextQuote;
      info = null;
      void load();
      return;
    }
    render();
  };

  // --- interactions -------------------------------------------------------
  panel.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!target) return;
    const action = target.dataset.act;
    if (action === 'deposit') window.open(depositUrl(options.site, coin), '_blank', 'noopener');
    if (action === 'withdraw') window.open(withdrawUrl(options.site, coin), '_blank', 'noopener');
    if (action === 'refresh') void load(true);
    if (action === 'collapse') {
      const collapsed = panel.dataset.collapsed !== 'true';
      panel.dataset.collapsed = String(collapsed);
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

  // --- mount --------------------------------------------------------------
  const mount = (): void => {
    if (!document.body) {
      requestAnimationFrame(mount);
      return;
    }
    document.body.appendChild(host);
    applyPosition();
    if (getStored<boolean>(COLLAPSE_KEY, false)) {
      panel.dataset.collapsed = 'true';
      $<HTMLElement>('[data-act="collapse"]').textContent = '+';
    }
    syncPair();
  };

  mount();

  return {
    refresh: () => {
      applyPosition();
      syncPair();
    },
    destroy: () => host.remove(),
  };
}

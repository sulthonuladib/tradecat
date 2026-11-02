/**
 * TradeCat entry point.
 */
import { detectSite } from './lib/site';
import { getStored, log } from './lib/store';
import { initRate, getUsdtIdrRate, onRateChange, rateValue, saveRate, syncRateFromStorage } from './lib/rate';
import { startOrderbook, describeOrderbook, type OrderbookConfig } from './lib/orderbook';
import { mountPanel, type PanelConfig } from './lib/panel';
import type { IdrMode } from './lib/format';

function num(key: string, fallback: number): number {
  const raw = getStored<unknown>(key, fallback);
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function str(key: string, fallback: string): string {
  const raw = getStored<unknown>(key, fallback);
  if (typeof raw === 'string') return raw;
  if (raw == null) return fallback;
  return String(raw);
}

function bool(key: string, fallback: boolean): boolean {
  const raw = getStored<unknown>(key, fallback);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return /^(true|1|on|yes)$/i.test(raw);
  if (typeof raw === 'number') return raw !== 0;
  return fallback;
}

const asMode = (value: string, fallback: IdrMode): IdrMode =>
  value === 'full' || value === 'compact' || value === 'auto' ? (value as IdrMode) : fallback;

// GM_getValue crosses into the extension, so keep the hot path (every tick)
// from reading storage on each call.
let cachedOrderbookConfig: OrderbookConfig | null = null;
let cachedOrderbookConfigAt = 0;

function orderbookConfig(): OrderbookConfig {
  const now = Date.now();
  if (cachedOrderbookConfig && now - cachedOrderbookConfigAt < 3000) return cachedOrderbookConfig;
  cachedOrderbookConfig = {
    showPrice: bool('idr.showPrice', true),
    convertTotal: bool('idr.convertTotal', true),
    priceMode: asMode(str('idr.priceFormat', 'full'), 'full'),
    volumeMode: asMode(str('idr.volumeFormat', 'full'), 'full'),
    prefix: str('idr.prefix', ''),
    priceColor: str('idr.priceColor', '#ead05a'),
    volumeColor: str('idr.volumeColor', ''),
    fit: bool('idr.fit', true),
  };
  cachedOrderbookConfigAt = now;
  return cachedOrderbookConfig;
}

function panelConfig(): PanelConfig {
  return {
    enabled: bool('coin.panel', true),
    showChains: bool('coin.showChains', true),
    position: str('coin.position', 'bottom-left'),
  };
}

function watchNavigation(onChange: () => void): void {
  let last = location.href;
  const check = (): void => {
    if (location.href === last) return;
    last = location.href;
    onChange();
  };

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method] as (...args: any[]) => any;
    history[method] = function patched(this: History, ...args: any[]): any {
      const result = original.apply(this, args);
      setTimeout(check, 0);
      return result;
    } as any;
  }

  window.addEventListener('popstate', check);
  setInterval(check, 1000);
}

function registerMenu(handlers: {
  rescan: () => void;
  setRate: () => void;
  debug: () => void;
}): void {
  if (typeof GM_registerMenuCommand !== 'function') return;
  const register = (label: string, fn: () => void): void => {
    try {
      GM_registerMenuCommand(label, fn);
    } catch {
      /* ignore */
    }
  };

  register('TradeCat: rescan orderbook', handlers.rescan);
  register('TradeCat: set USDT → IDR rate', handlers.setRate);
  register('TradeCat: debug orderbook', handlers.debug);
  register('TradeCat: open settings', () => {
    if (typeof CAT_userConfig === 'function') {
      CAT_userConfig();
      return;
    }
    log('Open the ScriptCat dashboard → this script → Settings.');
  });
}

async function boot(): Promise<void> {
  const site = detectSite();
  initRate();

  const orderbook = startOrderbook({ site, getRate: rateValue, getConfig: orderbookConfig });

  // Small debug/automation surface, also handy from the DevTools console.
  (globalThis as any).TradeCat = {
    describe: () => describeOrderbook(site),
    rescan: () => orderbook.rescan(),
    rate: () => rateValue(),
    setRate: (value: number) => saveRate(value, 'manual'),
  };

  const panel = panelConfig().enabled ? mountPanel({ site, getConfig: panelConfig }) : null;

  onRateChange(() => orderbook.rescan());

  getUsdtIdrRate({
    ttlHours: num('idr.ttlHours', 6),
    enableNetwork: bool('idr.enableNetworkRate', false),
    fallbackRate: num('idr.fallbackRate', 18000),
  }).then((snapshot) => {
    log(`site=${site} rate=${snapshot.rate} (${snapshot.source})`);
  });

  // The updater script writes into shared storage; pick changes up without a reload.
  window.addEventListener('storage', (event) => {
    if (event.key && event.key.startsWith('tradecat:idr')) syncRateFromStorage();
  });
  setInterval(syncRateFromStorage, 30_000);

  watchNavigation(() => {
    panel?.refresh();
    orderbook.rescan();
  });

  registerMenu({
    rescan: () => orderbook.rescan(),
    setRate: () => {
      const answer = window.prompt('1 USDT = ? IDR', String(rateValue()));
      if (!answer) return;
      const parsed = Number(answer.replace(/[^\d.]/g, ''));
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      saveRate(parsed, 'manual');
      orderbook.rescan();
    },
    debug: () => {
      const info = describeOrderbook(site);
      log('orderbook debug', info);
      if (typeof GM_notification === 'function') {
        GM_notification({ title: 'TradeCat', text: `${info.rows} rows · adapter: ${info.adapter}` });
      }
    },
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void boot(), { once: true });
} else {
  void boot();
}

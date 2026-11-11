/** Site detection + URL helpers. */

export type SiteId = 'gate' | 'mexc' | 'binance' | 'kucoin' | 'bybit' | 'indodax' | 'generic';

const FORCED: ReadonlyArray<SiteId> = ['gate', 'mexc', 'binance', 'kucoin', 'bybit', 'indodax'];

export function detectSite(host: string = location.hostname): SiteId {
  const forced = (globalThis as any).__TRADECAT_SITE__ as SiteId | undefined;
  if (forced && FORCED.includes(forced)) return forced;
  if (/(^|\.)gate\.(com|io)$/.test(host)) return 'gate';
  if (/(^|\.)mexc\.(com|fm)$/.test(host)) return 'mexc';
  if (/(^|\.)binance\.com$/.test(host)) return 'binance';
  if (/(^|\.)kucoin\.com$/.test(host)) return 'kucoin';
  if (/(^|\.)bybit\.com$/.test(host)) return 'bybit';
  if (/(^|\.)indodax\.com$/.test(host)) return 'indodax';
  return 'generic';
}

/**
 * Exchanges that only need a small fee / margin readout instead of the full
 * orderbook conversion. Indodax prices are already in rupiah, so converting
 * them makes no sense; the useful numbers are the withdrawal fee and the 1%
 * spread.
 */
export function isSimpleSite(site: SiteId): boolean {
  return site === 'indodax';
}

/**
 * Exchanges whose orderbook is drawn on a `<canvas>` (Bybit spot), so the DOM
 * overlay engine has nothing to attach to. Those get a small orderbook panel
 * fed by the public API instead.
 */
export function usesApiBook(site: SiteId): boolean {
  return site === 'bybit';
}

export interface Pair {
  base: string;
  quote: string;
}

const QUOTES = ['USDT', 'IDR', 'BTC', 'USDC', 'BUSD', 'ETH'];

/** BTC_USDT / BTC-USDT / /trade/spot/BTC/USDT / BTCIDR from the trade URL. */
export function currentPair(path: string = location.pathname): Pair | null {
  // Bybit puts the pair in two path segments: /en/trade/spot/BTC/USDT
  const bybit = path.match(/\/trade\/(?:spot|linear|inverse)\/([A-Za-z0-9]{1,16})\/([A-Za-z0-9]{1,12})/);
  if (bybit?.[1] && bybit[2]) {
    return { base: bybit[1].toUpperCase(), quote: bybit[2].toUpperCase() };
  }

  const match = path.match(/\/(?:trade|exchange|spot|market)\/([A-Za-z0-9]{1,16})[_-]([A-Za-z0-9]{1,12})/);
  if (match?.[1] && match[2]) {
    return { base: match[1].toUpperCase(), quote: match[2].toUpperCase() };
  }

  // Indodax concatenates the pair: /market/BTCIDR, /trade/SOLIDR/index.html
  const compact = path.match(/\/(?:trade|market)\/([A-Za-z0-9]{2,20})(?:\/index\.html)?\/?$/);
  const symbol = compact?.[1]?.toUpperCase();
  if (symbol && /^[A-Z0-9]+$/.test(symbol)) {
    for (const quote of QUOTES) {
      if (symbol.length > quote.length && symbol.endsWith(quote)) {
        return { base: symbol.slice(0, -quote.length), quote };
      }
    }
  }

  return null;
}

function origin(fallback: string): string {
  return location.origin && location.origin !== 'null' ? location.origin : fallback;
}

export function depositUrl(site: SiteId, coin: string): string {
  const base = origin('https://www.gate.com');
  if (site === 'gate') return `${base}/myaccount/deposit/${coin}`;
  if (site === 'mexc') return `${base}/assets/deposit/${coin}`;
  if (site === 'binance') return `${base}/my/wallet/deposit`;
  if (site === 'kucoin') return `${base}/assets/deposit`;
  if (site === 'bybit') return `${base}/en/assets/deposit`;
  return '';
}

export function withdrawUrl(site: SiteId, coin: string): string {
  const base = origin('https://www.gate.com');
  if (site === 'gate') return `${base}/myaccount/withdraw/${coin}`;
  if (site === 'mexc') return `${base}/assets/withdraw/${coin}`;
  if (site === 'binance') return `${base}/my/wallet/withdraw`;
  if (site === 'kucoin') return `${base}/assets/withdraw`;
  if (site === 'bybit') return `${base}/en/assets/withdraw`;
  return '';
}

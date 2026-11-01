/** Site detection + URL helpers. */

export type SiteId = 'gate' | 'mexc' | 'generic';

export function detectSite(host: string = location.hostname): SiteId {
  const forced = (globalThis as any).__TRADECAT_SITE__;
  if (forced === 'gate' || forced === 'mexc') return forced;
  if (/(^|\.)gate\.(com|io)$/.test(host)) return 'gate';
  if (/(^|\.)mexc\.(com|fm)$/.test(host)) return 'mexc';
  return 'generic';
}

export interface Pair {
  base: string;
  quote: string;
}

/** BTC_USDT / BTC-USDT from /trade/... or /exchange/... */
export function currentPair(path: string = location.pathname): Pair | null {
  const match = path.match(/\/(?:trade|exchange|spot)\/([A-Za-z0-9]{1,12})[_-]([A-Za-z0-9]{1,12})/);
  if (!match) return null;
  return { base: match[1].toUpperCase(), quote: match[2].toUpperCase() };
}

export function depositUrl(site: SiteId, coin: string): string {
  const origin = location.origin && location.origin !== 'null' ? location.origin : 'https://www.gate.com';
  if (site === 'gate') return `${origin}/myaccount/deposit/${coin}`;
  if (site === 'mexc') return `${origin}/assets/deposit/${coin}`;
  return '';
}

export function withdrawUrl(site: SiteId, coin: string): string {
  const origin = location.origin && location.origin !== 'null' ? location.origin : 'https://www.gate.com';
  if (site === 'gate') return `${origin}/myaccount/withdraw/${coin}`;
  if (site === 'mexc') return `${origin}/assets/withdraw/${coin}`;
  return '';
}

import { detectSite, type SiteId } from '../site';
import { binanceAdapter } from './binance';
import { gateAdapter } from './gate';
import { genericAdapter } from './generic';
import { kucoinAdapter } from './kucoin';
import { mexcAdapter } from './mexc';
import type { ExchangeAdapter } from './types';

/** Sites without a DOM orderbook (Bybit canvas, Indodax simple mode) are absent. */
export const ADAPTERS: Partial<Record<SiteId, ExchangeAdapter>> = {
  gate: gateAdapter,
  mexc: mexcAdapter,
  binance: binanceAdapter,
  kucoin: kucoinAdapter,
  generic: genericAdapter,
};

/** Adapter for the current host (or the one explicitly forced by the caller). */
export function adapterFor(site: SiteId | undefined = detectSite()): ExchangeAdapter {
  return ADAPTERS[site] ?? genericAdapter;
}

export type { ExchangeAdapter } from './types';

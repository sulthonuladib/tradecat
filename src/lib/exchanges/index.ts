import { detectSite, type SiteId } from '../site';
import { gateAdapter } from './gate';
import { genericAdapter } from './generic';
import { mexcAdapter } from './mexc';
import type { ExchangeAdapter } from './types';

export const ADAPTERS: Record<SiteId, ExchangeAdapter> = {
  gate: gateAdapter,
  mexc: mexcAdapter,
  generic: genericAdapter,
};

/** Adapter for the current host (or the one explicitly forced by the caller). */
export function adapterFor(site: SiteId | undefined = detectSite()): ExchangeAdapter {
  return ADAPTERS[site] ?? genericAdapter;
}

export type { ExchangeAdapter } from './types';

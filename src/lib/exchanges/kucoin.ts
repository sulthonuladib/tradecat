/**
 * kucoin.com orderbook locator.
 *
 * Both sides are virtualised lists (`ReactVirtualized__Grid__innerScrollContainer`),
 * and every visible row is a div with four children (price, amount, total and a
 * depth bar). Rows are matched structurally, so the Tailwind class soup does not
 * matter, and the scope scan keeps working if the virtualised markup changes.
 */
import type { ExchangeAdapter } from './types';
import { locateRows, rowsByPosition } from './scan';

const ROW_SELECTORS = [
  '[class*="ReactVirtualized__Grid__innerScrollContainer" i] > div',
  '[class*="orderbook-row" i]',
  '[class*="orderbook-item" i]',
  '[class*="orderBookItem" i]',
];

const SCOPE_SELECTORS = [
  '[class*="orderbook-content" i]',
  '[class*="order-book" i]',
  '[class*="orderbook" i]',
];

export const kucoinAdapter: ExchangeAdapter = {
  id: 'kucoin',
  cacheMs: 300,
  locate(doc) {
    // KuCoin's Total column is a cumulative base amount, so it fails the
    // product check the generic locator relies on. Map the three numbers by
    // position instead and derive the row value from price × amount.
    const positional = rowsByPosition(doc, ROW_SELECTORS);
    if (positional) return positional;
    return locateRows(doc, { rows: [], scopes: SCOPE_SELECTORS });
  },
};

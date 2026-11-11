/**
 * binance.com orderbook locator.
 *
 * Each row is a `.orderbook-progress` div inside `.orderbook-list` (one list
 * per side), and every row holds the three numbers in DOM order:
 *
 *   price · amount · total
 *
 * The class names are only hints: the row is accepted when price × amount ≈
 * total, and the scope scan catches a renamed wrapper.
 */
import type { ExchangeAdapter } from './types';
import { locateRows } from './scan';

const ROW_SELECTORS = [
  '[class*="orderbook-progress" i]',
  '[class*="orderbook-row" i]',
  '[class*="orderbook-item" i]',
];

const SCOPE_SELECTORS = [
  '[class*="tradew-ob-container" i]',
  '[class*="orderbook-list" i]',
  '[class*="orderbook" i]',
];

export const binanceAdapter: ExchangeAdapter = {
  id: 'binance',
  cacheMs: 300,
  locate(doc) {
    return locateRows(doc, { rows: ROW_SELECTORS, scopes: SCOPE_SELECTORS });
  },
};

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
import type { OrderRow } from '../detect';
import type { ExchangeAdapter } from './types';
import { locateRows } from './scan';

const ROW_SELECTORS = [
  // The *visual* row is `.row-content`: Binance wraps it in
  // `.progress-container` / `.orderbook-progress` shells, and using those as
  // the row makes every cell lookup climb back to the wrapper, which used to
  // mark the whole row as "the Total cell" and hide price + amount too.
  '[class*="orderbook" i] [class*="row-content" i]',
  '[class*="progress-container" i] > [class*="row-content" i]',
  '[class*="row-content" i]',
  '[class*="orderbook-row" i]',
  '[class*="orderbook-item" i]',
];

const SCOPE_SELECTORS = [
  '[class*="tradew-ob-container" i]',
  '[class*="orderbook-list" i]',
  '[class*="orderbook" i]',
];

/**
 * Binance keeps the orderbook depth mode in localStorage:
 * `trd-orderbook-visual` is `"amount"` or `"cumulative"`. In cumulative mode
 * the background bars are summed, but the Total column stays per-row - so sum
 * the displayed totals here to match what the mode promises.
 */
const VISUAL_KEY = 'trd-orderbook-visual';

function cumulativeMode(): boolean {
  try {
    const raw = localStorage.getItem(VISUAL_KEY);
    if (!raw) return false;
    return JSON.parse(raw) === 'cumulative';
  } catch {
    return false;
  }
}

/**
 * Mark the depth step of each row (0 = closest to the mid price).
 *
 * Binance renders asks top-to-bottom as farthest-to-best, and bids as
 * best-to-farthest, so the ask index is reversed.
 */
function markCumulative(rows: OrderRow[]): void {
  if (!rows.length || !cumulativeMode()) return;

  const sides = new Map<string, OrderRow[]>();
  for (const row of rows) {
    let side = '';
    try {
      const holder = row.row.closest<HTMLElement>('[class*="orderbook-ask" i], [class*="orderbook-bid" i]');
      const cls = holder?.className ?? '';
      if (/ask/i.test(cls)) side = 'ask';
      else if (/bid/i.test(cls)) side = 'bid';
    } catch {
      /* ignore */
    }
    if (!side) continue;
    const list = sides.get(side) ?? [];
    list.push(row);
    sides.set(side, list);
  }

  for (const [side, list] of sides) {
    const count = list.length;
    list.forEach((row, index) => {
      row.cumulative = { group: side, index: side === 'ask' ? count - 1 - index : index };
    });
  }
}

export const binanceAdapter: ExchangeAdapter = {
  id: 'binance',
  cacheMs: 300,
  locate(doc) {
    const rows = locateRows(doc, { rows: ROW_SELECTORS, scopes: SCOPE_SELECTORS });
    if (rows) markCumulative(rows);
    return rows;
  },
};

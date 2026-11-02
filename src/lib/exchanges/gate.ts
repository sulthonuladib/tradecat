/**
 * gate.com orderbook locator.
 *
 * Gate renders the book as div rows (hashed CSS-module class names, e.g.
 * `total-n1jXwI` / `tr-text-right`), so class names are used only as *hints* for
 * where to look. The rows themselves are found structurally, which keeps this
 * working when they ship a new hash prefix.
 */
import { detectRowGroups, chooseRows, type OrderRow } from '../detect';
import type { ExchangeAdapter } from './types';

/** Containers that are likely to hold the book, most specific first. */
const SCOPES = [
  '[id*="market-list" i]',
  '[class*="orderbook" i]',
  '[class*="order-book" i]',
  '[class*="order_book" i]',
  '[class*="entrust" i]',
  '[class*="trade-grid" i]',
  '[id*="orderbook" i]',
];

function rowsIn(scope: HTMLElement, minRows: number): OrderRow[] {
  return chooseRows(detectRowGroups(scope, { minRows, maxNodes: 12000 }));
}

export const gateAdapter: ExchangeAdapter = {
  id: 'gate',
  cacheMs: 500,
  locate(doc) {
    let single: OrderRow[] | null = null;

    for (const selector of SCOPES) {
      let nodes: NodeListOf<HTMLElement>;
      try {
        nodes = doc.querySelectorAll<HTMLElement>(selector);
      } catch {
        continue;
      }
      for (const scope of nodes) {
        if (scope === doc.body || scope === doc.documentElement) continue;
        const rows = rowsIn(scope, 2);
        if (rows.length >= 2) return rows;
        // A collapsed book can show a single row per side; keep it as a
        // fallback but prefer a real list if another hint finds one.
        if (!single && rows.length === 1) single = rows;
      }
    }

    if (single) return single;

    // Last resort: scan the page. Two matching rows are already a list; the
    // price × amount ≈ total check keeps unrelated tables out.
    return rowsIn(doc.body, 2);
  },
};

/**
 * Shared locator helpers for exchanges whose orderbook is still DOM based.
 *
 * Two strategies, tried in order:
 *
 *   1. row hints - a class that is known to mark one book row. Each element is
 *      checked with the structural price × amount ≈ total test, so a renamed
 *      class only costs a rescan, not correctness.
 *   2. scope hints - containers that hold a book. Every matching container is
 *      scanned structurally and the results are merged, because ask and bid
 *      lists often live in two separate containers (Binance, KuCoin).
 */
import { cellOf } from '../dom';
import { chooseRows, detectRowGroups, leavesOf, rowTriple, type OrderRow } from '../detect';

export interface LocatorHints {
  /** Selectors that should each be one row. */
  rows?: string[];
  /** Selectors that contain one or both sides of a book. */
  scopes?: string[];
  minRows?: number;
}

function queryAll(doc: Document, selector: string): HTMLElement[] {
  try {
    return Array.from(doc.querySelectorAll<HTMLElement>(selector));
  } catch {
    return [];
  }
}

function rowsFromElements(doc: Document, selectors: string[]): OrderRow[] {
  for (const selector of selectors) {
    const rows: OrderRow[] = [];
    for (const item of queryAll(doc, selector)) {
      if (item === doc.body || item === doc.documentElement) continue;
      const row = rowTriple(item);
      if (row) rows.push(row);
    }
    if (rows.length >= 2) return rows;
  }
  return [];
}

function rowsFromScopes(doc: Document, selectors: string[], minRows: number): OrderRow[] {
  const rows: OrderRow[] = [];
  const seen = new Set<HTMLElement>();

  for (const selector of selectors) {
    for (const scope of queryAll(doc, selector)) {
      if (scope === doc.body || scope === doc.documentElement) continue;
      const found = chooseRows(detectRowGroups(scope, { minRows, maxNodes: 15000 }));
      for (const row of found) {
        if (seen.has(row.row)) continue;
        seen.add(row.row);
        rows.push(row);
      }
    }
  }

  return rows;
}

/**
 * Map rows by column position, without the price × amount ≈ total check.
 *
 * KuCoin's Total column is the cumulative base amount, so the product test
 * rejects every row there. The price/amount cells are still in the first three
 * numeric positions, and the adapter supplies the real total value.
 */
export function rowsByPosition(doc: Document, selectors: string[]): OrderRow[] | null {
  for (const selector of selectors) {
    const rows: OrderRow[] = [];
    const seen = new Set<HTMLElement>();
    for (const item of queryAll(doc, selector)) {
      if (seen.has(item) || item === doc.body || item === doc.documentElement) continue;
      const leaves = leavesOf(item, 6);
      const price = leaves[0];
      const amount = leaves[1];
      const total = leaves[2];
      if (!price || !amount || !total || !(price.value > 0) || !(amount.value > 0)) continue;
      seen.add(item);
      rows.push({
        row: item,
        price,
        amount,
        total,
        priceCell: cellOf(price.el, item),
        amountCell: cellOf(amount.el, item),
        totalCell: cellOf(total.el, item),
        key: '0,1,2',
        deriveTotal: true,
        totalValue: price.value * amount.value,
      });
    }
    if (rows.length >= 2) return rows;
  }
  return null;
}

export function locateRows(doc: Document, hints: LocatorHints): OrderRow[] | null {
  const minRows = hints.minRows ?? 2;
  const byRow = rowsFromElements(doc, hints.rows ?? []);
  if (byRow.length > 0) return byRow;

  const byScope = rowsFromScopes(doc, hints.scopes ?? [], minRows);
  return byScope.length > 0 ? byScope : null;
}

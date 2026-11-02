/**
 * mexc.fm orderbook locator.
 *
 * MEXC renders every row as `.…__orderbookItem` (the hash prefix changes, the
 * local name does not) with the cells in DOM order:
 *
 *   div.__bar (no text) · div.__price · div.__vol>span (amount) · div.__amount>span (total)
 *
 * The trade form above the book also has "Price (USDT)" labels, which is why the
 * old header-anchored locator never found the book. Here the anchor is the row
 * itself, and the price / amount / total cells are recovered by their numbers.
 */
import { chooseRows, detectRowGroups, detectRows, rowTriple, type OrderRow } from '../detect';
import type { ExchangeAdapter } from './types';

const ITEM_SELECTORS = [
  '[class*="orderbookItem" i]',
  '[class*="orderbook-item" i]',
  '[class*="orderBookItem" i]',
];

const BOX_SELECTORS = [
  '[class*="asksBox" i]',
  '[class*="bidsBox" i]',
  '[class*="asks" i]',
  '[class*="bids" i]',
];

function locateItems(doc: Document): OrderRow[] {
  for (const selector of ITEM_SELECTORS) {
    let items: NodeListOf<HTMLElement>;
    try {
      items = doc.querySelectorAll<HTMLElement>(selector);
    } catch {
      continue;
    }
    if (items.length === 0) continue;

    const rows: OrderRow[] = [];
    for (const item of items) {
      const row = rowTriple(item);
      if (row) rows.push(row);
    }
    if (rows.length > 0) return rows;
  }
  return [];
}

function locateBoxes(doc: Document): OrderRow[] {
  const groups = [];
  for (const selector of BOX_SELECTORS) {
    let boxes: NodeListOf<HTMLElement>;
    try {
      boxes = doc.querySelectorAll<HTMLElement>(selector);
    } catch {
      continue;
    }
    for (const box of boxes) {
      for (const group of detectRowGroups(box, { minRows: 2, maxNodes: 3000 })) groups.push(group);
    }
  }
  return chooseRows(groups);
}

export const mexcAdapter: ExchangeAdapter = {
  id: 'mexc',
  cacheMs: 300,
  locate(doc) {
    const items = locateItems(doc);
    if (items.length > 0) return items;

    const boxes = locateBoxes(doc);
    if (boxes.length > 0) return boxes;

    // Unknown MEXC layout: fall back to structure only.
    const rows = detectRows(doc.body, 2);
    return rows.length > 0 ? rows : null;
  },
};

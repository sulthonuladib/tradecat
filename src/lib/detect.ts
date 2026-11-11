/**
 * Layout detection shared by every exchange adapter.
 *
 * The old engine anchored on the "Price (USDT)" header and then searched upwards
 * for rows. On the real MEXC page the only such header belongs to the buy/sell
 * *form*, so nothing was ever converted. The approach here is the other way
 * around: find the rows first, then work out which cell is which.
 *
 * A row is a child of a repeated sibling group, where:
 *
 *   - the child contains 2..8 visible numbers,
 *   - `price × amount ≈ total` holds for one ordered triple inside that child,
 *   - at least two children of the same parent agree on the same column layout.
 *
 * That product check is what keeps the trade-history table (price / amount /
 * time) and the open-orders table out, and the repeated-sibling requirement is
 * what identifies a *list* of rows rather than a random card.
 */
import { cellOf, INJECTED, isVisible, siteText, walkLeaves } from './dom';
import { parseNumberInfo } from './format';

export interface Leaf {
  el: HTMLElement;
  text: string;
  value: number;
  step: number;
}

export interface OrderRow {
  row: HTMLElement;
  price: Leaf;
  amount: Leaf | null;
  total: Leaf;
  priceCell: HTMLElement;
  amountCell: HTMLElement | null;
  totalCell: HTMLElement;
  /** Column layout key, e.g. "0,1,2" - rows with the same key form one list. */
  key: string;
  /**
   * Rendered total, when it differs from the text in `total.el`. KuCoin's Total
   * column is the cumulative base amount, not price × amount, so its adapter
   * supplies the value instead of letting the engine re-parse that cell.
   */
  totalValue?: number;
  /** Recompute `totalValue` from price × amount on every refresh. */
  deriveTotal?: boolean;
}

interface Triple {
  price: Leaf;
  amount: Leaf;
  total: Leaf;
  key: string;
  span: number;
}

export interface RowGroup {
  parent: HTMLElement;
  rows: OrderRow[];
}

const MAX_ROW_NUMBERS = 8;

/** Visible numbers inside `el`, in DOM order. */
export function leavesOf(el: HTMLElement, limit = 10): Leaf[] {
  const els: HTMLElement[] = [];
  walkLeaves(el, els, 32, 800);

  const out: Leaf[] = [];
  for (const node of els) {
    if (out.length >= limit) break;
    if (!isVisible(node)) continue;
    const text = siteText(node);
    const info = parseNumberInfo(text);
    if (!info || !(info.value > 0)) continue;
    out.push({ el: node, text, value: info.value, step: info.step });
  }
  return out;
}

/** Relative tolerance for "price × amount ≈ total", derived from display rounding. */
function matches(price: Leaf, amount: Leaf, total: Leaf): boolean {
  const tolerance =
    Math.max(total.value * 0.02, total.step * 1.05, price.value * amount.step * 1.05) + 1e-12;
  return Math.abs(price.value * amount.value - total.value) <= tolerance;
}

/**
 * Best ordered triple among the row's numbers.
 *
 * "Best" means the tightest column span (contiguous columns win) and, on a tie,
 * the earliest start - on a 4-column row with a change percentage this picks
 * price/amount/total and ignores the extra number.
 */
function findTriple(leaves: Leaf[]): Triple | null {
  const count = Math.min(leaves.length, MAX_ROW_NUMBERS + 2);
  let best: Triple | null = null;

  for (let i = 0; i < count; i += 1) {
    const price = leaves[i];
    if (!price) continue;
    for (let j = i + 1; j < count; j += 1) {
      const amount = leaves[j];
      if (!amount) continue;
      for (let k = j + 1; k < count; k += 1) {
        const total = leaves[k];
        if (!total) continue;
        if (!matches(price, amount, total)) continue;

        const candidate: Triple = { price, amount, total, key: `${i},${j},${k}`, span: k - i };
        if (
          !best ||
          candidate.span < best.span ||
          (candidate.span === best.span && candidate.key < best.key)
        ) {
          best = candidate;
        }
      }
    }
  }

  return best;
}

/** Turn a matched triple into the row description the renderer works with. */
export function toOrderRow(row: HTMLElement, triple: Triple): OrderRow {
  return {
    row,
    price: triple.price,
    amount: triple.amount,
    total: triple.total,
    priceCell: cellOf(triple.price.el, row),
    amountCell: cellOf(triple.amount.el, row),
    totalCell: cellOf(triple.total.el, row),
    key: triple.key,
  };
}

/**
 * Re-derive a known row against its current DOM.
 *
 * Exchanges replace the cells inside a row on every update (React sets
 * `textContent`, gate swaps animated nodes), so element references captured a
 * moment ago can be detached. The column layout key is stable, so the numbers
 * are re-read and mapped positionally, with a full triple check as fallback.
 */
export function refreshRow(row: OrderRow): OrderRow | null {
  if (!row.row.isConnected) return null;

  const leaves = leavesOf(row.row, MAX_ROW_NUMBERS + 2);
  const [priceIndex = 0, amountIndex = 1, totalIndex = 2] = row.key.split(',').map(Number);
  const price = leaves[priceIndex];
  const amount = leaves[amountIndex];
  const total = leaves[totalIndex];
  if (price && amount && total) {
    const fresh = toOrderRow(row.row, {
      price,
      amount,
      total,
      key: row.key,
      span: totalIndex - priceIndex,
    });
    if (row.deriveTotal) fresh.totalValue = price.value * amount.value;
    return fresh;
  }
  return rowTriple(row.row);
}

/** Does this row's numbers still form a valid triple? */
export function rowTriple(row: HTMLElement): OrderRow | null {
  const leaves = leavesOf(row, MAX_ROW_NUMBERS + 2);
  if (leaves.length < 3) return null;
  const triple = findTriple(leaves);
  return triple ? toOrderRow(row, triple) : null;
}

function dominantKey(rows: OrderRow[]): string | null {
  const votes = new Map<string, number>();
  for (const row of rows) votes.set(row.key, (votes.get(row.key) ?? 0) + 1);

  let best: string | null = null;
  let bestCount = 0;
  for (const [key, count] of votes) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Structural scan inside `scope`.
 *
 * Phase 1 collects every visible number once (one DOM walk). Phase 2 climbs
 * from each number up to 10 ancestors and counts numbers per subtree, so the
 * "does this parent hold repeated numeric rows?" question is answered without
 * walking the same subtree over and over.
 */
export function detectRowGroups(
  scope: HTMLElement,
  options: { minRows?: number; maxNodes?: number; maxLeaves?: number } = {},
): RowGroup[] {
  const minRows = options.minRows ?? 2;
  const leaves: Leaf[] = [];
  const els: HTMLElement[] = [];
  walkLeaves(scope, els, options.maxLeaves ?? 1500, options.maxNodes ?? 20000);

  for (const el of els) {
    if (!isVisible(el)) continue;
    const info = parseNumberInfo(siteText(el));
    if (!info || !(info.value > 0)) continue;
    leaves.push({ el, text: siteText(el), value: info.value, step: info.step });
  }
  if (leaves.length < 3) return [];

  // Ancestor -> numbers in that ancestor's subtree (DOM order preserved).
  const buckets = new Map<HTMLElement, Leaf[]>();
  for (const leaf of leaves) {
    let node = leaf.el.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const bucket = buckets.get(node);
      if (bucket) bucket.push(leaf);
      else buckets.set(node, [leaf]);
    }
  }

  const groups: RowGroup[] = [];
  for (const [parent, numbers] of buckets) {
    if (numbers.length < minRows * 2) continue;

    const kids = Array.from(parent.children).filter(
      (kid): kid is HTMLElement => kid instanceof HTMLElement && !kid.classList.contains(INJECTED),
    );
    if (kids.length < minRows || kids.length > 96) continue;

    // A row has a handful of numbers; a two-side wrapper has dozens.
    const numbered: Array<{ kid: HTMLElement; own: Leaf[]; triple: Triple | null }> = [];
    let tooMany = false;
    for (const kid of kids) {
      const own = numbers.filter((leaf) => kid.contains(leaf.el));
      if (own.length === 0) continue;
      if (own.length > MAX_ROW_NUMBERS) {
        tooMany = true;
        break;
      }
      if (own.length < 2) continue;
      numbered.push({ kid, own, triple: findTriple(own) });
    }
    if (tooMany) continue;

    // Almost every child of a real row list is a row. A wrapper that merely
    // holds the two sides (plus a header / mid price) has a much lower ratio,
    // and treating it as a "row list" would put badges on whole side panels.
    if (numbered.length / kids.length < 0.6) continue;

    const candidates = numbered
      .filter((entry): entry is { kid: HTMLElement; own: Leaf[]; triple: Triple } => entry.triple !== null)
      .map((entry) => toOrderRow(entry.kid, entry.triple));
    if (candidates.length < minRows) continue;

    const key = dominantKey(candidates);
    if (!key) continue;
    const [priceIndex, amountIndex, totalIndex] = key.split(',').map(Number);

    // Every row shares the column layout, so a row whose numbers are caught
    // mid-animation (gate swaps amount/total text on each tick) can still be
    // mapped positionally instead of being dropped for a frame.
    const rows: OrderRow[] = [];
    for (const entry of numbered) {
      if (entry.triple && entry.triple.key === key) {
        rows.push(toOrderRow(entry.kid, entry.triple));
        continue;
      }
      const price = entry.own[priceIndex ?? 0];
      const amount = entry.own[amountIndex ?? 1];
      const total = entry.own[totalIndex ?? 2];
      if (!price || !amount || !total) continue;
      rows.push(
        toOrderRow(entry.kid, {
          price,
          amount,
          total,
          key,
          span: (totalIndex ?? 2) - (priceIndex ?? 0),
        }),
      );
    }

    if (rows.length < minRows) continue;
    groups.push({ parent, rows });
  }

  return groups;
}

/** Do `a` and `b` live in the same region of the page (both sides of one book)? */
function related(a: HTMLElement, b: HTMLElement): boolean {
  if (a === b) return true;
  let node: HTMLElement | null = a;
  for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
    if (node === b || node.contains(b)) return true;
  }
  node = b;
  for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
    if (node === a || node.contains(a)) return true;
  }
  return false;
}

/**
 * Pick the best group plus its sibling list (asks + bids).
 *
 * The largest row group is the anchor; a second group is kept only when it is
 * close to the same size and lives next to the anchor, which is exactly the
 * relationship between the two orderbook sides.
 */
export function chooseRows(groups: RowGroup[]): OrderRow[] {
  if (groups.length === 0) return [];

  const ranked = [...groups].sort((a, b) => b.rows.length - a.rows.length);
  const anchor = ranked[0];
  if (!anchor) return [];
  const minimum = Math.max(2, Math.floor(anchor.rows.length * 0.4));

  const rows: OrderRow[] = [];
  const seen = new Set<HTMLElement>();
  const chosen: HTMLElement[] = [];

  const overlaps = (el: HTMLElement): boolean => {
    for (const existing of chosen) {
      if (existing.contains(el) || el.contains(existing)) return true;
    }
    return false;
  };

  for (const group of ranked) {
    if (group !== anchor && (group.rows.length < minimum || !related(group.parent, anchor.parent))) continue;
    for (const row of group.rows) {
      if (seen.has(row.row) || overlaps(row.row)) continue;
      seen.add(row.row);
      chosen.push(row.row);
      rows.push(row);
    }
  }
  return rows;
}

/** Rows found by a structural scan of `scope`. */
export function detectRows(scope: HTMLElement, minRows = 2): OrderRow[] {
  return chooseRows(detectRowGroups(scope, { minRows }));
}

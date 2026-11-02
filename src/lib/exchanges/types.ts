/**
 * Per-exchange orderbook adapters.
 *
 * Each exchange gets its own locator because their DOM is different and changes
 * on deploy. The locator only has to answer "which elements are orderbook rows,
 * and which cell is price / amount / total" - rendering, rate updates and
 * re-renders are handled once by the engine.
 */
import type { OrderRow } from '../detect';
import type { SiteId } from '../site';

export interface ExchangeAdapter {
  id: SiteId;
  /**
   * How long the engine may reuse the previous result before asking again.
   * Cheap selectors (MEXC) can be refreshed every tick, structural scans
   * (gate / generic) are throttled.
   */
  cacheMs: number;
  locate(doc: Document): OrderRow[] | null;
}

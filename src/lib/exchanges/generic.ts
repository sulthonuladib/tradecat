/**
 * Fallback locator for any other exchange: pure structure, no hints at all.
 */
import { chooseRows, detectRowGroups } from '../detect';
import type { ExchangeAdapter } from './types';

export const genericAdapter: ExchangeAdapter = {
  id: 'generic',
  cacheMs: 800,
  locate(doc) {
    const scope = doc.body;
    if (!scope) return null;
    const rows = chooseRows(detectRowGroups(scope, { minRows: 3, maxNodes: 25000, maxLeaves: 2000 }));
    return rows.length ? rows : null;
  },
};

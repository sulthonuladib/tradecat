/**
 * TradeCat · USDT/IDR rate updater.
 *
 * Runs as a ScriptCat background + crontab script (every 15 minutes) and writes
 * the rate into shared storage (`@storageName tradecat`) where the orderbook
 * script reads it. Sources are tried in order; the first success wins.
 */
import { RATE_SOURCES, readRateFromStorage, saveRate } from './lib/rate';
import { requestJson, log } from './lib/store';

const isBackground = typeof document === 'undefined';

async function refresh(): Promise<number | null> {
  for (const source of RATE_SOURCES) {
    try {
      const body = await requestJson(source.url, 10000);
      const rate = source.parse(body);
      if (rate && rate > 0) {
        const previous = readRateFromStorage();
        saveRate(rate, source.id);
        log(`USDT/IDR ${rate} from ${source.label} (was ${previous.rate}, ${previous.source})`);
        return rate;
      }
    } catch (error) {
      log(`rate source ${source.id} failed`, error);
    }
  }
  return null;
}

(async () => {
  const rate = await refresh();
  if (rate === null) log('no rate source returned a value - keeping the previous rate');

  if (!isBackground) {
    // Also usable as a normal script: refresh while the tab is open.
    setInterval(() => void refresh(), 15 * 60 * 1000);
  }
})();

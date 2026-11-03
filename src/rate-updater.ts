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

/**
 * The first refresh, as a Promise.
 *
 * ScriptCat background/crontab scripts must **return a Promise**: the manager
 * keeps the run "running" until it settles and only then marks it finished. The
 * previous fire-and-forget IIFE returned nothing, so ScriptCat considered the
 * run complete immediately - the dashboard sat at "Stopped" and the play button
 * looked inert even though the fetch was still in flight.
 */
const done = refresh().then((rate) => {
  if (rate === null) {
    throw new Error('no rate source returned a value - keeping the previous rate');
  }
  return rate;
});

if (!isBackground) {
  // Also usable as a normal script: refresh while the tab is open.
  setInterval(() => {
    void refresh().catch((error) => log('rate refresh failed', error));
  }, 15 * 60 * 1000);
}

// Bundled as an IIFE, so this becomes the IIFE's return value, which is the
// script's completion value for ScriptCat. `void` keeps noUnusedLocals happy;
// TS does not count a use inside the (suppressed) top-level return.
void done;
// @ts-expect-error top-level return is how ScriptCat exposes completion
return done;

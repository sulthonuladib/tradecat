/**
 * USDT -> IDR rate.
 *
 * The rate lives in shared storage (`@storageName tradecat`) so a *separate*
 * lightweight script can refresh it on a schedule. This module only reads it,
 * with an optional self-fetch path for people who do not want the updater.
 *
 * Storage keys (GM storage, mirrored to localStorage as `tradecat:<key>`):
 *   idr.rate       number   e.g. 18085
 *   idr.updatedAt  number   epoch ms
 *   idr.source     string   e.g. "indodax"
 */
import { getStored, setStored, requestJson, log } from './store';

export const DEFAULT_USDT_IDR = 18000;

export const KEY_RATE = 'idr.rate';
export const KEY_UPDATED_AT = 'idr.updatedAt';
export const KEY_SOURCE = 'idr.source';

export interface RateSnapshot {
  rate: number;
  updatedAt: number;
  source: string;
}

export interface RateSource {
  id: string;
  label: string;
  url: string;
  parse: (body: any) => number | null;
}

/** Add more sources here later - they are tried in order. */
export const RATE_SOURCES: RateSource[] = [
  {
    id: 'indodax',
    label: 'Indodax USDT/IDR',
    url: 'https://indodax.com/api/ticker/usdt_idr',
    parse: (body) => numberOrNull(body?.ticker?.last),
  },
  {
    id: 'coingecko',
    label: 'CoinGecko tether/idr',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=idr',
    parse: (body) => numberOrNull(body?.tether?.idr),
  },
];

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

let snapshot: RateSnapshot = { rate: DEFAULT_USDT_IDR, updatedAt: 0, source: 'constant' };
const listeners = new Set<(snap: RateSnapshot) => void>();

export function readRateFromStorage(): RateSnapshot {
  const rate = Number(getStored<number | string>(KEY_RATE, NaN));
  const updatedAt = Number(getStored<number>(KEY_UPDATED_AT, 0)) || 0;
  const source = String(getStored<string>(KEY_SOURCE, '') || '');
  if (Number.isFinite(rate) && rate > 0) {
    return { rate, updatedAt, source: source || 'storage' };
  }
  return { rate: DEFAULT_USDT_IDR, updatedAt: 0, source: 'constant' };
}

export function currentRate(): RateSnapshot {
  return snapshot;
}

export function rateValue(): number {
  return snapshot.rate;
}

export function onRateChange(cb: (snap: RateSnapshot) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function publish(next: RateSnapshot): void {
  const changed = next.rate !== snapshot.rate || next.updatedAt !== snapshot.updatedAt;
  snapshot = next;
  if (changed) listeners.forEach((cb) => cb(next));
}

/** Persist a rate (used by the updater and by the "set rate" menu command). */
export function saveRate(rate: number, source = 'manual'): RateSnapshot {
  const next: RateSnapshot = { rate, updatedAt: Date.now(), source };
  setStored(KEY_RATE, rate);
  setStored(KEY_UPDATED_AT, next.updatedAt);
  setStored(KEY_SOURCE, source);
  publish(next);
  return next;
}

/** Re-read shared storage; call after the updater script wrote something. */
export function syncRateFromStorage(): RateSnapshot {
  const next = readRateFromStorage();
  if (next.rate !== snapshot.rate) publish(next);
  return snapshot;
}

export interface RateOptions {
  ttlHours?: number;
  enableNetwork?: boolean;
  fallbackRate?: number;
}

/**
 * Promise-based rate getter.
 *
 * 1. fresh cached value -> return immediately
 * 2. (optional) try the network sources, persist on success
 * 3. stale cached value -> return it
 * 4. configured fallback / constant
 */
export async function getUsdtIdrRate(options: RateOptions = {}): Promise<RateSnapshot> {
  const ttlMs = Math.max(1, options.ttlHours ?? 6) * 3600_000;
  const cached = readRateFromStorage();

  if (cached.updatedAt && Date.now() - cached.updatedAt < ttlMs) {
    publish(cached);
    return cached;
  }

  if (options.enableNetwork) {
    for (const source of RATE_SOURCES) {
      try {
        const body = await requestJson(source.url);
        const rate = source.parse(body);
        if (rate) {
          const saved = saveRate(rate, source.id);
          log(`rate ${rate} from ${source.label}`);
          return saved;
        }
      } catch (error) {
        log(`rate source ${source.id} failed`, error);
      }
    }
  }

  if (cached.rate > 0 && cached.source !== 'constant') {
    publish(cached);
    return cached;
  }

  const fallback = options.fallbackRate && options.fallbackRate > 0 ? options.fallbackRate : DEFAULT_USDT_IDR;
  publish({ rate: fallback, updatedAt: cached.updatedAt, source: cached.source === 'constant' ? 'constant' : cached.source });
  return snapshot;
}

/** Initialise the in-memory snapshot from storage. */
export function initRate(): RateSnapshot {
  publish(readRateFromStorage());
  return snapshot;
}

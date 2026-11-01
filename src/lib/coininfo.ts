/**
 * Deposit / withdraw availability per coin and per chain.
 *
 * Gate has a clean public endpoint. MEXC's asset endpoints are sometimes behind
 * auth / bot protection, so several candidates are tried and failures degrade
 * gracefully (the panel still offers the Deposit / Withdraw buttons).
 */
import { getStored, setStored, requestJson, log } from './store';
import type { SiteId } from './site';

export interface ChainInfo {
  name: string;
  deposit: boolean;
  withdraw: boolean;
  depositDelayed?: boolean;
  withdrawDelayed?: boolean;
  minWithdraw?: number | null;
}

export interface CoinInfo {
  coin: string;
  deposit: boolean;
  withdraw: boolean;
  chains: ChainInfo[];
  source: string;
  updatedAt: number;
  error?: string;
}

const CACHE_TTL = 10 * 60 * 1000;

const gateUrl = (coin: string) => `https://api.gateio.ws/api/v4/spot/currencies/${encodeURIComponent(coin)}`;

const mexcUrls = (coin: string) => [
  `https://www.mexc.com/api/asset/v1/coin/detail?currency=${encodeURIComponent(coin)}`,
  `https://www.mexc.com/api/v3/capital/config/getall`,
  `https://www.mexc.fm/api/v3/capital/config/getall`,
  `https://www.mexc.com/api/asset/v1/coin/list`,
];

const cacheKey = (site: SiteId, coin: string): string => `coininfo.${site}.${coin}`;

function asBool(value: unknown, fallback = true): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return !/^(false|0|off|disabled?)$/i.test(value.trim());
  return fallback;
}

function pickChainList(raw: any): any[] {
  const candidates = [raw?.networkList, raw?.chains, raw?.networks, raw?.data?.networkList];
  for (const candidate of candidates) if (Array.isArray(candidate)) return candidate;
  return [];
}

/** Normalise Gate's `spot/currencies` payload. */
function fromGate(raw: any, coin: string): CoinInfo {
  const chains: ChainInfo[] = (Array.isArray(raw?.chains) ? raw.chains : []).map((chain: any) => ({
    name: String(chain?.name ?? chain?.chain ?? '?'),
    deposit: !asBool(chain?.deposit_disabled, false),
    withdraw: !asBool(chain?.withdraw_disabled, false),
    depositDelayed: asBool(chain?.deposit_delayed, false),
    withdrawDelayed: asBool(chain?.withdraw_delayed, false),
  }));
  return {
    coin,
    deposit: !asBool(raw?.deposit_disabled, false),
    withdraw: !asBool(raw?.withdraw_disabled, false),
    chains,
    source: 'gate:spot/currencies',
    updatedAt: Date.now(),
  };
}

/** Normalise the several MEXC shapes into one. */
function fromMexc(raw: any, coin: string): CoinInfo | null {
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.data?.list) ? raw.data.list : [];
  const entry =
    list.find((item: any) => String(item?.coin ?? item?.currency ?? item?.symbol ?? '').toUpperCase() === coin) ??
    (String(raw?.coin ?? raw?.currency ?? '').toUpperCase() === coin ? raw : null);
  if (!entry) return null;

  const chains: ChainInfo[] = pickChainList(entry).map((chain: any) => ({
    name: String(chain?.network ?? chain?.chain ?? chain?.name ?? '?'),
    deposit: asBool(chain?.depositEnable ?? chain?.deposit_enable ?? chain?.depositEnabled, true),
    withdraw: asBool(chain?.withdrawEnable ?? chain?.withdraw_enable ?? chain?.withdrawEnabled, true),
    depositDelayed: asBool(chain?.depositDelayed ?? chain?.deposit_delayed, false),
    withdrawDelayed: asBool(chain?.withdrawDelayed ?? chain?.withdraw_delayed, false),
    minWithdraw: chain?.withdrawMin != null ? Number(chain.withdrawMin) : null,
  }));

  return {
    coin,
    deposit: asBool(entry?.depositEnable ?? entry?.deposit_enable, true),
    withdraw: asBool(entry?.withdrawEnable ?? entry?.withdraw_enable, true),
    chains,
    source: 'mexc:asset',
    updatedAt: Date.now(),
  };
}

function readCache(site: SiteId, coin: string): CoinInfo | null {
  const cached = getStored<CoinInfo | null>(cacheKey(site, coin), null);
  if (!cached || !cached.updatedAt) return null;
  if (Date.now() - cached.updatedAt > CACHE_TTL) return null;
  return cached;
}

export async function getCoinInfo(site: SiteId, coin: string, force = false): Promise<CoinInfo> {
  if (!force) {
    const cached = readCache(site, coin);
    if (cached) return cached;
  }

  const fail = (message: string): CoinInfo => ({
    coin,
    deposit: true,
    withdraw: true,
    chains: [],
    source: 'unavailable',
    updatedAt: Date.now(),
    error: message,
  });

  if (site === 'gate') {
    try {
      const raw = await requestJson(gateUrl(coin));
      const info = fromGate(raw, coin);
      setStored(cacheKey(site, coin), info);
      return info;
    } catch (error) {
      log('gate coin info failed', error);
      return fail('Gate API unreachable');
    }
  }

  if (site === 'mexc') {
    for (const url of mexcUrls(coin)) {
      try {
        const raw = await requestJson(url);
        const info = fromMexc(raw, coin);
        if (info) {
          setStored(cacheKey(site, coin), info);
          return info;
        }
      } catch (error) {
        log(`mexc coin info failed (${url})`, error);
      }
    }
    return fail('MEXC asset API unavailable');
  }

  return fail('Unsupported site');
}

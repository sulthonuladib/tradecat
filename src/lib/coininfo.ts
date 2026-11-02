/**
 * Deposit / withdraw availability, network list, fees and limits per coin.
 *
 * Both exchanges expose the useful data on **same-origin, logged-in** web
 * endpoints, not on their public API:
 *
 *   gate.com   GET  /wallet/currency_chains?currency=COIN   (public: chains,
 *              deposit/withdraw flags, min withdraw)
 *              POST /json_svr/query?u=116                   (session: per-chain
 *              withdraw_txfee + rate_usdt, csrftoken header)
 *   mexc.fm    GET  /api/platform/asset/api/asset/spot/currency/v3?currency=COIN
 *              (session: data.chains[].chainName/enableDeposit/enableWithdraw/
 *              withdrawFee/withdrawMin + data.currencyPrice)
 *
 * The MEXC one is the endpoint the reference script used; our previous code hit
 * a signed API and a `.com` URL, which always failed. Fees need a login, so the
 * model carries `needsLogin` and the panel degrades to status-only.
 *
 * Fee display: fee is in coin units; `priceUsdt` (from the response or the
 * public ticker) times the USDT/IDR rate turns it into rupiah.
 */
import { getStored, setStored, requestJson, log } from './store';
import type { SiteId } from './site';

export interface ChainInfo {
  name: string;
  deposit: boolean;
  withdraw: boolean;
  depositDelayed: boolean;
  withdrawDelayed: boolean;
  /** Fixed withdrawal fee, in coin units. */
  fee: number | null;
  /** Percentage part of the fee, if the exchange charges one. */
  feePercent: number | null;
  minWithdraw: number | null;
  maxWithdraw: number | null;
}

export interface CoinInfo {
  coin: string;
  deposit: boolean;
  withdraw: boolean;
  chains: ChainInfo[];
  /** Price of one coin in USDT, used to value the withdrawal fee. */
  priceUsdt: number | null;
  source: string;
  updatedAt: number;
  /** True when the exchange answered "log in" for the fee/status endpoint. */
  needsLogin: boolean;
  error?: string;
}

const CACHE_TTL = 10 * 60 * 1000;
const CACHE_PREFIX = 'coininfo.v2';

const cacheKey = (site: SiteId, coin: string): string => `${CACHE_PREFIX}.${site}.${coin}`;

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function asBool(value: unknown, fallback = true): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return !/^(false|0|off|disabled?|no)$/i.test(value.trim());
  return fallback;
}

/** Some payloads send an array, some a map keyed by name/id. */
function listOf(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value as Record<string, any>);
  return [];
}

function chainNameOf(chain: any): string {
  return String(chain?.chainName ?? chain?.chain ?? chain?.network ?? chain?.name ?? '').trim().toUpperCase();
}

const emptyChain = (name: string): ChainInfo => ({
  name,
  deposit: true,
  withdraw: true,
  depositDelayed: false,
  withdrawDelayed: false,
  fee: null,
  feePercent: null,
  minWithdraw: null,
  maxWithdraw: null,
});

function coinsDeposit(chains: ChainInfo[], fallback = true): boolean {
  return chains.length ? chains.some((chain) => chain.deposit) : fallback;
}

function coinsWithdraw(chains: ChainInfo[], fallback = true): boolean {
  return chains.length ? chains.some((chain) => chain.withdraw) : fallback;
}

// --- gate ----------------------------------------------------------------

interface GateFee {
  fee: number | null;
  percent: number | null;
  min: number | null;
  max: number | null;
}

/**
 * Normalise gate's public `wallet/currency_chains` list plus the session
 * `json_svr` fee payload (`datas.chains[].withdraw_txfee`, `datas.rate_usdt`).
 */
export function gateInfoFrom(chainsRaw: unknown, feeBody: any, coin: string): CoinInfo {
  const fees = new Map<string, GateFee>();
  let priceUsdt: number | null = null;
  let needsLogin = false;

  const message = String(feeBody?.resMsg?.message ?? feeBody?.message ?? '');
  if (feeBody && (Number(feeBody?.resMsg?.code) === 1000 || /log ?in|login first/i.test(message))) {
    needsLogin = true;
  } else if (feeBody) {
    priceUsdt = num(feeBody?.datas?.rate_usdt ?? feeBody?.datas?.rateUsdt);
    for (const chain of listOf(feeBody?.datas?.chains)) {
      const name = chainNameOf(chain);
      if (!name) continue;
      fees.set(name, {
        fee: num(chain?.withdraw_txfee ?? chain?.withdraw_fee ?? chain?.withdrawFix),
        percent: num(chain?.withdraw_percent ?? chain?.withdrawPercent),
        min: num(chain?.withdraw_min ?? chain?.withdrawMin),
        max: num(chain?.withdraw_max ?? chain?.withdrawMax),
      });
    }
  }

  const chains: ChainInfo[] = [];
  for (const raw of listOf(chainsRaw)) {
    const name = chainNameOf(raw);
    if (!name) continue;
    const fee = fees.get(name);
    const disabled = asBool(raw?.is_disabled, false);
    chains.push({
      name,
      deposit: !disabled && !asBool(raw?.is_deposit_disabled, false),
      withdraw: !disabled && !asBool(raw?.is_withdraw_disabled, false),
      depositDelayed: asBool(raw?.deposit_delayed, false),
      withdrawDelayed: asBool(raw?.withdraw_delayed, false),
      fee: fee?.fee ?? null,
      feePercent: fee?.percent ?? null,
      minWithdraw: num(raw?.withdraw_amount_min ?? raw?.withdraw_min) ?? fee?.min ?? null,
      maxWithdraw: num(raw?.withdraw_amount_max ?? raw?.withdraw_max) ?? fee?.max ?? null,
    });
  }

  // A chain can appear in the fee payload but not in the public list.
  for (const [name, fee] of fees) {
    if (chains.some((chain) => chain.name === name)) continue;
    chains.push({
      ...emptyChain(name),
      fee: fee.fee,
      feePercent: fee.percent,
      minWithdraw: fee.min,
      maxWithdraw: fee.max,
    });
  }

  return {
    coin,
    deposit: coinsDeposit(chains),
    withdraw: coinsWithdraw(chains),
    chains,
    priceUsdt,
    source: needsLogin ? 'gate:wallet/currency_chains (login for fees)' : 'gate:wallet/currency_chains + json_svr',
    updatedAt: Date.now(),
    needsLogin,
  };
}

// --- mexc ----------------------------------------------------------------

/**
 * Normalise MEXC's `currency/v3` web payload:
 * `{ data: { currencyPrice, chains: [{ chainName, enableDeposit,
 * enableWithdraw, withdrawFee, withdrawMin, ... }] } }`.
 *
 * The signed `/api/v3/capital/config/getall` endpoint the old code tried needs
 * an API key and never works from the page; this one uses the session cookies.
 */
export function mexcInfoFrom(body: any, coin: string): CoinInfo {
  const code = Number(body?.code);
  const message = String(body?.msg ?? body?.message ?? '');
  if (code === 401 || /log ?in/i.test(message)) {
    return {
      coin,
      deposit: true,
      withdraw: true,
      chains: [],
      priceUsdt: null,
      source: 'mexc:currency/v3 (login required)',
      updatedAt: Date.now(),
      needsLogin: true,
    };
  }

  const data = body?.data ?? body;
  const chains: ChainInfo[] = [];
  for (const raw of listOf(data?.chains ?? data?.networkList ?? data?.networks)) {
    const name = chainNameOf(raw);
    if (!name) continue;
    chains.push({
      name,
      deposit: asBool(raw?.enableDeposit ?? raw?.depositEnable ?? raw?.deposit_enable, true),
      withdraw: asBool(raw?.enableWithdraw ?? raw?.withdrawEnable ?? raw?.withdraw_enable, true),
      depositDelayed: asBool(raw?.depositDelayed ?? raw?.deposit_delayed, false),
      withdrawDelayed: asBool(raw?.withdrawDelayed ?? raw?.withdraw_delayed, false),
      fee: num(raw?.withdrawFee ?? raw?.withdraw_fee ?? raw?.fee),
      feePercent: num(raw?.withdrawFeePercent ?? raw?.withdrawPercent ?? raw?.withdraw_percent),
      minWithdraw: num(raw?.withdrawMin ?? raw?.withdraw_min ?? raw?.minWithdraw),
      maxWithdraw: num(raw?.withdrawMax ?? raw?.withdraw_max ?? raw?.maxWithdraw),
    });
  }

  return {
    coin,
    deposit: coinsDeposit(chains, asBool(data?.enableDeposit, true)),
    withdraw: coinsWithdraw(chains, asBool(data?.enableWithdraw, true)),
    chains,
    priceUsdt: num(data?.currencyPrice ?? data?.currency_price),
    source: 'mexc:currency/v3',
    updatedAt: Date.now(),
    needsLogin: false,
  };
}

// --- fetching ------------------------------------------------------------

const gateChainsUrl = (coin: string): string =>
  `https://api.gateio.ws/api/v4/wallet/currency_chains?currency=${encodeURIComponent(coin)}`;

const gateTickerUrl = (coin: string): string =>
  `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${encodeURIComponent(coin)}_USDT`;

const mexcCurrencyUrl = (coin: string): string =>
  `/api/platform/asset/api/asset/spot/currency/v3?currency=${encodeURIComponent(coin)}`;

const mexcTickerUrl = (coin: string): string =>
  `https://api.mexc.com/api/v3/ticker/price?symbol=${encodeURIComponent(coin)}USDT`;

/** Same-origin POST with the page session (gate's json_svr). */
async function gateFeeBody(coin: string): Promise<any> {
  if (typeof fetch !== 'function') throw new Error('fetch unavailable');
  const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (csrf) headers['Csrftoken'] = decodeURIComponent(csrf);

  const response = await fetch('/json_svr/query?u=116', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: new URLSearchParams({ type: 'getWithdrawChainsInfo', curr_type: coin }).toString(),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Same-origin GET with the page session (MEXC's web asset API). */
async function mexcCurrencyBody(coin: string): Promise<any> {
  if (typeof fetch !== 'function') throw new Error('fetch unavailable');
  const response = await fetch(mexcCurrencyUrl(coin), {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function gatePriceUsdt(coin: string): Promise<number | null> {
  try {
    const rows = await requestJson<any[]>(gateTickerUrl(coin), 8000);
    const pair = `${coin.toUpperCase()}_USDT`;
    const row = Array.isArray(rows) ? rows.find((item) => String(item?.currency_pair).toUpperCase() === pair) : null;
    return num(row?.last);
  } catch {
    return null;
  }
}

async function mexcPriceUsdt(coin: string): Promise<number | null> {
  try {
    const raw = await requestJson<any>(mexcTickerUrl(coin), 8000);
    return num(raw?.price);
  } catch {
    return null;
  }
}

function readCache(site: SiteId, coin: string): CoinInfo | null {
  const cached = getStored<CoinInfo | null>(cacheKey(site, coin), null);
  if (!cached || !cached.updatedAt) return null;
  if (Date.now() - cached.updatedAt > CACHE_TTL) return null;
  return cached;
}

function unavailable(coin: string, message: string): CoinInfo {
  return {
    coin,
    deposit: true,
    withdraw: true,
    chains: [],
    priceUsdt: null,
    source: 'unavailable',
    updatedAt: Date.now(),
    needsLogin: false,
    error: message,
  };
}

export async function getCoinInfo(site: SiteId, coin: string, force = false): Promise<CoinInfo> {
  if (!force) {
    const cached = readCache(site, coin);
    if (cached) return cached;
  }

  if (site === 'gate') {
    let chainsRaw: unknown = [];
    let feeBody: any = null;

    try {
      chainsRaw = await requestJson(gateChainsUrl(coin));
    } catch (error) {
      log('gate currency_chains failed', error);
    }
    try {
      feeBody = await gateFeeBody(coin);
    } catch (error) {
      log('gate withdraw fee request failed', error);
    }

    if (!listOf(chainsRaw).length && !feeBody) return unavailable(coin, 'Gate API unreachable');

    const info = gateInfoFrom(chainsRaw, feeBody, coin);
    if (info.priceUsdt == null) info.priceUsdt = await gatePriceUsdt(coin);
    setStored(cacheKey(site, coin), info);
    return info;
  }

  if (site === 'mexc') {
    let body: any;
    try {
      body = await mexcCurrencyBody(coin);
    } catch (error) {
      log('mexc currency/v3 failed', error);
      return unavailable(coin, 'MEXC asset API unreachable');
    }

    const info = mexcInfoFrom(body, coin);
    if (info.priceUsdt == null && !info.needsLogin) info.priceUsdt = await mexcPriceUsdt(coin);
    setStored(cacheKey(site, coin), info);
    return info;
  }

  return unavailable(coin, 'Unsupported site');
}

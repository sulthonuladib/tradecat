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

// --- binance -------------------------------------------------------------

/**
 * Normalise Binance's public `getNetworkCoinAll` payload:
 * `{ data: [{ coin, networkList: [{ network, depositEnable, withdrawEnable,
 * withdrawFee, withdrawMin, withdrawMax }] }] }`.
 *
 * The endpoint returns every coin at once, so the caller caches the payload
 * for the session and this function only picks the requested coin.
 */
export function binanceInfoFrom(body: unknown, coin: string): CoinInfo {
  const rows = listOf((body as any)?.data ?? body);
  const symbol = coin.toUpperCase();
  const entry = rows.find((row) => String(row?.coin ?? '').toUpperCase() === symbol);
  if (!entry) {
    return {
      coin,
      deposit: true,
      withdraw: true,
      chains: [],
      priceUsdt: null,
      source: 'binance:getNetworkCoinAll (coin not listed)',
      updatedAt: Date.now(),
      needsLogin: false,
    };
  }

  const chains: ChainInfo[] = [];
  for (const raw of listOf(entry?.networkList ?? entry?.networks)) {
    const name = String(raw?.network ?? raw?.networkDisplay ?? raw?.chain ?? '').trim().toUpperCase();
    if (!name) continue;
    chains.push({
      name,
      deposit: asBool(raw?.depositEnable ?? raw?.deposit_enable, true),
      withdraw: asBool(raw?.withdrawEnable ?? raw?.withdraw_enable, true),
      depositDelayed: asBool(raw?.depositDelayed ?? raw?.deposit_delayed, false),
      withdrawDelayed: asBool(raw?.withdrawDelayed ?? raw?.withdraw_delayed, false),
      fee: num(raw?.withdrawFee ?? raw?.withdraw_fee),
      feePercent: null,
      minWithdraw: num(raw?.withdrawMin ?? raw?.withdraw_min),
      maxWithdraw: num(raw?.withdrawMax ?? raw?.withdraw_max),
    });
  }

  return {
    coin,
    deposit: coinsDeposit(chains, asBool(entry?.depositAllEnable, true)),
    withdraw: coinsWithdraw(chains, asBool(entry?.withdrawAllEnable, true)),
    chains,
    priceUsdt: null,
    source: 'binance:getNetworkCoinAll',
    updatedAt: Date.now(),
    needsLogin: false,
  };
}

// --- kucoin --------------------------------------------------------------

/**
 * Normalise KuCoin's public `api/v3/currencies/{coin}` payload:
 * `{ code, data: { currency, chains: [{ chainName, isDepositEnabled,
 * isWithdrawEnabled, withdrawMinFee, withdrawalMinSize, ... }] } }`.
 */
export function kucoinInfoFrom(body: any, coin: string): CoinInfo {
  const code = String(body?.code ?? '');
  if (code !== '200000' && code !== '0' && body?.data == null) {
    return {
      coin,
      deposit: true,
      withdraw: true,
      chains: [],
      priceUsdt: null,
      source: 'kucoin:currencies (unavailable)',
      updatedAt: Date.now(),
      needsLogin: false,
      error: String(body?.msg ?? body?.message ?? 'unexpected response'),
    };
  }

  const data = body?.data ?? body;
  const chains: ChainInfo[] = [];
  for (const raw of listOf(data?.chains ?? data?.networkList)) {
    const name = String(raw?.chainName ?? raw?.chain ?? raw?.network ?? '').trim().toUpperCase();
    if (!name) continue;
    chains.push({
      name,
      deposit: asBool(raw?.isDepositEnabled ?? raw?.depositEnabled, true),
      withdraw: asBool(raw?.isWithdrawEnabled ?? raw?.withdrawEnabled, true),
      depositDelayed: false,
      withdrawDelayed: false,
      fee: num(raw?.withdrawMinFee ?? raw?.withdrawalMinFee ?? raw?.withdrawFee),
      feePercent: null,
      minWithdraw: num(raw?.withdrawMinSize ?? raw?.withdrawalMinSize),
      maxWithdraw: num(raw?.withdrawMaxSize ?? raw?.withdrawalMaxSize),
    });
  }

  return {
    coin,
    deposit: coinsDeposit(chains, asBool(data?.isDepositEnabled, true)),
    withdraw: coinsWithdraw(chains, asBool(data?.isWithdrawEnabled, true)),
    chains,
    priceUsdt: null,
    source: 'kucoin:currencies',
    updatedAt: Date.now(),
    needsLogin: false,
  };
}

// --- bybit ---------------------------------------------------------------

/**
 * Normalise Bybit's web `asset-common/coin-config` payload. It follows the v5
 * coin-info shape (`result.rows[].chains[]` with `chain`, `chainDeposit`,
 * `chainWithdraw`, `withdrawFee`, `withdrawMin`, `withdrawMax`), but the web
 * endpoint wraps it in `ret_code` instead of `retCode`.
 *
 * The endpoint is session backed ("private" in Bybit's URL), so a logged-out
 * response is reported as `needsLogin` and the panel degrades to a hint.
 */
export function bybitInfoFrom(body: any, coin: string): CoinInfo {
  const retCode = Number(body?.ret_code ?? body?.retCode ?? 0);
  const message = String(body?.ret_msg ?? body?.retMsg ?? body?.message ?? '');
  if (retCode !== 0 || /auth|login/i.test(message)) {
    return {
      coin,
      deposit: true,
      withdraw: true,
      chains: [],
      priceUsdt: null,
      source: 'bybit:coin-config (login required)',
      updatedAt: Date.now(),
      needsLogin: true,
    };
  }

  const result = body?.result ?? body?.data ?? body;
  const rows = listOf(result?.rows ?? result?.list ?? result);
  const symbol = coin.toUpperCase();
  const entry = rows.find((row) => String(row?.coin ?? row?.currency ?? '').toUpperCase() === symbol) ?? rows[0];

  const chains: ChainInfo[] = [];
  for (const raw of listOf(entry?.chains ?? entry?.networkList)) {
    const name = String(raw?.chain ?? raw?.chainName ?? raw?.network ?? '').trim().toUpperCase();
    if (!name) continue;
    chains.push({
      name,
      deposit: asBool(raw?.chainDeposit ?? raw?.depositEnable, true),
      withdraw: asBool(raw?.chainWithdraw ?? raw?.withdrawEnable, true),
      depositDelayed: false,
      withdrawDelayed: false,
      fee: num(raw?.withdrawFee ?? raw?.withdraw_fee),
      feePercent: null,
      minWithdraw: num(raw?.withdrawMin ?? raw?.withdraw_min),
      maxWithdraw: num(raw?.withdrawMax ?? raw?.withdraw_max),
    });
  }

  return {
    coin,
    deposit: coinsDeposit(chains),
    withdraw: coinsWithdraw(chains),
    chains,
    priceUsdt: null,
    source: 'bybit:coin-config',
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

const binanceAllCoinsUrl = 'https://www.binance.com/bapi/capital/v1/public/capital/getNetworkCoinAll';

const binanceTickerUrl = (coin: string): string =>
  `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(coin)}USDT`;

const kucoinCurrencyUrl = (coin: string): string =>
  `https://api.kucoin.com/api/v3/currencies/${encodeURIComponent(coin)}`;

const kucoinTickerUrl = (coin: string): string =>
  `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${encodeURIComponent(coin)}-USDT`;

const bybitCoinUrl = (coin: string): string =>
  `https://api2.bybit.com/v3/private/cht/asset-common/coin-config?coin=${encodeURIComponent(coin)}`;

const bybitTickerUrl = (coin: string): string =>
  `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${encodeURIComponent(coin)}USDT`;

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

/**
 * Bybit's coin-config lives on api2, but the page session belongs to
 * bybit.com. Try the page's own fetch first (it sends credentials and passes
 * the edge checks), then fall back to the extension request.
 */
async function bybitCoinBody(coin: string): Promise<any> {
  if (typeof fetch === 'function' && /(^|\.)bybit\.com$/.test(location.hostname)) {
    try {
      const response = await fetch(bybitCoinUrl(coin), {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      if (response.ok) return response.json();
    } catch {
      /* fall through to the GM request */
    }
  }
  return requestJson(bybitCoinUrl(coin));
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

async function binancePriceUsdt(coin: string): Promise<number | null> {
  try {
    const raw = await requestJson<any>(binanceTickerUrl(coin), 8000);
    return num(raw?.price);
  } catch {
    return null;
  }
}

async function kucoinPriceUsdt(coin: string): Promise<number | null> {
  try {
    const raw = await requestJson<any>(kucoinTickerUrl(coin), 8000);
    return num(raw?.data?.price);
  } catch {
    return null;
  }
}

async function bybitPriceUsdt(coin: string): Promise<number | null> {
  try {
    const raw = await requestJson<any>(bybitTickerUrl(coin), 8000);
    return num(raw?.result?.list?.[0]?.lastPrice);
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

/** The all-coins payload is ~1 MB, so keep one copy for ten minutes. */
let binanceCoinsCache: { at: number; body: any } | null = null;

async function binanceCoinsPayload(): Promise<any> {
  if (binanceCoinsCache && Date.now() - binanceCoinsCache.at < CACHE_TTL) return binanceCoinsCache.body;
  const body = await requestJson(binanceAllCoinsUrl, 20000);
  binanceCoinsCache = { at: Date.now(), body };
  return body;
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

  if (site === 'binance') {
    let body: any;
    try {
      body = await binanceCoinsPayload();
    } catch (error) {
      log('binance getNetworkCoinAll failed', error);
      return unavailable(coin, 'Binance asset API unreachable');
    }

    const info = binanceInfoFrom(body, coin);
    if (info.priceUsdt == null) info.priceUsdt = await binancePriceUsdt(coin);
    if (!info.chains.length && !info.error) info.error = 'Coin is not listed on Binance';
    setStored(cacheKey(site, coin), info);
    return info;
  }

  if (site === 'kucoin') {
    let body: any;
    try {
      body = await requestJson(kucoinCurrencyUrl(coin));
    } catch (error) {
      log('kucoin currencies failed', error);
      return unavailable(coin, 'KuCoin asset API unreachable');
    }

    const info = kucoinInfoFrom(body, coin);
    if (info.priceUsdt == null && !info.error) info.priceUsdt = await kucoinPriceUsdt(coin);
    setStored(cacheKey(site, coin), info);
    return info;
  }

  if (site === 'bybit') {
    let body: any;
    try {
      body = await bybitCoinBody(coin);
    } catch (error) {
      log('bybit coin-config failed', error);
      return unavailable(coin, 'Bybit asset API unreachable');
    }

    const info = bybitInfoFrom(body, coin);
    if (info.priceUsdt == null && !info.needsLogin) info.priceUsdt = await bybitPriceUsdt(coin);
    setStored(cacheKey(site, coin), info);
    return info;
  }

  return unavailable(coin, 'Unsupported site');
}

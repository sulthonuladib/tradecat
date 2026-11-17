import { describe, expect, test } from 'bun:test';
import { currentPair, depositUrl, detectSite, isSimpleSite, usesApiBook } from '../src/lib/site';

describe('detectSite', () => {
  test('recognises every supported host, including subdomains', () => {
    expect(detectSite('www.gate.com')).toBe('gate');
    expect(detectSite('www.mexc.fm')).toBe('mexc');
    expect(detectSite('www.binance.com')).toBe('binance');
    expect(detectSite('www.kucoin.com')).toBe('kucoin');
    expect(detectSite('www.bybit.com')).toBe('bybit');
    expect(detectSite('indodax.com')).toBe('indodax');
    expect(detectSite('example.com')).toBe('generic');
    // A lookalike host must not match.
    expect(detectSite('notbinance.com')).toBe('generic');
  });

  test('flags the simple and API-book sites', () => {
    expect(isSimpleSite('indodax')).toBe(true);
    expect(isSimpleSite('kucoin')).toBe(false);
    expect(usesApiBook('bybit')).toBe(true);
    expect(usesApiBook('binance')).toBe(false);
  });
});

describe('depositUrl', () => {
  test('uses KuCoin’s supported deposit route, not the missing /assets/deposit page', () => {
    const location = new URL('https://www.kucoin.com/trade/BTC-USDT');
    const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', { configurable: true, value: location });
    try {
      // KuCoin’s Deposit FAQ links to /assets/coin:
      // https://www.kucoin.com/support/900002595503
      expect(depositUrl('kucoin', 'BTC')).toBe('https://www.kucoin.com/assets/coin');
      location.pathname = '/id/trade/ETH-USDT';
      expect(depositUrl('kucoin', 'ETH')).toBe('https://www.kucoin.com/assets/coin');
    } finally {
      if (original) Object.defineProperty(globalThis, 'location', original);
      else Reflect.deleteProperty(globalThis, 'location');
    }
  });
});

describe('currentPair', () => {
  test('reads underscore and dash pairs', () => {
    expect(currentPair('/trade/BTC_USDT')).toEqual({ base: 'BTC', quote: 'USDT' });
    expect(currentPair('/trade/ETH-BTC')).toEqual({ base: 'ETH', quote: 'BTC' });
    expect(currentPair('/exchange/sol_usdt')).toEqual({ base: 'SOL', quote: 'USDT' });
  });

  test('reads Bybit two-segment pairs', () => {
    expect(currentPair('/en/trade/spot/BTC/USDT')).toEqual({ base: 'BTC', quote: 'USDT' });
    expect(currentPair('/trade/spot/1000PEPE/USDT')).toEqual({ base: '1000PEPE', quote: 'USDT' });
  });

  test('reads Indodax concatenated pairs', () => {
    expect(currentPair('/market/BTCIDR')).toEqual({ base: 'BTC', quote: 'IDR' });
    expect(currentPair('/market/ETHUSDT')).toEqual({ base: 'ETH', quote: 'USDT' });
    expect(currentPair('/trade/SOLIDR/index.html')).toEqual({ base: 'SOL', quote: 'IDR' });
  });

  test('returns null outside a trade page', () => {
    expect(currentPair('/')).toBeNull();
    expect(currentPair('/markets')).toBeNull();
  });
});

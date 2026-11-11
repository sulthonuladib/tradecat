import { describe, expect, test } from 'bun:test';
import { currentPair, detectSite, isSimpleSite, usesApiBook } from '../src/lib/site';

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

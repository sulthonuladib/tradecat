import { describe, expect, test } from 'bun:test';
import { formatIdr, parseNumber } from '../src/lib/format';

describe('parseNumber', () => {
  const cases: Array<[string | null | undefined, number | null]> = [
    // gate.io style
    ['78,048.9', 78048.9],
    ['0.000380', 0.00038],
    ['266.38K', 266380],
    ['2.34K', 2340],
    ['999.81', 999.81],
    ['1.51K', 1510],
    // mexc style
    ['78,044.56', 78044.56],
    ['0.04988555', 0.04988555],
    ['3,893.29', 3893.29],
    ['21,605.26', 21605.26],
    // tiny prices
    ['0.000000123', 0.000000123],
    // collapsed tiny prices (gate braces, unicode subscripts)
    ['0.0{4}1234', 0.00001234],
    ['0.0₄123', 0.0000123],
    ['0.0{7}1', 0.00000001],
    ['0.0000000123', 0.0000000123],
    ['<0.00000001', 0.00000001],
    // locale variants
    ['78.048,9', 78048.9],
    ['1.234.567,89', 1234567.89],
    ['1,234,567.89', 1234567.89],
    ['0,001968', 0.001968],
    ['1,5', 1.5],
    ['1.234', 1.234],
    // suffixes / noise
    ['1.2M', 1200000],
    ['3B', 3e9],
    ['4T', 4e12],
    ['12.5万', 125000],
    ['3.2亿', 320000000],
    ['78,048.90 USDT', 78048.9],
    ['0.5BTC', 0.5],
    ['1,234.50 USDT', 1234.5],
    ['≈ $77,936.15', 77936.15],
    ['-12.34', -12.34],
    ['+0.5', 0.5],
    // non numbers
    ['', null],
    ['—', null],
    ['Total (USDT)', null],
    ['Price', null],
    [null, null],
    [undefined, null],
  ];

  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} -> ${expected}`, () => {
      const actual = parseNumber(input);
      if (expected === null) {
        expect(actual).toBeNull();
      } else {
        expect(actual).not.toBeNull();
        expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(Math.abs(expected) * 1e-9 + 1e-12);
      }
    });
  }
});

describe('formatIdr', () => {
  test('decimals option keeps trailing ,00 on full amounts', () => {
    expect(formatIdr(40000, { decimals: 2 })).toBe('40.000,00');
    expect(formatIdr(40649.58, { decimals: 2 })).toBe('40.649,58');
    expect(formatIdr(40000)).toBe('40.000');
  });

  test('compact is actually shorter for sub-rupiah values', () => {
    expect(formatIdr(0.082134, { mode: 'full' })).toBe('0,082134');
    expect(formatIdr(0.082134, { mode: 'compact' })).toBe('0,082');
    expect(formatIdr(0.0000123, { mode: 'compact' })).toBe('0,000012');
  });

  test('large values use dot thousands and no decimals', () => {
    expect(formatIdr(1248782400)).toBe('1.248.782.400');
    expect(formatIdr(474400)).toBe('474.400');
    expect(formatIdr(1500)).toBe('1.500');
  });

  test('small values keep precision instead of rounding to zero', () => {
    expect(formatIdr(0.0022755)).toBe('0,0022755');
    expect(formatIdr(0.002214)).toBe('0,002214');
    expect(formatIdr(0.016)).toBe('0,016');
    expect(formatIdr(1.5)).toBe('1,5');
    expect(formatIdr(0)).toBe('0');
  });

  test('compact units', () => {
    expect(formatIdr(474400, { mode: 'compact' })).toBe('474,4 rb');
    expect(formatIdr(1500, { mode: 'compact' })).toBe('1,5 rb');
    expect(formatIdr(4262080000, { mode: 'compact' })).toBe('4,26 M');
    expect(formatIdr(1500000000000, { mode: 'compact' })).toBe('1,5 T');
  });

  test('auto switches to compact only when the full value is long', () => {
    expect(formatIdr(1500, { mode: 'auto' })).toBe('1.500');
    expect(formatIdr(4262080000, { mode: 'auto', maxFullLength: 13 })).toBe('4.262.080.000');
    expect(formatIdr(42620800000000, { mode: 'auto', maxFullLength: 13 })).toBe('42,62 T');
  });

  test('prefix', () => {
    expect(formatIdr(1248782400, { prefix: 'Rp' })).toBe('Rp1.248.782.400');
    expect(formatIdr(0.002214, { prefix: 'Rp' })).toBe('Rp0,002214');
  });

  test('never renders exponential notation', () => {
    expect(formatIdr(1e-7)).not.toContain('e');
    expect(formatIdr(1e-7)).toBe('0,0000001');
  });
});

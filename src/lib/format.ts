/**
 * Number parsing / formatting.
 *
 * Exchanges do not agree on how numbers look, so `parseNumber` has to cope with
 * every shape we have seen in the wild:
 *
 *   78,048.9        78.048,9        1.234            (decimal)
 *   0.000380        0.000000123     0,000380         (tiny amounts / prices)
 *   0.0{4}1234      0.0₄123                         (collapsed tiny prices: gate and friends)
 *   266.38K         2.34K           1.2M   3B   4T  (suffixes)
 *   12.5万          3.2亿                            (CJK suffixes)
 *   <0.00000001     ≈ $77,936.15    -12.34           (noise)
 *   1,234,567.89    1.234.567,89                     (both separators)
 *
 * `formatIdr` always renders Indonesian style (dot thousands, comma decimals)
 * and never uses exponential notation, even for sub-cent values.
 */

const UNIT: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  b: 1e9,
  t: 1e12,
  '万': 1e4,
  '亿': 1e8,
};

const SEP_SPACE = /[\s\u00a0\u202f\u2009\u2007\u2008]/g;

const SUBSCRIPT_DIGITS: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
};

/**
 * Expand the "collapsed" notation exchanges use for sub-cent prices:
 *
 *   0.0{4}1234  ->  0.00001234
 *   0.0₄123     ->  0.0000123
 *
 * The marker counts the zeros after the decimal point; one zero is already
 * present in front of it, hence `n - 1`.
 */
function expandCollapsed(input: string): string {
  return input.replace(/\{(\d{1,3})\}|([₀-₉]+)/g, (match, braces?: string, subs?: string) => {
    const subscript = subs
      ? Number([...subs].map((char) => SUBSCRIPT_DIGITS[char] ?? '').join(''))
      : NaN;
    const count = braces ? Number(braces) : subscript;
    if (!Number.isFinite(count) || count < 1) return match;
    return '0'.repeat(Math.min(24, count - 1));
  });
}

export interface ParsedNumber {
  value: number;
  /** Smallest increment the displayed text can express (rounding granularity). */
  step: number;
}

/** Parse any exchange-formatted number. Returns null when there is no number. */
export function parseNumber(input: string | number | null | undefined): number | null {
  return parseNumberInfo(input)?.value ?? null;
}

export function parseNumberInfo(input: string | number | null | undefined): ParsedNumber | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? { value: input, step: 0 } : null;
  }
  if (input == null) return null;

  // Drop whitespace and everything that is not a digit / separator / letter /
  // CJK unit.
  let s = String(input).replace(SEP_SPACE, '');
  s = s.replace(/[^0-9.,+\-A-Za-z万亿{}₀-₉]/g, '');
  if (!s) return null;

  if (s.includes('.') && (s.includes('{') || /[₀-₉]/.test(s))) {
    s = expandCollapsed(s);
  }

  let mult = 1;
  // A unit suffix must directly follow a digit or separator - otherwise
  // "78,048.90 USDT" would be read as 78,048.90 * 1e12 ("T" for tera).
  const unitMatch = s.match(/([0-9.,])([kKmMbBtT万亿])$/);
  const unitKey = unitMatch?.[2];
  if (unitKey) {
    mult = UNIT[unitKey.toLowerCase()] ?? UNIT[unitKey] ?? 1;
    s = s.slice(0, -1);
  }

  // Drop leftover letters (currency codes such as USDT / BTC) and any stray
  // collapsed-notation markers that had no digits to attach to.
  s = s.replace(/[A-Za-z万亿{}₀-₉]/g, '');

  const negative = /^-/.test(s);
  s = s.replace(/[+\-]/g, '');
  if (!s || !/\d/.test(s)) return null;

  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;
  let norm: string;

  if (dots > 0 && commas > 0) {
    // Both separators present: the last one is the decimal separator.
    norm = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(/,/g, '.')
      : s.replace(/,/g, '');
  } else if (dots > 1) {
    norm = s.replace(/\./g, ''); // 1.234.567 -> thousands
  } else if (commas > 1) {
    norm = s.replace(/,/g, ''); // 1,234,567 -> thousands
  } else if (dots === 1) {
    // "78,048.9" style: a single dot is always a decimal point (both exchanges
    // use US formatting for prices). "1.234" therefore means 1.234, not 1234.
    norm = s;
  } else if (commas === 1) {
    const [intPart = '', fracPart = ''] = s.split(',');
    const looksLikeThousands = intPart !== '0' && /^\d{1,3}$/.test(intPart) && fracPart.length === 3;
    norm = looksLikeThousands ? intPart + fracPart : s.replace(',', '.');
  } else {
    norm = s;
  }

  const n = Number(norm);
  if (!Number.isFinite(n)) return null;

  const decimals = norm.includes('.') ? (norm.split('.')[1] ?? '').length : 0;
  const step = Math.pow(10, -decimals) * mult;

  return { value: negative ? -n * mult : n * mult, step };
}

export type IdrMode = 'full' | 'compact' | 'auto';

export interface IdrFormatOptions {
  /** Text before the number, e.g. "Rp". Defaults to "". */
  prefix?: string;
  /** full (default) | compact | auto */
  mode?: IdrMode;
  /** Compact values longer than this switch to compact units when mode=auto. */
  maxFullLength?: number;
}

const idNum = (value: number, options: Intl.NumberFormatOptions): string => {
  try {
    return value.toLocaleString('id-ID', options);
  } catch {
    return String(value);
  }
};

const COMPACT_UNITS: Array<[number, string]> = [
  [1e12, ' T'],
  [1e9, ' M'],
  [1e6, ' jt'],
  [1e3, ' rb'],
];

export function formatCompactIdr(value: number): string {
  const abs = Math.abs(value);
  for (const [divisor, suffix] of COMPACT_UNITS) {
    if (abs >= divisor) return idNum(value / divisor, { maximumFractionDigits: 2 }) + suffix;
  }
  return idNum(value, { maximumFractionDigits: 2 });
}

/**
 * Format an IDR amount.
 *
 * - >= 1        : no decimals (IDR has no cents), dot thousands
 * - < 1         : enough decimals to keep ~4 significant digits, no exponent
 * - very large  : optional compact units (rb / jt / M / T)
 */
export function formatIdr(value: number, options: IdrFormatOptions = {}): string {
  if (!Number.isFinite(value)) return '';
  const prefix = options.prefix ?? '';
  const mode = options.mode ?? 'full';
  const abs = Math.abs(value);

  if (abs === 0) return `${prefix}0`;

  if (abs < 1) {
    if (mode === 'compact') {
      // Sub-rupiah values need a real compact form too: keeping the full
      // precision here made `compact` identical to `full`, so callers had no
      // shorter option and shrank the font instead. Two significant digits.
      const decimals = Math.min(12, Math.max(2, 1 - Math.floor(Math.log10(abs))));
      return prefix + idNum(value, { maximumFractionDigits: decimals });
    }
    // Tiny values (e.g. 0.000000123 USDT * rate) must stay readable.
    const decimals = Math.min(12, Math.max(2, Math.ceil(-Math.log10(abs)) + 4));
    return prefix + idNum(value, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  }

  if (abs < 1000) return prefix + idNum(value, { maximumFractionDigits: 2 });

  const full = prefix + idNum(value, { maximumFractionDigits: 0 });
  if (mode === 'compact') return prefix + formatCompactIdr(value);
  if (mode === 'auto') {
    const limit = options.maxFullLength ?? 13;
    return full.length <= limit ? full : prefix + formatCompactIdr(value);
  }
  return full;
}

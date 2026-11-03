/**
 * End-to-end DOM test: serve the fixtures, run the built userscript in headless
 * Chromium and assert the converted output.
 *
 *   bun run test/dom.test.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const fixtures = join(root, 'test/fixtures');
const RATE = 18500;

const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const fixture = url.searchParams.get('fixture');
    if (fixture) {
      return new Response(readFileSync(join(fixtures, `${fixture}.html`)), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    // mimic /trade/BTC_USDT so the coin panel can resolve a pair
    if (path.startsWith('/trade/') || path.startsWith('/exchange/')) {
      return new Response(readFileSync(join(fixtures, 'gate.html')), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    const file = path.startsWith('/dist/') ? join(root, path) : join(fixtures, path);
    try {
      const body = readFileSync(file);
      const type = extname(file) === '.html' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8';
      return new Response(body, { headers: { 'content-type': type } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  },
});

function dumpDom(pathAndQuery) {
  const url = `http://127.0.0.1:${server.port}${pathAndQuery}`;
  const profile = mkdtempSync(join(tmpdir(), 'tc-profile-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=7000',
    '--dump-dom',
    url,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn('chromium', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (!out) reject(new Error(`chromium exited with ${code} and no output for ${url}`));
      else resolve(out);
    });
  });
}

let failures = 0;
let checks = 0;

function expectContains(html, needle, label) {
  checks += 1;
  if (html.includes(needle)) return;
  failures += 1;
  console.error(`  ✗ ${label}\n    missing: ${needle}`);
}

function expectNotContains(html, needle, label) {
  checks += 1;
  if (!html.includes(needle)) return;
  failures += 1;
  console.error(`  ✗ ${label}\n    should not contain: ${needle}`);
}

function expectCount(html, needle, expected, label) {
  checks += 1;
  const count = html.split(needle).length - 1;
  if (count === expected) return;
  failures += 1;
  console.error(`  ✗ ${label}\n    expected ${expected}× ${needle}, found ${count}`);
}

function expectMatch(html, pattern, label) {
  checks += 1;
  if (pattern.test(html)) return;
  failures += 1;
  console.error(`  ✗ ${label}\n    no match for ${pattern}`);
}

const idr = (usdt, rate = RATE) => {
  const value = usdt * rate;
  if (Math.abs(value) < 1) {
    const decimals = Math.min(12, Math.max(2, Math.ceil(-Math.log10(Math.abs(value))) + 4));
    return value.toLocaleString('id-ID', { maximumFractionDigits: decimals });
  }
  return value.toLocaleString('id-ID', { maximumFractionDigits: 0 });
};

async function main() {
  console.log('gate.com layout (divs, nested spans, K suffixes, depth bars)');
  {
    const html = await dumpDom(`/gate.html?rate=${RATE}&site=gate`);
    expectContains(html, idr(78043.6), 'bid price 78,043.6');
    expectContains(html, idr(78043.4), 'bid price 78,043.4');
    expectContains(html, idr(3790), 'total 3.79K -> IDR');
    expectContains(html, idr(12540), 'total 12.54K -> IDR');
    expectContains(html, idr(77500), 're-rendered ask price 77,500.0');
    expectContains(html, idr(77499.9), 're-rendered ask price 77,499.9');
    expectContains(html, idr(31), 're-rendered total 31.00 -> IDR');
    expectContains(html, idr(77.5), 're-rendered total 77.50 -> IDR');
    expectCount(html, 'tc-idr-price', 4, 'one badge per orderbook row');
    expectContains(html, '>20.00<', 'unrelated table left alone');
  }

  console.log('mexc.fm layout (table/tr/td, commas, market trades table)');
  {
    const html = await dumpDom(`/mexc.html?rate=${RATE}&site=mexc`);
    expectContains(html, idr(78044.56), 'ask price 78,044.56');
    expectContains(html, idr(3893.29), 'total 3,893.29 -> IDR');
    expectContains(html, idr(274.23), 'total 274.23 -> IDR');
    expectContains(html, idr(78000), 'updated bid price 78,000.00');
    expectCount(html, 'tc-idr-price', 6, 'one badge per orderbook row');
    expectContains(html, '>78,036.27<', 'market trades price untouched');
    expectContains(html, '>12:34:56<', 'market trades time untouched');
  }

  console.log('mexc.fm live markup (orderbookItem rows, trade form labels, virtualised list)');
  {
    const html = await dumpDom(`/mexc-live.html?rate=${RATE}&site=mexc`);
    expectCount(html, 'tc-idr-price', 4, 'one badge per visible row');
    expectMatch(html, /title="1\.436\.558\.670"/, 'full IDR price is kept in the tooltip');
    expectMatch(html, /title="1\.424\.500\.000"/, 'live tick updated the tooltip');
    expectMatch(html, /1,44 ?M/, 'narrow price cell degrades to compact instead of clipping');
    expectContains(html, '>1.805.600<', 'total 97.60 -> IDR (full)');
    expectContains(html, '>228,41 jt<', 'total 12,346.64 -> IDR (compact, would clip)');
    expectContains(html, '>7.122.500<', 'live tick total 385.00 -> IDR');
    expectContains(html, '>78,036.27<', 'market trades price untouched');
    expectContains(html, '>12:34:56<', 'market trades time untouched');
    expectContains(html, 'value="77700"', 'trade form inputs untouched');
    expectMatch(html, /data-tc-align="4\/4:[01]"/, 'overlay badge is aligned with every row');
    expectMatch(html, /data-tc-vol="4\/4:4"/, 'volume overlay covers every row and hides the exchange total');
  }

  console.log('gate.com live markup (hashed classes, depth bars, 4 columns, tiny brace price)');
  {
    const html = await dumpDom(`/gate-live.html?rate=${RATE}&site=gate`);
    expectCount(html, 'tc-idr-price', 6, 'one badge per row (asks + bids)');
    expectMatch(html, /title="1\.436\.560\.150"/, 'ask price tooltip');
    expectMatch(html, /title="0,22829"/, '0.0{4}1234 parses as 0.00001234');
    expectContains(html, '>2.873.050<', 'total 155.30 -> IDR');
    expectContains(html, '>28.675.000<', 'total 1.55K -> IDR');
    expectContains(html, '>228.290<', 'tiny-price total 12.34 -> IDR');
    expectContains(html, '>0.12%<', 'extra change column untouched');
    expectContains(html, '>77,650.10<', 'market trades price untouched');
    expectMatch(html, /data-tc-align="6\/6:[01]"/, 'overlay badge is aligned with every row');
    expectMatch(html, /data-tc-vol="6\/6:6"/, 'volume overlay covers every row and hides the exchange total');
    expectMatch(html, /tc-idr-volume[^>]*(#ead05a|rgb\(234,\s*208,\s*90\))/i, 'volume defaults to the same gold');
  }

  console.log('tiny prices (0.000000123) and a 4-column row');
  {
    const html = await dumpDom(`/tiny.html?rate=${RATE}&site=gate`);
    expectContains(html, idr(0.000000123), 'tiny price keeps precision');
    expectContains(html, idr(0.000000124), 'tiny price keeps precision (row 3)');
    expectContains(html, idr(1510), 'total 1.51K -> IDR');
    expectContains(html, idr(0.15), 'total 0.15 -> IDR');
    expectCount(html, 'tc-idr-price', 3, 'one badge per row');
  }

  console.log('adversarial markup (icon in header, space separators, unit suffix, nested cells)');
  {
    const html = await dumpDom(`/weird.html?rate=${RATE}&site=gate`);
    expectContains(html, idr(78048.9), 'space separated price');
    expectContains(html, idr(29.66), 'total 29.66 -> IDR');
    expectContains(html, idr(78.05), 'total 78.05 -> IDR');
    expectContains(html, idr(195120), 'total 195.12k -> IDR');
    expectCount(html, 'tc-idr-price', 3, 'one badge per row');
  }

  console.log('gate chain fees (public chains + logged-in json_svr fees)');
  {
    const html = await dumpDom(`/trade/BTC_USDT?fixture=coininfo-gate&site=gate`);
    expectContains(html, 'Rp. 712.250', 'BTC fee 0,0005 * 77000 USDT * 18500, with Rp.');
    expectContains(html, 'Rp. 284.900', 'BSC fee 0,0002 -> IDR, with Rp.');
    expectContains(html, 'D✓', 'deposit flag rendered');
    expectContains(html, 'W✗', 'disabled BSC withdrawal rendered');
    expectContains(html, 'min 0,0005 BTC', 'min withdraw in the tooltip');
    expectNotContains(html, 'Log in to load network fees', 'no login hint when the session works');
    expectContains(html, '1 USDT = Rp. 18.500', 'footer rate is shown in rupiah');
    expectMatch(html, /rgb\(234,\s*208,\s*90\)/, 'footer rate is the gold colour');

    const login = await dumpDom(`/trade/BTC_USDT?fixture=coininfo-gate&site=gate&mode=login`);
    expectContains(login, 'Log in to load network fees', 'gate shows the login hint');
    expectContains(login, 'D✓', 'chain status still rendered without fees');
  }

  console.log('mexc chain fees (same-origin currency/v3)');
  {
    const html = await dumpDom(`/exchange/BTC_USDT?fixture=coininfo-mexc&site=mexc`);
    expectContains(html, 'Rp. 712.250', 'BTC fee -> IDR, with Rp.');
    expectContains(html, 'Rp. 1.424.500.000', 'TRX fee 1 * 77000 USDT * 18500, with Rp.');
    expectContains(html, 'min 0,001 BTC', 'min withdraw in the tooltip');
    expectNotContains(html, 'Log in to load network fees', 'no login hint when the session works');

    const login = await dumpDom(`/exchange/BTC_USDT?fixture=coininfo-mexc&site=mexc&mode=login`);
    expectContains(login, 'Log in to load network fees', 'mexc shows the login hint');
  }

  console.log('coin panel host is mounted on a pair page');
  {
    const html = await dumpDom(`/trade/BTC_USDT?rate=${RATE}&site=gate`);
    expectContains(html, 'tradecat-panel-host', 'panel host element');
    expectCount(html, 'tc-idr-price', 4, 'orderbook still converted on the pair page');
  }

  console.log('GM storage is preferred over localStorage');
  {
    const html = await dumpDom('/gm.html?site=mexc');
    expectContains(html, idr(78043.6, 19000), 'rate 19000 came from GM storage');
    expectContains(html, idr(3795.99, 19000), 'total converted with the shared rate');
  }

  console.log('rate updater writes the shared storage keys');
  {
    const html = await dumpDom('/updater.html');
    expectContains(html, '"idr.rate":19123', 'idr.rate written');
    expectContains(html, '"idr.source":"indodax"', 'idr.source written');
    expectContains(html, '"idr.updatedAt"', 'idr.updatedAt written');
  }

  console.log('IDR price colour (default gold, configurable)');
  {
    const html = await dumpDom(`/gate.html?rate=${RATE}&site=gate`);
    // Chrome may serialise the colour as #ead05a or rgb(234, 208, 90)
    expectMatch(html, /tc-idr-price[^>]*(#ead05a|rgb\(234,\s*208,\s*90\))/i, 'default badge colour is the sample gold');

    const red = await dumpDom(`/gate.html?rate=${RATE}&site=gate&priceColor=%23ff0000`);
    expectMatch(red, /tc-idr-price[^>]*(#ff0000|rgb\(255,\s*0,\s*0\))/i, 'idr.priceColor override is applied');

    const inherit = await dumpDom(`/gate.html?rate=${RATE}&site=gate&priceColor=`);
    expectMatch(inherit, /tc-idr-price[^>]*color:\s*inherit/, 'empty priceColor falls back to inherit');
  }

  console.log('fallback rate (nothing in storage)');
  {
    const html = await dumpDom('/gate.html?site=gate');
    expectContains(html, idr(78043.6, 18000), 'constant fallback rate 18000 is used');
    expectCount(html, 'tc-idr-price', 4, 'badges still rendered');
  }

  server.stop(true);

  if (failures) {
    console.error(`\n${failures}/${checks} checks failed`);
    process.exit(1);
  }
  console.log(`\nall ${checks} DOM checks passed`);
}

await main();

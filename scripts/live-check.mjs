/**
 * Live check against the real exchange pages.
 *
 * Launches headless Chromium, loads the page with a normal browser UA (gate's
 * edge blocks plain HTTP clients but not a real browser), injects the built
 * userscript, then reports how many rows were found, how many have an IDR
 * badge, whether any badge is stale or misaligned, and how many Total cells
 * are still unconverted. Optionally writes a screenshot of the orderbook.
 *
 *   bun run live https://www.gate.com/trade/BTC_USDT --shot /tmp/gate.png
 *   bun run live https://www.mexc.fm/exchange/BTC_USDT --json
 *
 * This is the same CDP protocol Puppeteer uses, without the dependency.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_BUNDLE = join(import.meta.dir, '..', 'dist', 'tradecat-idr.user.js');

/** @param {string[]} argv */
function parseArgs(argv) {
  const urls = [];
  const flags = { bundle: DEFAULT_BUNDLE, shot: null, wait: 18000, settle: 6000, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--bundle') flags.bundle = argv[++i];
    else if (arg === '--shot') flags.shot = argv[++i];
    else if (arg === '--wait') flags.wait = Number(argv[++i]);
    else if (arg === '--settle') flags.settle = Number(argv[++i]);
    else if (arg.startsWith('-')) throw new Error(`unknown flag ${arg}`);
    else urls.push(arg);
  }
  return { urls, flags };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Evaluate after the userscript has been injected. */
const REPORT = `(() => {
  const rate = globalThis.TradeCat ? TradeCat.rate() : 0;
  const describe = globalThis.TradeCat ? TradeCat.describe() : null;
  const parse = (s) => Number(String(s).replace(/[^\\d.]/g, ''));
  const rows = [...document.querySelectorAll('[class*="depth-list-item"], [class*="orderbookItem"]')];
  const badges = [...document.querySelectorAll('.tc-idr-price')].filter((b) => b.isConnected);
  let covered = 0, stale = 0, unconverted = 0, maxDy = 0;

  for (const row of rows) {
    const rr = row.getBoundingClientRect();
    const centerY = rr.top + rr.height / 2;
    let badge = null, best = Infinity;
    for (const candidate of badges) {
      const br = candidate.getBoundingClientRect();
      if (br.width <= 0 || br.left < rr.left - 4 || br.left > rr.right + 4) continue;
      const dy = Math.abs(br.top + br.height / 2 - centerY);
      if (dy <= rr.height && dy < best) { best = dy; badge = candidate; }
    }
    if (!badge) continue;
    covered += 1;
    maxDy = Math.max(maxDy, Math.round(best));

    const cells = [...row.children];
    const priceCell = cells.find((c) => /price/i.test(c.className)) || cells[0];
    const price = parse((priceCell.textContent || '').replace(badge.textContent || '', ''));
    const title = Number((badge.getAttribute('title') || '').replace(/\\./g, ''));
    if (price && rate && Math.abs(title - price * rate) > Math.max(1, price * rate * 1e-4)) stale += 1;

    const totalCell = cells.find((c) => /total/i.test(c.className)) || cells[cells.length - 1];
    if (totalCell && !totalCell.querySelector('[data-tc-orig]')) unconverted += 1;
  }

  return {
    rows: rows.length,
    badges: badges.length,
    covered,
    stale,
    unconverted,
    maxDy,
    adapter: describe && describe.adapter,
    described: describe && describe.rows,
    sample: describe && describe.sample,
  };
})()`;

const AREA = `(() => {
  const badges = [...document.querySelectorAll('.tc-idr-price')].filter((b) => b.getBoundingClientRect().width > 0);
  if (!badges.length) return { x: 0, y: 0, width: 1200, height: 900 };
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const badge of badges) {
    const r = badge.getBoundingClientRect();
    left = Math.min(left, r.left); top = Math.min(top, r.top);
    right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
  }
  return {
    x: Math.max(0, Math.round(left) - 150),
    y: Math.max(0, Math.round(top) - 30),
    width: Math.min(1000, Math.round(right - left) + 300),
    height: Math.min(1000, Math.round(bottom - top) + 60),
  };
})()`;

async function openPage(url, flags) {
  const port = 9500 + Math.floor(Math.random() * 400);
  const chrome = Bun.spawn(
    [
      process.env.CHROME || 'chromium',
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'tc-live-'))}`,
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      '--lang=en-US,en',
      '--window-size=1440,1000',
      'about:blank',
    ],
    { stdout: 'ignore', stderr: 'ignore' },
  );

  const json = async (path) => (await fetch(`http://127.0.0.1:${port}${path}`)).json();
  let tabs;
  for (let i = 0; i < 60; i += 1) {
    try {
      tabs = await json('/json/list');
      break;
    } catch {
      await sleep(250);
    }
  }
  const page = tabs.find((tab) => tab.type === 'page') || tabs[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  await new Promise((resolve) => {
    ws.onopen = resolve;
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const next = ++id;
      pending.set(next, resolve);
      ws.send(JSON.stringify({ id: next, method, params }));
    });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.result?.exceptionDetails) {
      throw new Error(result.result.exceptionDetails.exception?.description || result.result.exceptionDetails.text);
    }
    return result.result?.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(flags.wait);

  const bundle = readFileSync(flags.bundle, 'utf8');
  await evaluate(`${bundle}\n;1`);
  await sleep(flags.settle);

  const report = await evaluate(REPORT);
  let screenshot = null;
  if (flags.shot) {
    const area = await evaluate(AREA);
    const capture = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: area.x, y: area.y, width: area.width, height: area.height, scale: 1 },
      captureBeyondViewport: true,
    });
    if (capture.result?.data) {
      writeFileSync(flags.shot, Buffer.from(capture.result.data, 'base64'));
      screenshot = flags.shot;
    }
  }

  const title = await evaluate('document.title');
  ws.close();
  chrome.kill();
  return { url, title, ...report, screenshot };
}

const { urls, flags } = parseArgs(process.argv.slice(2));
if (urls.length === 0) {
  console.error('usage: bun run live <url> [url...] [--shot file.png] [--json] [--bundle file]');
  process.exit(1);
}

let failed = false;
for (const url of urls) {
  try {
    const report = await openPage(url, flags);
    if (flags.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`\n${report.url}`);
      console.log(`  ${report.title}`);
      console.log(
        `  adapter=${report.adapter} rows=${report.rows} badges=${report.badges} covered=${report.covered}` +
          ` stale=${report.stale} unconverted=${report.unconverted} maxDy=${report.maxDy}px`,
      );
      if (report.sample?.length) console.log(`  sample: ${report.sample[0]}`);
      if (report.screenshot) console.log(`  screenshot: ${report.screenshot}`);
    }
    if (report.rows === 0 || report.covered === 0) failed = true;
  } catch (error) {
    failed = true;
    console.error(`\n${url}\n  FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}

process.exit(failed ? 1 : 0);

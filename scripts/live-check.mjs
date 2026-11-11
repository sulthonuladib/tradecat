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
  const flags = { bundle: DEFAULT_BUNDLE, shot: null, panelShot: null, wait: 18000, settle: 6000, json: false, samples: 1, interval: 150, evalFile: null, width: 1440, height: 1000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--bundle') flags.bundle = argv[++i];
    else if (arg === '--shot') flags.shot = argv[++i];
    else if (arg === '--panel-shot') flags.panelShot = argv[++i];
    else if (arg === '--wait') flags.wait = Number(argv[++i]);
    else if (arg === '--settle') flags.settle = Number(argv[++i]);
    else if (arg === '--samples') flags.samples = Math.max(1, Number(argv[++i]));
    else if (arg === '--interval') flags.interval = Math.max(50, Number(argv[++i]));
    else if (arg === '--eval-file') flags.evalFile = argv[++i];
    else if (arg === '--width') flags.width = Number(argv[++i]);
    else if (arg === '--height') flags.height = Number(argv[++i]);
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
  const bookHost = document.querySelector('#tradecat-book-host');
  const apiRows = bookHost && bookHost.shadowRoot ? bookHost.shadowRoot.querySelectorAll('.row').length : 0;
  const rows = apiRows ? [] : [...document.querySelectorAll('[class*="depth-list-item"], [class*="orderbookItem"], [class*="orderbook-progress"], [class*="ReactVirtualized__Grid__innerScrollContainer"] > div')];
  const badges = [...document.querySelectorAll('.tc-idr-price')].filter((b) => b.isConnected);
  const volumes = [...document.querySelectorAll('.tc-idr-volume')].filter((b) => b.isConnected && b.getBoundingClientRect().width > 0);
  let covered = 0, stale = 0, unconverted = 0, maxDy = 0, volumeRows = 0, hiddenTotals = 0;
  let minFontRatio = 1;
  const fontPx = (el) => parseFloat(getComputedStyle(el).fontSize) || 0;

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
    const cellFont = fontPx(priceCell);
    if (cellFont > 0) minFontRatio = Math.min(minFontRatio, fontPx(badge) / cellFont);
    const title = Number((badge.getAttribute('title') || '').replace(/\\./g, ''));
    if (price && rate && Math.abs(title - price * rate) > Math.max(1, price * rate * 1e-4)) stale += 1;

    // A volume badge must cover this row's total cell. The exchange's own total
    // text stays in the DOM (invisible) so it can re-render without flashing.
    const totalCell = cells.find((c) => /total/i.test(c.className)) || cells[cells.length - 1];
    const tr = totalCell ? totalCell.getBoundingClientRect() : null;
    const volumeBadge = tr && volumes.find((b) => {
      const br = b.getBoundingClientRect();
      return (
        Math.abs(br.top + br.height / 2 - (tr.top + tr.height / 2)) <= tr.height &&
        br.right >= tr.left &&
        br.left <= tr.right
      );
    });
    if (volumeBadge) volumeRows += 1;
    else unconverted += 1;

    // The exchange's total text must stay invisible via the injected CSS, even
    // while the exchange replaces the node underneath. Check the nodes that
    // actually own text, not just the cell (whose own colour may be normal).
    if (totalCell) {
      const owners = [totalCell, ...totalCell.querySelectorAll('*')].filter((el) => {
        let own = '';
        for (const node of el.childNodes) if (node.nodeType === 3) own += node.textContent || '';
        return own.trim().length > 0;
      });
      if (owners.length > 0 && owners.every((el) => getComputedStyle(el).color === 'rgba(0, 0, 0, 0)')) {
        hiddenTotals += 1;
      }
    }
  }

  const panelHosts = [...document.querySelectorAll('#tradecat-panel-host, tradecat-panel-host')];
  const panelHost = panelHosts[0] || null;
  const panelRoot = panelHost && panelHost.shadowRoot;
  const panelBody = panelRoot ? panelRoot.querySelector('.body') : null;
  const panelText = panelBody ? (panelBody.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500) : null;
  const panelChains = panelRoot ? panelRoot.querySelectorAll('.chain:not(.hint)').length : 0;
  const panelHint = panelRoot ? (panelRoot.querySelector('.chain.hint')?.textContent || null) : null;

  return {
    apiRows,
    rows: rows.length + apiRows,
    badges: badges.length,
    covered,
    stale,
    unconverted,
    maxDy,
    volumes: volumes.length,
    volumeRows,
    hiddenTotals,
    minFontRatio: Number(minFontRatio.toFixed(2)),
    adapter: describe && describe.adapter,
    described: describe && describe.rows,
    panel: panelText,
    panelChains,
    panelHint,
    panelHosts: panelHosts.length,
    tradeCat: !!globalThis.TradeCat,
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
      `--window-size=${flags.width},${flags.height}`,
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
  await send('Emulation.setDeviceMetricsOverride', { width: flags.width, height: flags.height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(flags.wait);

  const bundle = readFileSync(flags.bundle, 'utf8');
  await evaluate(`${bundle}\n;1`);
  await sleep(flags.settle);

  const samples = [];
  for (let i = 0; i < flags.samples; i += 1) {
    if (i > 0) await sleep(flags.interval);
    samples.push(await evaluate(REPORT));
  }
  const report = samples[samples.length - 1];
  report.samples = samples.length;
  report.minCovered = Math.min(...samples.map((s) => s.covered));
  report.minVolumes = Math.min(...samples.map((s) => s.volumes));
  report.maxVolumes = Math.max(...samples.map((s) => s.volumes));
  report.minHidden = Math.min(...samples.map((s) => s.hiddenTotals));
  report.minFontRatio = Math.min(...samples.map((s) => s.minFontRatio));
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

  if (flags.panelShot) {
    const rect = await evaluate(`(() => {
      const host = document.querySelector('#tradecat-panel-host');
      const panel = host && host.shadowRoot && host.shadowRoot.querySelector('.panel');
      if (!panel) return null;
      const r = panel.getBoundingClientRect();
      return { x: Math.max(0, Math.floor(r.x) - 4), y: Math.max(0, Math.floor(r.y) - 4), width: Math.ceil(r.width) + 8, height: Math.ceil(r.height) + 8 };
    })()`);
    if (rect) {
      const capture = await send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 }, captureBeyondViewport: true });
      if (capture.result?.data) {
        writeFileSync(flags.panelShot, Buffer.from(capture.result.data, 'base64'));
        report.panelShot = flags.panelShot;
      }
    }
  }

  if (flags.evalFile) {
    report.eval = await evaluate(readFileSync(flags.evalFile, 'utf8'));
  }

  const title = await evaluate('document.title');
  ws.close();
  chrome.kill();
  return { url, title, ...report, screenshot };
}

const { urls, flags } = parseArgs(process.argv.slice(2));
if (urls.length === 0) {
  console.error('usage: bun run live <url> [url...] [--shot file.png] [--panel-shot file.png] [--json] [--bundle file] [--samples N]');
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
          ` stale=${report.stale} unconverted=${report.unconverted} maxDy=${report.maxDy}px` +
          ` volumes=${report.volumes} (min ${report.minVolumes}/${report.maxVolumes}, hidden ${report.minHidden}–${report.rows}, rows ${report.volumeRows})` +
          ` font=${report.minFontRatio}em`,
      );
      if (report.sample?.length) console.log(`  sample: ${report.sample[0]}`);
      if (report.panel !== null) {
        console.log(`  panel: chains=${report.panelChains} hint=${report.panelHint ? `"${report.panelHint}"` : '-'}`);
        console.log(`  panel text: ${report.panel}`);
      }
      if (report.eval !== undefined) console.log(`  eval: ${JSON.stringify(report.eval)}`);
      if (report.screenshot) console.log(`  screenshot: ${report.screenshot}`);
    }
    if (report.rows === 0 || report.covered === 0) failed = true;
  } catch (error) {
    failed = true;
    console.error(`\n${url}\n  FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}

process.exit(failed ? 1 : 0);

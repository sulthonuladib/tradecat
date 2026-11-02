# TradeCat · IDR Orderbook (gate.com + mexc.fm)

ScriptCat userscripts that make USDT orderbooks readable in rupiah.

**Install: [INSTALL.md](INSTALL.md)**

| Feature | Where |
| --- | --- |
| IDR price appended to the right of every orderbook price | orderbook, both sides |
| `Total (USDT)` replaced with the **IDR volume** | orderbook |
| Deposit / withdraw enabled state, per chain, with chain list | floating panel |
| Quick **Deposit** / **Withdraw** buttons for the current coin | floating panel |
| USDT → IDR rate read from shared storage (a separate script can keep it fresh) | storage |

Tested layouts: gate.com (div based, `266.38K` totals, depth bars) and mexc.fm
(table based, `3,893.29` totals). Nothing in the engine depends on class names,
see [How the orderbook detection works](#how-the-orderbook-detection-works).

---

## Install (ScriptCat)

Full walkthrough: **[INSTALL.md](INSTALL.md)** — short version:

1. Install [ScriptCat](https://docs.scriptcat.org/) in your browser.
2. Install the two built scripts (click the link, ScriptCat shows the install screen):

   | Script | Install link | Purpose |
   | --- | --- | --- |
   | `TradeCat · IDR Orderbook` | [dist/tradecat-idr.user.js](https://raw.githubusercontent.com/sulthonuladib/tradecat/main/dist/tradecat-idr.user.js) | the main script |
   | `TradeCat · USDT/IDR Rate Updater` | [dist/tradecat-rate-updater.user.js](https://raw.githubusercontent.com/sulthonuladib/tradecat/main/dist/tradecat-rate-updater.user.js) | keeps the rate fresh (background + crontab, every 2h) |

   The scripts carry `@updateURL`/`@downloadURL`, so ScriptCat will offer updates
   when `dist/` changes on `main`.

3. Open <https://www.gate.com/trade/BTC_USDT> or
   <https://www.mexc.fm/exchange/BTC_USDT> and refresh once.

Both scripts declare `@storageName tradecat`, which is how they share the rate
(ScriptCat specific feature). Without the updater script the orderbook falls back
to `idr.fallbackRate` (default `18000`).

---

## Configuration

Everything is a ScriptCat **UserConfig** entry, so it shows up as a settings form
in the dashboard (**script → Settings**, or the `TradeCat: open settings` menu
command):

| Key | Default | Meaning |
| --- | --- | --- |
| `idr.fallbackRate` | `18000` | used only when no cached rate exists |
| `idr.priceFormat` | `full` | `full` = `1.407.000.000`, `compact` = `1,41 M` |
| `idr.volumeFormat` | `full` | `full`, `compact`, or `auto` (compact when long) |
| `idr.prefix` | `` (empty) | set to `Rp` if you want `Rp1.407.000.000` |
| `idr.showPrice` | `true` | show IDR next to the price |
| `idr.convertTotal` | `true` | replace `Total (USDT)` with IDR volume |
| `idr.ttlHours` | `6` | how long a cached rate counts as fresh |
| `idr.enableNetworkRate` | `false` | let the main script fetch the rate itself |
| `coin.panel` | `true` | show the deposit/withdraw panel |
| `coin.showChains` | `true` | list chains with `D✓ W✓` flags |
| `coin.position` | `bottom-left` | panel anchor (it is draggable too) |

Console helpers: `TradeCat.describe()`, `TradeCat.rescan()`, `TradeCat.rate()`,
`TradeCat.setRate(18085)`.

---

## The rate contract (promise based)

`src/lib/rate.ts` exposes:

```ts
getUsdtIdrRate(options): Promise<RateSnapshot>  // fresh cache → network → stale cache → constant
currentRate(): RateSnapshot
rateValue(): number
onRateChange(cb): () => void
saveRate(rate, source): RateSnapshot
```

Order of resolution:

1. fresh value from storage (`idr.rate` + `idr.updatedAt`, TTL = `idr.ttlHours`)
2. optional network sources (`RATE_SOURCES` in `src/lib/rate.ts`:
   Indodax → CoinGecko) — only when `idr.enableNetworkRate` is on
3. stale stored value
4. `idr.fallbackRate` / `DEFAULT_USDT_IDR`

Storage keys (GM storage, mirrored to `localStorage` as `tradecat:<key>`):

| Key | Type | Example |
| --- | --- | --- |
| `idr.rate` | number | `18085` |
| `idr.updatedAt` | number (epoch ms) | `1793556263000` |
| `idr.source` | string | `indodax` |

So writing your own updater is a three-liner — anything that sets those keys
works (another userscript, a cron job + a tiny page script, or the console):

```js
localStorage.setItem('tradecat:idr.rate', JSON.stringify(18085));
localStorage.setItem('tradecat:idr.updatedAt', JSON.stringify(Date.now()));
localStorage.setItem('tradecat:idr.source', JSON.stringify('my-source'));
```

The main script re-reads storage every 30s and on `storage` events, then
re-renders the orderbook — no page reload needed.

---

## How the orderbook detection works

Exchange DOM changes constantly, so the engine (`src/lib/orderbook.ts`) never
looks at class names:

1. find the `Price (USDT)` header (matched on **text nodes**, so sort arrows and
   icons next to it do not matter),
2. climb the ancestors until an element contains at least two rows,
3. inside that element, find numeric leaves (short text nodes) where

   ```
   price * amount ≈ total     (tolerance = 2%, or the display rounding step)
   ```

4. append a `span.tc-idr-price` after the price leaf and write the IDR value
   into the total leaf.

The `price * amount ≈ total` rule is what keeps it from touching the
open-orders table, trade history or the buy/sell ratio bar. Tolerance is derived
from the displayed precision, which is why fee columns and `1.51K` style totals
cannot be matched by accident.

It re-applies on a 700 ms heartbeat plus a throttled `MutationObserver`, so live
price flashes, SPA re-renders and pair switches keep working.

**If a row stops converting**, run `TradeCat.describe()` in the console:

```json
{ "header": "Price (USDT)", "container": "div.ob", "rows": 40, "sample": [...] }
```

`rows: 0` means the layout changed in a way the rule does not recognise — in that
case copy one orderbook row element (DevTools → right click the row → *Copy →
Copy element*) and the rule can be extended.

---

## Development

```bash
bun run build      # bundle src/ → dist/*.user.js (metadata block is prepended)
bun run watch      # rebuild on change
bun test           # unit tests (parsing / formatting)
bun run test:dom   # headless Chromium end-to-end tests against fixtures
bun run check      # tsc --noEmit
```

Layout:

```
src/
  main.ts                 entry: config, menu commands, SPA navigation, wiring
  rate-updater.ts         entry: background/crontab rate refresher
  meta/*.meta.txt         ==UserScript== + ==UserConfig== blocks (prepended at build)
  lib/format.ts           parse/format exchange numbers (incl. tiny prices)
  lib/rate.ts             rate promise + shared storage contract
  lib/store.ts            GM storage / localStorage / GM_xmlhttpRequest
  lib/orderbook.ts        layout agnostic orderbook engine
  lib/coininfo.ts         deposit/withdraw per coin + chain
  lib/panel.ts            shadow-DOM panel (chains + Deposit/Withdraw buttons)
  lib/site.ts             site detection, pair parsing, deposit/withdraw URLs
test/
  format.test.ts          bun:test unit tests
  dom.test.mjs            serves fixtures, runs the built script in Chromium
  fixtures/*.html         gate-like, mexc-like, tiny-price, adversarial, GM-stub pages
```

The DOM tests are the useful part: they assert exact converted strings for
different markup shapes (divs, tables, nested cells, headers with icons),
`0.000000123`-style prices, `K` suffixes, re-renders, GM storage and the rate
updater — all without touching the real exchanges.

For a fast edit loop on the real site, use the ScriptCat **VSCode extension**
(`scriptcat-vscode`): enable *Auto-connect to VSCode service* in the ScriptCat
dashboard → *Tools → Developer tools*, then run `scriptcat.autoTarget` in VSCode
so every save of a `*.user.js` file is pushed to the browser instantly. Point it
at `dist/tradecat-idr.user.js` (or run `bun run watch` and let it sync the dist
file).

---

## Known limitations

- Only USDT-quoted pairs are converted (the header must read `Price (USDT)`).
- Rows must satisfy `price * amount ≈ total`. An exchange that displays a
  *cumulative* total instead would need an extra rule.
- MEXC's asset endpoints are behind bot protection from some networks; when they
  fail the panel shows `MEXC asset API unavailable · retry` and the Deposit /
  Withdraw buttons keep working.
- Deposit / withdraw URLs use the current origin:
  gate `/myaccount/{deposit,withdraw}/<COIN>`,
  mexc `/assets/{deposit,withdraw}/<COIN>`.

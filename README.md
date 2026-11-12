# TradeCat · IDR Orderbook

**See every crypto orderbook in rupiah.** TradeCat adds the IDR price beside each
price, turns the Total column into IDR volume, and shows each coin's deposit and
withdraw networks, limits and fees in a small panel.

Two ScriptCat userscripts: the orderbook script and a rate updater that keeps
the shared USDT → IDR rate fresh.

**Works on:** [gate.com](https://www.gate.com/trade/BTC_USDT) ·
[MEXC](https://www.mexc.fm/exchange/BTC_USDT) ·
[Binance](https://www.binance.com/en/trade/BTC_USDT) ·
[KuCoin](https://www.kucoin.com/trade/BTC-USDT) ·
[Bybit](https://www.bybit.com/en/trade/spot/BTC/USDT) ·
[Indodax](https://indodax.com/market/BTCIDR)

**Install:** [INSTALL.md](INSTALL.md) · two scripts, about a minute.

## What you get

- **IDR prices** beside the orderbook price on both sides, with full or compact
  formatting so the number fits inside the row.
- **IDR totals.** The Total column is replaced with the rupiah value; Binance's
  Amount/Cumulative setting is followed too.
- **Deposit / withdraw panel** for the current coin: chain status (`D✓ W✓`),
  min/max, withdrawal fee in coin **and rupiah**, plus Deposit/Withdraw buttons.
- **Bybit's canvas book** gets a converted IDR orderbook fed by Bybit's own
  depth worker and styled like the native panel. It docks between the chart and
  the orderbook (the chart makes room), drags like a normal panel, and snaps
  back with its dock button.
- **Indodax**, already priced in rupiah, gets a compact card with the last
  price, **1% margin**, network and withdrawal fee — each on its own row.
- **One rate, two scripts.** The updater refreshes USDT/IDR every 15 minutes;
  the orderbook reads it from shared storage, no reload needed.

Tested against live layouts of all six exchanges. Nothing depends on hashed
class names: the engine finds the rows and re-checks `price × amount ≈ total`
(or maps columns positionally where an exchange wants that), so a redesign is a
rescan, not a rewrite. See [How the orderbook detection works](#how-the-orderbook-detection-works).

---

## Install (ScriptCat)

Full walkthrough: **[INSTALL.md](INSTALL.md)** — short version:

1. Install [ScriptCat](https://docs.scriptcat.org/) in your browser.
2. Install the two built scripts (click the link, ScriptCat shows the install screen):

   | Script | Install link | Purpose |
   | --- | --- | --- |
   | `TradeCat · IDR Orderbook` | [dist/tradecat-idr.user.js](https://raw.githubusercontent.com/sulthonuladib/tradecat/main/dist/tradecat-idr.user.js) | the main script |
   | `TradeCat · USDT/IDR Rate Updater` | [dist/tradecat-rate-updater.user.js](https://raw.githubusercontent.com/sulthonuladib/tradecat/main/dist/tradecat-rate-updater.user.js) | keeps the rate fresh (background + crontab, every 15 min) |

   The scripts carry `@updateURL`/`@downloadURL`, so ScriptCat will offer updates
   when `dist/` changes on `main`.

3. Open a trade page, e.g. <https://www.gate.com/trade/BTC_USDT>,
   <https://www.binance.com/en/trade/BTC_USDT>,
   <https://www.kucoin.com/trade/BTC-USDT>,
   <https://www.bybit.com/en/trade/spot/BTC/USDT> or
   <https://indodax.com/market/BTCIDR>, and refresh once.

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
| `idr.priceColor` | `#ead05a` | colour of the IDR price badge (empty = inherit the row's red/green) |
| `idr.volumeColor` | `#ead05a` | colour of the converted Total column (empty = inherit) |
| `idr.fit` | `true` | degrade to compact (`1,44 M`) instead of clipping when the cell is too narrow |
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

## Where the deposit / withdraw data comes from

gate hides fees behind a **logged-in, same-origin** endpoint; the other
exchanges expose more or less of the same data publicly:

| Exchange | Endpoint | Gives |
| --- | --- | --- |
| gate | `GET /wallet/currency_chains?currency=COIN` (public) | chain list, deposit/withdraw flags, min withdraw |
| gate | `POST /json_svr/query?u=116` (`type=getWithdrawChainsInfo`, `Csrftoken`) | per-chain `withdraw_txfee`, `rate_usdt` |
| MEXC | `GET /api/platform/asset/api/asset/spot/currency/v3?currency=COIN` | `data.chains[]` (`chainName`, `enableDeposit`, `enableWithdraw`, `withdrawFee`, `withdrawMin`), `data.currencyPrice` |
| Binance | `GET /bapi/capital/v1/public/capital/getNetworkCoinAll` (public) | `data[].networkList[]` (`network`, `depositEnable`, `withdrawEnable`, `withdrawFee`, `withdrawMin`, `withdrawMax`) |
| KuCoin | `GET /api/v3/currencies/COIN` (public) | `data.chains[]` (`chainName`, `isDepositEnabled`, `isWithdrawEnabled`, `withdrawMinFee`, `withdrawMinSize`) |
| Bybit | `GET api2 /v3/private/cht/asset-common/coin-config` (session) | `result.rows[].chains[]` (`chain`, `chainDeposit`, `chainWithdraw`, `withdrawFee`, `withdrawMin`, `withdrawMax`) |

Binance returns every coin in one payload, so the script keeps one copy for ten
minutes instead of re-downloading it per coin. Bybit's endpoint is session
backed, so a logged-out tab shows `Log in to load network fees` while the
orderbook panel keeps working. Prices for the fee conversion come from the
public tickers (`api.binance.com`, `api.kucoin.com`, `api.bybit.com`).

Indodax is handled outside this table: its `/finance/<COIN>` page (login only)
provides `#withdraw_fee_value` and `#withdraw_network`, exactly like the
reference script; the price and lowest ask come from
`https://indodax.com/api/ticker/<pair>`.

The fee is shown as `fee 0,0005 BTC ≈ Rp. 712.250`
(`fee × priceUsdt × USDT/IDR rate`). The panel footer shows the rate itself as
gold `1 USDT = Rp. 18.500`. If the fee endpoint needs a login, the panel
still lists networks and status and says so; the chips go neutral instead of
claiming green. Results are cached for 10 minutes under `coininfo.v2.*`.

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
   Indodax `usdtidr` → CoinGecko) — only when `idr.enableNetworkRate` is on
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

Locating rows is per exchange (`src/lib/exchanges/`); rendering, rate changes and
re-renders are handled once by the engine (`src/lib/orderbook.ts`):

| Adapter | Anchor |
| --- | --- |
| gate | gate hints first (`#market-list…`, `*entrust*`, `*trade-grid*`, `*orderbook*`), then structure |
| mexc | `*orderbookItem*` rows, then `*asks*` / `*bids*` boxes, then structure |
| binance | `.row-content` rows (mapped by column so the product test is not required), then structure; follows `trd-orderbook-visual` (Amount/Cumulative) |
| kucoin | virtualised grid rows, mapped by column position (its Total column is cumulative, so the product check does not apply) |
| bybit | no DOM rows (canvas): `Worker.prototype.onmessage` is wrapped at document-start, the `spot.ob_` depth frames drive `lib/bybit.ts`, and the panel is anchored left of the native book |
| generic | structure only |

The structural rule needs no class names:

1. a row is a child of a repeated sibling group, and each row holds 2-8 visible
   numbers,
2. `price × amount ≈ total` holds for one ordered triple in that row
   (tolerance = 2%, or the display rounding step),
3. at least two children of the parent agree on the same column layout, and at
   least 60% of the parent's children are row-like.

When an exchange offers a cumulative depth mode, the adapter marks each row with
`cumulative = { group, index }` (index 0 = best price). The engine then sums the
per-row totals along that group instead of showing each row's own total.
Binance's switch (`Order Book Display → Book Depth Visualization`) stores
`trd-orderbook-visual = "amount" | "cumulative"` in localStorage and the
Binance adapter reads it on every rescan, so toggling the exchange setting
updates the IDR totals without a reload.

The product check keeps the open-orders table, trade history and the buy/sell
ratio bar out. Row-density and row-containment checks stop a two-row side panel
from being mistaken for a two-row table. Rows with an extra numeric column
(change %, fee) still map correctly because the tightest column span wins and
the mapping has to agree across the whole list.

The IDR price is drawn in an **overlay layer** (`.tc-idr-layer`) anchored to the
row list, not injected into the exchange's cells. Exchanges re-render cells
constantly (React replaces text nodes and wipes unknown children; MEXC does it on
every tick), so anything inside a cell disappears immediately. The reference
scripts solved this by absolutely positioning a column of gold numbers; this
does the same, but computes the position from each row's live geometry
(`getBoundingClientRect`) instead of hardcoded pixel margins, so it adapts to any
panel width, row height or scroll position.

The badge starts immediately after the price text (never right-aligned inside
the cell, which could reach back over the USDT number) and the text is chosen
from the real gap before the amount: full IDR, then compact at the **same font
size** (`1,41 M`), then a tight compact. Full IDR keeps the price-style
precision: every digit below 1 (`0,08698`), three decimals from 1 to 9
(`4,334`), two decimals above (`21,40`, `40.649,58`), trailing zeros included.
The full IDR value always stays in the `title` tooltip, and `idr.fit` turns the
degradation off. Very narrow price cells fall back to the empty left side of the
right-aligned amount column.

The Total (USDT) leaf is rewritten in place, since the exchange owns that text
and the engine re-applies it right after a re-render.

It re-applies on a 500 ms heartbeat plus a document-level `MutationObserver`
(60 ms debounce), and repositions the overlay on scroll and resize. Cheap
locators (MEXC selectors) refresh every tick; structural scans are throttled
(gate ~0.5 s, generic ~0.8 s). Rows are re-mapped positionally each tick, so a
row caught mid-animation or recycled by a virtual list neither loses its badge
nor keeps a stale one.

Sub-cent prices written in collapsed notation (`0.0{4}1234`, `0.0₄123`) are
expanded before conversion, which gate uses for coins like SHIB.

**If a row stops converting**, run `TradeCat.describe()` in the console:

```json
{ "adapter": "mexc", "rows": 40, "sample": ["77,651.82 × 0.00125724 = 97.60"] }
```

`rows: 0` means the layout changed in a way the rule does not recognise — copy
one orderbook row element (DevTools → right click the row → *Copy → Copy
element*) and the adapter can be taught the new shape.

---

## Releasing & updates

ScriptCat updates work like this (see the [metadata docs](https://docs.scriptcat.org/en/docs/dev/meta/)):

- it fetches `@updateURL` and compares the `@version` in that file's metadata
  block with the installed version;
- **`@updateURL` only works when `@downloadURL` is also set** — both are
  configured in this repo and point at the raw `dist/` files on `main`;
- a newer `@version` makes ScriptCat show an update prompt (or update silently,
  depending on the dashboard setting).

So the release procedure is: bump → build → commit → push.

```bash
bun run bump 0.2.1     # updates both @version blocks + package.json, then builds
# add a CHANGELOG.md entry, then:
git add -A && git commit -m "Release 0.2.1" && git push
```

Notes:

- The **version must change**, otherwise nothing is offered even though `dist/`
  changed. This is why `bun run bump` exists — it is easy to forget.
- The check happens against the remote metadata, so `dist/` has to be committed
  (it is) for a GitHub install to ever see an update.
- Local installs (**Import from file**) do not auto-update — re-import the file,
  or install from the raw URL instead.
- Manual check: ScriptCat dashboard → script → **Check update**; the auto-check
  interval lives in the extension settings.
- Both scripts are versioned in lockstep, so an update prompt for the rate
  updater appears at the same time as the main script.

## Development

```bash
bun install        # TypeScript + Bun types (dev only)
bun run build      # bundle src/ → dist/*.user.js (metadata block is prepended)
bun run watch      # rebuild on change
bun test           # unit tests (parsing / formatting)
bun run test:dom   # headless Chromium end-to-end tests against fixtures
bun run check      # tsc: src project + tooling project, both strict
bun run live https://www.gate.com/trade/BTC_USDT   # real page, real DOM
bun run live https://www.mexc.fm/exchange/BTC_USDT --shot /tmp/mexc.png
bun run live https://www.binance.com/en/trade/BTC_USDT
bun run live https://www.bybit.com/en/trade/spot/BTC/USDT --start   # worker hook needs document-start
bun run live https://indodax.com/market/BTCIDR
```

`bun run live` launches headless Chromium (same CDP protocol Puppeteer uses, no
dependency), opens the page with a normal browser UA, injects `dist/` (`--start`
injects before page scripts, like `@run-at document-start`), and prints
rows / badges / covered / stale / unconverted / alignment. Gate's edge blocks
plain HTTP clients but not a real browser, so this is the reliable way to check a
layout change against the real exchange.

Two TypeScript projects: `tsconfig.json` compiles the userscript sources against
`DOM` only (no Bun/Node globals can leak in), `tsconfig.tools.json` compiles
`build.ts`, `scripts/` and the tests with Bun types. `tsconfig.base.json` holds
the shared strict flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax`, unused-locals errors, …).

Layout:

```
src/
  main.ts                 entry: config, menu commands, SPA navigation, wiring
  rate-updater.ts         entry: background/crontab rate refresher
  meta/*.meta.txt         ==UserScript== + ==UserConfig== blocks (prepended at build)
  lib/format.ts           parse/format exchange numbers (incl. tiny prices)
  lib/rate.ts             rate promise + shared storage contract
  lib/store.ts            GM storage / localStorage / GM_xmlhttpRequest
  lib/orderbook.ts        engine: render, fit, heartbeat, observers, debug
  lib/detect.ts           structural row detection (price × amount ≈ total)
  lib/dom.ts              injected-text filtering, leaf walking, cell lookup
  lib/exchanges/          gate / mexc / binance / kucoin / generic row locators
  lib/coininfo.ts         deposit/withdraw per coin + chain (all exchanges)
  lib/panel.ts            shadow-DOM panel (chains + Deposit/Withdraw buttons)
  lib/bybit.ts            Worker-hooked converted orderbook (Bybit canvas)
  lib/simple.ts           Indodax fee + 1% margin panel
  lib/site.ts             site detection, pair parsing, deposit/withdraw URLs
scripts/
  bump.ts                 version bump across metadata + package.json
  live-check.mjs          real-page check over CDP (bun run live)
test/
  format.test.ts          bun:test unit tests
  dom.test.mjs            serves fixtures, runs the built script in Chromium
  fixtures/*.html         gate/mexc live markup, tiny-price, adversarial, GM-stub pages
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

- Only USDT-quoted pairs are converted (the header must read `Price (USDT)`);
  Indodax pairs are quoted in rupiah and only get the fee/margin panel.
- Rows must satisfy `price * amount ≈ total`, except where an adapter maps
  columns positionally. KuCoin's Total column is a cumulative amount, so its
  adapter derives the row value from `price × amount`; Binance is mapped by
  position too, because its Cumulative display mode changes the depth bars (and
  the expected IDR totals) without changing the Total cells.
- Bybit draws its spot orderbook on a `<canvas>`, so there are no cells to
  overlay. `lib/bybit.ts` wraps `Worker.prototype.onmessage` at document-start
  to capture Bybit's own `spot.ob_` frames (same trick as the reference
  `Bybit Price Interceptor`) and renders a twin of the native panel: same 316px
  width, tab header with the orange underline, 24px rows, red ask / green bid
  prices, white qty/total, matching depth bars, and a mid-price row with the
  native direction arrow. It docks between the chart and the orderbook by
  narrowing the chart, can be dragged anywhere (position is remembered), and
  the dock button snaps it back. Rows are dynamic (5–24 per side, 10 at the
  default height). If no worker frame arrives, it falls back to the public
  `/v5/market/orderbook` every 3 s.
- Indodax's finance page needs a login; logged out, the panel says so and only
  the price/1% margin are shown.
- MEXC's asset endpoints are behind bot protection from some networks; when they
  fail the panel shows `MEXC asset API unavailable · retry` and the Deposit /
  Withdraw buttons keep working.
- Deposit / withdraw URLs use the current origin (Binance/KuCoin/Bybit land on
  their generic wallet pages, since the coin is chosen inside the app):
  gate `/myaccount/{deposit,withdraw}/<COIN>`,
  mexc `/assets/{deposit,withdraw}/<COIN>`.

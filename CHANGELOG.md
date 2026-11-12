# Changelog

Versions are the `@version` in the userscript metadata blocks. ScriptCat only
offers an update when this number changes, so every released change bumps it.

## 0.4.3

- **Bybit panel now mirrors the native orderbook.** 316px wide, tab header with
  the orange underline, 24px rows, red ask / green bid prices, white qty/total,
  depth bars at the native opacity, column header with a sort arrow, and a
  mid-price row with Bybit's own direction arrow and `≈ ... USDT` text.
- **Docked between the chart and the native orderbook.** The chart is narrowed
  to make room, so nothing overlaps; at narrow widths it falls back to the
  right of the book or a bottom-right float.
- **Draggable and dockable.** Drag the header to move it (position stored in
  `ui.bybit.pos`); the dock button restores the three-column layout. Row count
  follows the panel height (5–24 per side, 10 by default).
- Worker interception is unchanged: the `spot.ob_` frames from Bybit's own
  worker drive the panel, with the REST orderbook only as a fallback.
- `bun run live` counts only visible rows in the converted panel.
- Tests: 65 unit + 77 DOM.

## 0.4.2

- **Cumulative orderbook mode.** Adapters can mark rows with
  `cumulative = { group, index }` (index 0 = best price); the engine sums the
  per-row totals in that order when the exchange is in a cumulative depth mode.
- **Binance follows its own setting.** `Order Book Display → Book Depth
  Visualization` writes `trd-orderbook-visual = "amount" | "cumulative"` to
  localStorage. The adapter reads it on every rescan: in Amount mode Total is
  the row's own IDR value, in Cumulative mode the totals are summed from the
  best price outward. No reload needed.
- Binance rows are now mapped by column position (`.row-content`), so the
  product check is not required and both modes convert reliably.
- `bun run live --init-file <js>` seeds localStorage before page scripts, used
  to verify the cumulative mode.
- Tests: 65 unit + 77 DOM.

## 0.4.1

- **Binance overlay no longer hides price and amount.** Binance wraps each row
  cell in `.row-content` inside `.progress-container` / `.orderbook-progress`.
  Using the outer shell as the row made every cell lookup climb back to the
  wrapper, so the "Total" marker was put on the whole row and the
  `color: transparent` rule hid price, amount and total at once. Rows are now
  `.row-content`, which keeps USDT price/amount visible, appends the IDR price
  in the real gap (compact when needed) and replaces only the Total cell.
- **Bybit: converted orderbook instead of the REST panel.** Bybit's book is a
  canvas, so `lib/bybit.ts` wraps `Worker.prototype.onmessage` at
  document-start and consumes Bybit's own `spot.ob_` frames (same approach as
  the reference `Bybit Price Interceptor`). The panel mirrors the
  `Updated Bybit Orderbook Experiment`: 8 asks + 8 bids, Price (IDR), Qty (IDR),
  Total (IDR), depth bars, a mid-price row, and it is anchored to the left side
  of the native orderbook (it follows the book when the grid is resized).
  The public REST orderbook is only a fallback when no worker frame arrives.
- `bun run live --start` injects the bundle before page scripts, so the worker
  hook can be tested like a real `@run-at document-start` install.
- Tests: 65 unit + 77 DOM.

## 0.4.0

- **Binance, KuCoin and Bybit support**, alongside gate and MEXC:
  - Binance: rows are `.orderbook-progress` elements; the IDR overlay converts
    both sides (34 rows in the live check).
  - KuCoin: virtualised rows are mapped by column position. Its Total column is
    a cumulative base amount, so the adapter derives the row value from
    `price × amount` instead of the product test used everywhere else.
  - Bybit: the spot orderbook is drawn on a `<canvas>`, so there are no cells to
    overlay. A compact panel (`lib/minibook.ts`) renders the public
    `/v5/market/orderbook` instead: 10 levels per side, IDR price and cumulative
    IDR total, refreshed every 3 s.
- **Deposit / withdraw panel for the new exchanges**:
  - Binance: public `getNetworkCoinAll` (cached 10 min, per-chain flags/fees).
  - KuCoin: public `api/v3/currencies/COIN` (per-chain flags/fees).
  - Bybit: session-backed `asset-common/coin-config`; logged out it degrades to
    "Log in to load network fees" like gate.
  - Prices for the fee conversion come from the public tickers.
- **Indodax: simple mode.** Its prices are already rupiah, so the orderbook
  conversion and the deposit panel are skipped. A compact panel shows the last
  price, the **1% margin** and the **withdrawal fee** (network + fee in coin ≈
  rupiah), read from `/finance/<COIN>` (login) and the public ticker API.
- Site detection and pair parsing now cover `/market/BTCIDR`,
  `/trade/BTCIDR/index.html` and Bybit's `/trade/spot/BTC/USDT`.
- Tests: 65 unit + 77 DOM; `bun run live` understands the new row layouts and
  the API book (`apiRows`).

## 0.3.10

- **Full IDR price precision** (`precision: 'price'`): below 1 keeps every digit
  (`0,08698`), 1–9 keeps three decimals (`4,334`, `1,000`), 10+ keeps two
  (`21,40`, `40.649,58`, `18.023,04`). Trailing zeros are kept. Compact output is
  unchanged. The tooltip keeps the plain full value without forced decimals.
- **Volume is gold by default**, matching the price badge
  (`idr.volumeColor` default `#ead05a`; empty still means inherit).
- Verified no overlap after the wider numbers: gate ETH/USDC/PEPE and MEXC BTC
  keep `maxOverlap -4px`, positive amount gaps, `font=1em`.
- Tests: 54 unit + 77 DOM.

## 0.3.9

- **Updater metadata: only `@crontab`, no `@background`.** `@crontab` already
  declares a scheduled background script; adding `@background` made ScriptCat
  treat it as a continuously-running background script, which conflicts with the
  "run every 15 minutes, then finish" lifecycle (and with the ▶ button). One
  directive is enough.

## 0.3.8

- **Rate updater now follows ScriptCat's background-script contract.** A
  background/crontab script must return a Promise that settles when the work is
  done; the updater used a fire-and-forget async IIFE, so ScriptCat marked the
  run as finished immediately. The dashboard sat at "Stopped" and the play
  button appeared to do nothing while the fetch was still in flight.
  The updater now returns that Promise and rejects when no rate source answers,
  so the run shows "Running" until the request completes, the last-run time
  updates, and failures are visible in the run log (next cron retries in 15 min).
- Reminder: a `@crontab` script is *supposed* to sit at "Stopped" between runs;
  the run-status column shows the next scheduled time on hover.
- Tests unchanged (53 unit + 76 DOM); the updater fixture still verifies the
  storage keys.

## 0.3.7

- **IDR price now starts immediately after the USDT price.** Right-aligning the
  badge inside the price cell meant a long IDR number could reach back over the
  USDT price (BTC/ETH/PEPE, especially in a narrower panel). The badge is now
  left-anchored at `price text right + 4px`, so overlap with the price is
  impossible regardless of the number's width or the panel layout.
- The text tier is chosen from the real gap between the price text and the
  (right-aligned) amount text: `,00` full -> full -> compact -> tight. When the
  gap is small the badge picks compact instead of spilling over the amount.
- Verified with the real pages at 1024, 1440 and 1920 px: gate BTC/ETH/PEPE and
  MEXC BTC all report `maxOverlap -4px` (the intended 4 px gap) and a positive
  amount gap, `font=1em`.
- `bun run live --width W --height H` makes layout checks reproducible.

## 0.3.6

- **No more IDR/USDT overlap on high-priced coins (ETH, BTC, …).** The fit check
  used canvas `measureText`, which ignores `font-variant-numeric: tabular-nums`
  and underestimated the exchange's numbers, so "full" looked like it fit. Text
  widths now come from a DOM `Range` over the actual text nodes (cached per
  text), with a 4 px safety margin.
- **Badges are anchored by their right edge** (`transform: translateX(-100%)`)
  instead of their left edge, so a rendered width that differs slightly from the
  measurement can only grow into free space, never over the USDT price. The
  right edge sits 4 px before the right-aligned amount text.
  Live: gate ETH/BTC/USDC/PEPE and MEXC ETH/BTC all report a negative overlap
  (min 9 px gap) and a positive amount gap (≥4 px).
- **IDR price shows `,00` when it fits**: a two-decimal tier is tried first
  (`40.649.580,00`), then the integer form (`40.649.580`), then compact
  (`1,39 M`). Font size stays at the price cell's size in every case.
- `formatIdr` gained a `decimals` option for forcing trailing digits.
- Tests: 53 unit + 76 DOM.

## 0.3.5

- **IDR price is now exactly the price cell's font size.** The overlay badge used
  `em`, which resolved against the row list (11px) instead of the price cell
  (12px), and cell metrics were cached forever - sometimes with a 10.2px font
  captured during gate's first render. The badge is now sized in px from a
  refreshed cell measurement (1.5s TTL).
- **Sub-rupiah values get a real compact form.** `formatIdr(..., {mode:'compact'})`
  returned the same string as `full` for values below 1, so the fit logic had no
  shorter option and fell back to 0.85em on pairs like `0.0{5}4684`. Compact now
  keeps two significant digits (`0,082134` -> `0,082`), so the badge stays at
  1em; measured `font=1.00em` on gate SHIB and MEXC SHIB.
- **Panel footer rate**: `1 USDT = Rp. 18.500` at 12px gold instead of 10px grey.
- **Withdrawal fees use the rupiah prefix**: `fee 0,0005 BTC ≈ Rp. 712.250`.
- Tests: 52 unit + 76 DOM (footer rate text/colour, Rp.-prefixed fees, compact
  sub-rupiah formatting).

## 0.3.4

- Metadata: `@author` is `sulthonuladib` instead of the `tradecat` placeholder
  (both userscripts), and `package.json` carries the same author. No behaviour
  change; the version bump is only so ScriptCat offers the metadata update.

## 0.3.3

- **Gate volume blink is gone.** Hiding the exchange's Total text with an inline
  `color: transparent` was lost every time gate replaced that node, so the old
  USDT value flashed back between ticks. The hide is now injected CSS keyed to
  the cell and to the list host:
  `[data-tc-total]`, `[data-tc-host] [class*="totalText"]` (gate) and
  `[data-tc-host] [class*="__amount"] span` (MEXC). CSS applies to whatever node
  React renders next, so a re-render cannot expose the old number; the depth bar
  keeps its background because only text colour is cleared, not the element.
- `data-tc-total` and `data-tc-host` are removed when a row loses its volume
  overlay, and the style tag is removed on `stop()`, so disabling the script
  restores the exchange's own totals.
- Live measurement: gate 20/20 rows had the exchange total hidden across 50
  samples at 60 ms, MEXC 18/18, both with 0 stale badges.
- `bun run live` now reports `hidden` totals and min/max volume coverage.

## 0.3.2

- **MEXC deposit/withdraw data actually works now.** The panel was calling a
  signed API (`/api/v3/capital/config/getall`) and a `.com` URL that always
  failed. It now uses the same-origin, session-authenticated endpoint from the
  reference scripts:
  `/api/platform/asset/api/asset/spot/currency/v3?currency=COIN`
  (`data.chains[].chainName / enableDeposit / enableWithdraw / withdrawFee /
  withdrawMin`, plus `data.currencyPrice`).
- **Gate earns fees too.** Chain status/minimum come from the public
  `wallet/currency_chains`; per-chain `withdraw_txfee` and `rate_usdt` come from
  the session `POST /json_svr/query?u=116` (`Csrftoken` header), merged by chain.
- **Panel shows the withdrawal fee in coin units and rupiah**
  (`fee 0,0005 BTC ≈ 712.250`), with min/max withdrawal in the row tooltip.
  Fees need a login; without one the panel still lists networks and status and
  shows a "Log in to load network fees" hint (chips become unknown instead of a
  false green). New cache namespace `coininfo.v2`.
- **No more blinking volume column.** The exchange's Total text is kept in the
  DOM but made transparent, and the IDR volume is drawn in the same overlay
  layer as the price, so React/gate can re-render underneath without flashing.
  `bun run live --samples 20` reports stable coverage (gate 20/20, MEXC 18/18).
- Tests: 51 unit + 72 DOM checks, including real-shaped gate/MEXC chain payloads,
  fee→IDR conversion, login-required hints and overlay alignment.

## 0.3.1

- **Reference-style overlay rendering.** The IDR price is no longer injected
  inside the exchange's price cell - React/gate/MEXC replace those cells on every
  tick and wipe unknown children, which made the badge flicker or disappear. It
  now lives in a `.tc-idr-layer` anchored to the row list, positioned from each
  row's live geometry (no hardcoded margins), and is repositioned on scroll and
  resize. Verified on live gate and MEXC: 20/20 and 18/18 rows covered, 0 stale,
  0 unconverted totals, ≤1 px vertical drift.
- **Readable numbers instead of tiny ones.** When the full IDR value does not fit
  beside the price, the badge uses compact text at the same font size (`1,41 M`)
  and only shrinks as a last resort. Very narrow price cells fall back to the
  free left side of the right-aligned amount column. Full value stays in the
  `title` tooltip.
- **Re-render hardening.** Rows are re-mapped from the live DOM each tick
  (`refreshRow`), known rows stay sticky while connected, rows whose numbers are
  mid-animation are mapped positionally, and a document-level mutation observer
  (60 ms debounce) replaces the old container observer that went silent when the
  exchange swapped the list container.
- `bun run live <url>` (`scripts/live-check.mjs`): headless Chromium over CDP,
  injects `dist/`, reports rows/badges/stale/unconverted/alignment and optionally
  saves a screenshot. Used against the real gate and MEXC pages.
- Tests: 45 unit + 59 DOM checks, including overlay alignment probes in the
  live-markup fixtures.

## 0.3.0

- **Orderbook detection is now per exchange** (`src/lib/exchanges/`): gate, mexc
  and a structural fallback. Fixes MEXC, where the only `Price (USDT)` labels
  belong to the buy/sell form, so the old header-anchored engine never found the
  book. Verified against the live MEXC markup (`orderbookItem` rows).
- Structural rows are found from repeated siblings and a
  `price × amount ≈ total` triple; density and containment checks stop a
  two-row side panel from being read as a two-row table, and extra numeric
  columns (change %, fee) no longer confuse the column mapping.
- **Collapsed sub-cent prices** (`0.0{4}1234`, `0.0₄123`) are expanded before
  conversion — gate uses this notation for cheap coins.
- **Adaptive number fitting**: if the full IDR value would be clipped (MEXC's
  price cell is ~82 px), the badge falls back to compact (`1,44 M`) and a tight
  `1,44M`, and the volume column falls back to compact too. The full IDR value
  is always in the badge tooltip. New `idr.fit` setting (default on).
- Rate source is now <https://indodax.com/api/ticker/usdtidr> (`ticker.last`),
  and the background/crontab updater runs **every 15 minutes**
  (`*/15 * * * *`), same for the in-tab interval.
- Tooling: TypeScript is a real dev dependency, with a strict split config
  (`tsconfig.json` for DOM-only userscript code, `tsconfig.tools.json` for
  Bun/Node build + test code).
- Tests: 45 unit + 57 DOM checks, including real-markup MEXC and gate fixtures.

## 0.2.0

- **IDR price colour is configurable** — `idr.priceColor`, default `#ead05a`
  (the gold sampled from the reference design). Set it to an empty value to go
  back to inheriting the row colour (red asks / green bids).
- **`idr.volumeColor`** — colour of the converted `Total (USDT)` column, empty by
  default (inherits the cell).
- Colour values are sanitised (`#rgb`, `#rrggbb`, `rgb()/hsl()`, named colours);
  an invalid value silently falls back to inherit.
- Badge style is only rewritten when it actually changes.
- Tests: default gold, override, inherit fallback (39 DOM checks total).

## 0.1.0

- IDR price badge beside every orderbook price; `Total (USDT)` replaced with the
  IDR volume.
- Layout agnostic row detection (`price × amount ≈ total`, tolerance derived from
  the displayed precision) — works on div rows, tables, nested cells, headers
  with sort arrows, `K`/`M` suffixes and 9-decimal prices.
- USDT → IDR rate read from shared storage (`@storageName tradecat`) through a
  promise API, plus a background + crontab updater script (Indodax → CoinGecko).
- Deposit / withdraw panel: per-coin status, per-chain `D✓ W✗` flags, quick
  Deposit / Withdraw buttons, draggable, shadow DOM.
- Bun build (`dist/` committed), 42 unit tests + headless Chromium DOM tests.

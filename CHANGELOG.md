# Changelog

Versions are the `@version` in the userscript metadata blocks. ScriptCat only
offers an update when this number changes, so every released change bumps it.

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

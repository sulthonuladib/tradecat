# Changelog

Versions are the `@version` in the userscript metadata blocks. ScriptCat only
offers an update when this number changes, so every released change bumps it.

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

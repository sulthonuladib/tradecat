# Changelog

Versions are the `@version` in the userscript metadata blocks. ScriptCat only
offers an update when this number changes, so every released change bumps it.

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

# Install guide

Two userscripts, one install each. Takes about a minute.

| Script | What it does | Install link |
| --- | --- | --- |
| **TradeCat · IDR Orderbook** | IDR price next to every orderbook price, `Total (USDT)` → IDR volume, deposit/withdraw panel | <https://raw.githubusercontent.com/sulthonuladib/tradecat/main/dist/tradecat-idr.user.js> |
| **TradeCat · USDT/IDR Rate Updater** | keeps the USDT → IDR rate fresh in the background (every 15 minutes) | <https://raw.githubusercontent.com/sulthonuladib/tradecat/main/dist/tradecat-rate-updater.user.js> |

> Installing only the first script works fine — it falls back to a constant rate
> (`idr.fallbackRate`, default `18000`) until something writes a real rate.

---

## 1. Install ScriptCat

ScriptCat is the userscript manager these scripts are built for (Tampermonkey /
Violentmonkey also work, see [Other managers](#other-userscript-managers)).

- Chrome / Edge / Brave: <https://chromewebstore.google.com/detail/scriptcat/ndcooeababalnlpkfedmmbbbgkljhpjf>
- Firefox: <https://addons.mozilla.org/firefox/addon/scriptcat/>
- Other browsers / manual: <https://docs.scriptcat.org/docs/use/>

Pin the ScriptCat icon to your toolbar — you will use its dashboard.

## 2. Install the scripts

### Option A — click the raw links (easiest)

1. Open
   <https://raw.githubusercontent.com/sulthonuladib/tradecat/main/dist/tradecat-idr.user.js>
   in a new tab.
2. ScriptCat intercepts the page and shows an **Install script** screen.
   Click **Install** (or **Confirm**).
3. Repeat with
   <https://raw.githubusercontent.com/sulthonuladib/tradecat/main/dist/tradecat-rate-updater.user.js>.

Because the scripts declare `@updateURL` / `@downloadURL`, ScriptCat will offer
updates automatically whenever `dist/` changes on `main`.

### Option B — from the ScriptCat dashboard

1. Click the ScriptCat icon → **Scripts** (management panel).
2. Click **+** → **Import from URL** and paste a raw link from the table above.
   (Or **Import from file** if you downloaded the `.user.js` file, or cloned the
   repo and want to use `dist/tradecat-idr.user.js` directly.)
3. Confirm the install dialog for both scripts.

### Option C — local build

```bash
git clone https://github.com/sulthonuladib/tradecat
cd tradecat
bun run build          # writes dist/tradecat-idr.user.js + dist/tradecat-rate-updater.user.js
```

Then import the two files from `dist/` (dashboard → **+** → **Import from file**),
or use the VSCode live-sync flow described in the [README](README.md#development).

## 3. Verify it works

1. Open a trade page, e.g.
   <https://www.gate.com/trade/BTC_USDT>,
   <https://www.mexc.fm/exchange/BTC_USDT>,
   <https://www.binance.com/en/trade/BTC_USDT>,
   <https://www.kucoin.com/trade/BTC-USDT>,
   <https://www.bybit.com/en/trade/spot/BTC/USDT> or
   <https://indodax.com/market/BTCIDR>.
2. Refresh the page once (the scripts attach on load).
3. You should see:
   - a dim IDR number right after every price in the orderbook,
   - the `Total (USDT)` column showing IDR volumes,
   - a small panel in the bottom-left: coin, **Deposit** / **Withdraw** status,
     the chain list, and two buttons.
   - On **Bybit** the orderbook is drawn on a canvas, so a converted IDR
     orderbook panel appears just left of the native one, fed by Bybit's own
     depth worker (8 levels per side, Price/Qty/Total in IDR).
   - On **Indodax** there is only a compact panel with the withdrawal fee and
     the 1% margin (its prices are already rupiah).

Nothing on screen? Open DevTools → Console and run:

```js
TradeCat.describe()
// { header: "Price (USDT)", container: "div.ob", rows: 40, sample: [...] }
```

- `rows: 40` → detection is fine, the values should be rendered.
- `rows: 0` → the layout changed; see [Troubleshooting](#troubleshooting).
- `TradeCat` is undefined → the script is not running on that page (check
  `@match`, that the script is enabled, and that the page was reloaded).

## 4. Configure

ScriptCat dashboard → **Scripts** → `TradeCat · IDR Orderbook` → **Settings**
(or run the `TradeCat: open settings` menu command).

| Setting | Default | What it changes |
| --- | --- | --- |
| `idr.fallbackRate` | `18000` | rate used when storage has none |
| `idr.priceFormat` | `full` | `full` = `1.407.000.000`, `compact` = `1,41 M` |
| `idr.volumeFormat` | `full` | `full`, `compact`, `auto` |
| `idr.prefix` | *(empty)* | set `Rp` for `Rp1.407.000.000` |
| `idr.priceColor` | `#ead05a` | colour of the IDR price number (empty = inherit the row's red/green) |
| `idr.volumeColor` | `#ead05a` | colour of the converted Total column (empty = inherit) |
| `idr.fit` | on | use compact text when the full number would clip |
| `idr.showPrice` | on | IDR next to the price |
| `idr.convertTotal` | on | replace `Total (USDT)` with IDR |
| `idr.ttlHours` | `6` | rate cache lifetime |
| `idr.enableNetworkRate` | off | let this script fetch the rate itself |
| `coin.panel` | on | show the deposit/withdraw panel |
| `coin.showChains` | on | show per-chain `D✓ W✗` flags, withdrawal fee and limits |
| `coin.position` | `bottom-left` | panel anchor (it is also draggable) |

Set the rate by hand at any time (works immediately, no reload):

```js
TradeCat.setRate(18085)          // from the DevTools console
```

## 5. The rate updater

The panel reads network status and withdrawal fees from the exchange:
gate uses `wallet/currency_chains` + `/json_svr/query?u=116`, MEXC uses
`/api/platform/asset/api/asset/spot/currency/v3`, Binance uses
`getNetworkCoinAll`, KuCoin uses `api/v3/currencies/COIN`, Bybit uses the
session-backed `asset-common/coin-config`. **Log in on gate/Bybit** to see fees;
without a session the panel still shows the networks and their status. Indodax's
fee needs a login on `/finance/<COIN>` (the panel tells you when it is missing).

`TradeCat · USDT/IDR Rate Updater` runs as a ScriptCat crontab script
(`@crontab */15 * * * *`) (every 15 minutes). It reads
<https://indodax.com/api/ticker/usdtidr> (`ticker.last`) first, falls back to
CoinGecko, and writes the result to the shared `tradecat` storage.

The orderbook script re-reads that storage every 30 seconds, so a fresh rate
appears without touching the page. You can check it in the panel footer:
`1 USDT = Rp. 18.085`.

A `@crontab` script sits at **Stopped** between runs - that is normal. The row
shows the last run ("13 minutes ago") and, on hover, the next scheduled time.
The ▶ button runs it once: it should show **Running** until the HTTP request
finishes, then go back to Stopped. If pressing ▶ does nothing and the last-run
time never changes, open the run log (click the run-status column) for the error.

To refresh right away: ScriptCat dashboard → **Scripts** → click the run status
of the updater (or wait for the cron tick). Background logs are visible in the
dashboard run log.

Want a different source? Edit `RATE_SOURCES` in `src/lib/rate.ts`, rebuild, or
write the storage keys yourself from any script:

```js
localStorage.setItem('tradecat:idr.rate', JSON.stringify(18085));
localStorage.setItem('tradecat:idr.updatedAt', JSON.stringify(Date.now()));
localStorage.setItem('tradecat:idr.source', JSON.stringify('my-source'));
```

## Troubleshooting

**I installed it, but I don't get updates.**
ScriptCat only offers an update when the remote `@version` is higher than the
installed one. If you installed by **Import from file**, updates never apply —
reinstall from the raw URL instead (dashboard → **+** → *Import from URL*), which
keeps `@updateURL`/`@downloadURL` pointing at this repo. You can always force a
check: dashboard → script → **Check update**.

**Prices are not converted.**
Run `TradeCat.describe()` (see step 3). If `rows: 0`, the exchange changed the
orderbook markup in a way the `price × amount ≈ total` rule does not recognise.
Please open an issue with the output of `describe()` plus one orderbook row
copied from DevTools (right-click the row → *Copy* → *Copy element*).

**Panel says "MEXC asset API unavailable".**
MEXC's asset endpoints are behind bot protection on some networks. The Deposit /
Withdraw buttons still work; click **retry** in the panel footer later.

**The rate looks wrong / stale.**
Check the panel footer (`1 USDT = …`). If the updater cannot reach its sources,
the last good value is kept. Set it manually with `TradeCat.setRate(...)`.

**Nothing renders on gate.io but works on gate.com.**
Make sure the script is enabled for that domain: dashboard → script →
**Settings → Matches** should list `www.gate.io/trade/*`.

**ScriptCat is not showing the install screen.**
Right-click the ScriptCat icon → check the extension has permission for
`raw.githubusercontent.com`, or use **Import from URL** in the dashboard.

## Other userscript managers

Tampermonkey and Violentmonkey can run these too, but they do not support
`@storageName`, so the two scripts will not share storage. Either enable
`idr.enableNetworkRate` in the main script (it fetches the rate itself), or keep
using the fallback constant.

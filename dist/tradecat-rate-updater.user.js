// ==UserScript==
// @name         TradeCat · USDT/IDR Rate Updater
// @namespace    https://github.com/sulthonuladib/tradecat
// @homepageURL  https://github.com/sulthonuladib/tradecat
// @supportURL   https://github.com/sulthonuladib/tradecat/issues
// @updateURL    https://raw.githubusercontent.com/sulthonuladib/tradecat/main/dist/tradecat-rate-updater.user.js
// @downloadURL  https://raw.githubusercontent.com/sulthonuladib/tradecat/main/dist/tradecat-rate-updater.user.js
// @version      0.3.0
// @description  Periodically refresh the shared USDT → IDR rate (Indodax, then CoinGecko) that the TradeCat orderbook script reads from storage.
// @author       tradecat
// @license      MIT
// @background
// @crontab      */15 * * * *
// @storageName  tradecat
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_log
// @connect      indodax.com
// @connect      api.coingecko.com
// ==/UserScript==

(() => {
  // src/lib/store.ts
  var LS_PREFIX = "tradecat:";
  function hasGM() {
    try {
      return typeof GM_getValue === "function" && typeof GM_setValue === "function";
    } catch {
      return false;
    }
  }
  function getStored(key, fallback) {
    try {
      if (hasGM()) {
        const value = GM_getValue(key, undefined);
        if (value !== undefined && value !== null)
          return value;
      }
    } catch {}
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      if (raw !== null)
        return JSON.parse(raw);
    } catch {}
    return fallback;
  }
  function setStored(key, value) {
    try {
      if (hasGM())
        GM_setValue(key, value);
    } catch {}
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    } catch {}
  }
  async function requestJson(url, timeoutMs = 12000) {
    const text = await requestText(url, timeoutMs);
    return JSON.parse(text);
  }
  async function requestText(url, timeoutMs = 12000) {
    if (hasGM() && typeof GM_xmlhttpRequest === "function") {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          timeout: timeoutMs,
          headers: { Accept: "application/json, text/plain, */*" },
          onload: (res) => {
            if (res.status >= 200 && res.status < 300)
              resolve(res.responseText);
            else
              reject(new Error(`HTTP ${res.status} for ${url}`));
          },
          onerror: () => reject(new Error(`network error for ${url}`)),
          ontimeout: () => reject(new Error(`timeout for ${url}`))
        });
      });
    }
    const controller = new AbortController;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, credentials: "omit" });
      if (!res.ok)
        throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }
  function log(...args) {
    try {
      console.log("%c[TradeCat]", "color:#22c55e;font-weight:bold", ...args);
    } catch {}
  }

  // src/lib/rate.ts
  var DEFAULT_USDT_IDR = 18000;
  var KEY_RATE = "idr.rate";
  var KEY_UPDATED_AT = "idr.updatedAt";
  var KEY_SOURCE = "idr.source";
  var RATE_SOURCES = [
    {
      id: "indodax",
      label: "Indodax USDT/IDR",
      url: "https://indodax.com/api/ticker/usdtidr",
      parse: (body) => numberOrNull(body?.ticker?.last)
    },
    {
      id: "coingecko",
      label: "CoinGecko tether/idr",
      url: "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=idr",
      parse: (body) => numberOrNull(body?.tether?.idr)
    }
  ];
  function numberOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  var snapshot = { rate: DEFAULT_USDT_IDR, updatedAt: 0, source: "constant" };
  var listeners = new Set;
  function readRateFromStorage() {
    const rate = Number(getStored(KEY_RATE, NaN));
    const updatedAt = Number(getStored(KEY_UPDATED_AT, 0)) || 0;
    const source = String(getStored(KEY_SOURCE, "") || "");
    if (Number.isFinite(rate) && rate > 0) {
      return { rate, updatedAt, source: source || "storage" };
    }
    return { rate: DEFAULT_USDT_IDR, updatedAt: 0, source: "constant" };
  }
  function publish(next) {
    const changed = next.rate !== snapshot.rate || next.updatedAt !== snapshot.updatedAt;
    snapshot = next;
    if (changed)
      listeners.forEach((cb) => cb(next));
  }
  function saveRate(rate, source = "manual") {
    const next = { rate, updatedAt: Date.now(), source };
    setStored(KEY_RATE, rate);
    setStored(KEY_UPDATED_AT, next.updatedAt);
    setStored(KEY_SOURCE, source);
    publish(next);
    return next;
  }

  // src/rate-updater.ts
  var isBackground = typeof document === "undefined";
  async function refresh() {
    for (const source of RATE_SOURCES) {
      try {
        const body = await requestJson(source.url, 1e4);
        const rate = source.parse(body);
        if (rate && rate > 0) {
          const previous = readRateFromStorage();
          saveRate(rate, source.id);
          log(`USDT/IDR ${rate} from ${source.label} (was ${previous.rate}, ${previous.source})`);
          return rate;
        }
      } catch (error) {
        log(`rate source ${source.id} failed`, error);
      }
    }
    return null;
  }
  (async () => {
    const rate = await refresh();
    if (rate === null)
      log("no rate source returned a value - keeping the previous rate");
    if (!isBackground) {
      setInterval(() => void refresh(), 15 * 60 * 1000);
    }
  })();
})();


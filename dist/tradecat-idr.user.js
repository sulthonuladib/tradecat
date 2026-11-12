// ==UserScript==
// @name         TradeCat · IDR Orderbook
// @namespace    https://github.com/sulthonuladib/tradecat
// @homepageURL  https://github.com/sulthonuladib/tradecat
// @supportURL   https://github.com/sulthonuladib/tradecat/issues
// @updateURL    https://raw.githubusercontent.com/sulthonuladib/tradecat/main/dist/tradecat-idr.user.js
// @downloadURL  https://raw.githubusercontent.com/sulthonuladib/tradecat/main/dist/tradecat-idr.user.js
// @version      0.4.2
// @description  IDR price beside every orderbook price, Total (USDT) replaced by IDR volume, plus deposit/withdraw status with chain details and quick Deposit/Withdraw buttons. Works on gate.com, mexc.fm, binance.com, kucoin.com and bybit.com; Indodax gets a compact fee + 1% margin readout.
// @author       sulthonuladib
// @license      MIT
// @match        https://www.gate.com/trade/*
// @match        https://gate.com/trade/*
// @match        https://www.gate.io/trade/*
// @match        https://gate.io/trade/*
// @match        https://www.mexc.com/exchange/*
// @match        https://mexc.com/exchange/*
// @match        https://www.mexc.fm/exchange/*
// @match        https://mexc.fm/exchange/*
// @match        https://www.binance.com/trade/*
// @match        https://www.binance.com/*/trade/*
// @match        https://www.kucoin.com/trade/*
// @match        https://www.kucoin.com/*/trade/*
// @match        https://www.bybit.com/trade/spot/*
// @match        https://www.bybit.com/*/trade/spot/*
// @match        https://indodax.com/market/*
// @match        https://indodax.com/trade/*
// @match        https://www.indodax.com/market/*
// @match        https://www.indodax.com/trade/*
// @run-at       document-start
// @noframes
// @storageName  tradecat
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      api.gateio.ws
// @connect      www.mexc.fm
// @connect      www.mexc.com
// @connect      api.mexc.com
// @connect      www.binance.com
// @connect      api.binance.com
// @connect      api.kucoin.com
// @connect      api.bybit.com
// @connect      api2.bybit.com
// @connect      indodax.com
// @connect      api.coingecko.com
// ==/UserScript==

/* ==UserConfig==
idr:
  fallbackRate:
    title: Fallback USDT → IDR rate
    description: Used only when no cached rate exists. Run the "TradeCat · USDT/IDR Rate Updater" script to keep a real rate in shared storage.
    type: number
    default: 18000
    min: 1
  priceFormat:
    title: IDR price format
    description: full = 1.407.000.000 · compact = 1,41 M
    type: select
    default: full
    values: [full, compact]
  volumeFormat:
    title: IDR volume format
    description: auto = full when it fits, compact when the number gets long
    type: select
    default: full
    values: [full, compact, auto]
  prefix:
    title: IDR prefix
    description: Text placed before converted numbers. Leave empty for plain numbers, or use "Rp".
    type: text
    default: ""
  priceColor:
    title: IDR price colour
    description: Colour of the IDR number next to the price. Leave empty to inherit the row colour (red/green).
    type: text
    default: "#ead05a"
  volumeColor:
    title: IDR volume colour
    description: Colour of the converted Total column. Defaults to the same gold as the price; leave empty to inherit the cell colour.
    type: text
    default: "#ead05a"
  fit:
    title: Shrink numbers that do not fit
    description: When the full IDR number is wider than the orderbook cell, switch to compact (1,44 M) instead of letting it get clipped. The full value stays in the tooltip.
    type: checkbox
    default: true
  showPrice:
    title: Show IDR next to the orderbook price
    type: checkbox
    default: true
  convertTotal:
    title: Replace "Total (USDT)" with IDR volume
    type: checkbox
    default: true
  ttlHours:
    title: Rate cache TTL (hours)
    description: How long a cached rate is considered fresh.
    type: number
    default: 6
    min: 1
  enableNetworkRate:
    title: Let this script fetch the rate itself
    description: Off by default - the rate updater script is meant to own that job.
    type: checkbox
    default: false
coin:
  panel:
    title: Show deposit / withdraw panel
    type: checkbox
    default: true
  showChains:
    title: Show per-chain status
    type: checkbox
    default: true
  position:
    title: Panel position
    type: select
    default: bottom-left
    values: [bottom-left, bottom-right, top-left, top-right]
==/UserConfig== */

(() => {
  // src/lib/site.ts
  var FORCED = ["gate", "mexc", "binance", "kucoin", "bybit", "indodax"];
  function detectSite(host = location.hostname) {
    const forced = globalThis.__TRADECAT_SITE__;
    if (forced && FORCED.includes(forced))
      return forced;
    if (/(^|\.)gate\.(com|io)$/.test(host))
      return "gate";
    if (/(^|\.)mexc\.(com|fm)$/.test(host))
      return "mexc";
    if (/(^|\.)binance\.com$/.test(host))
      return "binance";
    if (/(^|\.)kucoin\.com$/.test(host))
      return "kucoin";
    if (/(^|\.)bybit\.com$/.test(host))
      return "bybit";
    if (/(^|\.)indodax\.com$/.test(host))
      return "indodax";
    return "generic";
  }
  function isSimpleSite(site) {
    return site === "indodax";
  }
  function usesApiBook(site) {
    return site === "bybit";
  }
  var QUOTES = ["USDT", "IDR", "BTC", "USDC", "BUSD", "ETH"];
  function currentPair(path = location.pathname) {
    const bybit = path.match(/\/trade\/(?:spot|linear|inverse)\/([A-Za-z0-9]{1,16})\/([A-Za-z0-9]{1,12})/);
    if (bybit?.[1] && bybit[2]) {
      return { base: bybit[1].toUpperCase(), quote: bybit[2].toUpperCase() };
    }
    const match = path.match(/\/(?:trade|exchange|spot|market)\/([A-Za-z0-9]{1,16})[_-]([A-Za-z0-9]{1,12})/);
    if (match?.[1] && match[2]) {
      return { base: match[1].toUpperCase(), quote: match[2].toUpperCase() };
    }
    const compact = path.match(/\/(?:trade|market)\/([A-Za-z0-9]{2,20})(?:\/index\.html)?\/?$/);
    const symbol = compact?.[1]?.toUpperCase();
    if (symbol && /^[A-Z0-9]+$/.test(symbol)) {
      for (const quote of QUOTES) {
        if (symbol.length > quote.length && symbol.endsWith(quote)) {
          return { base: symbol.slice(0, -quote.length), quote };
        }
      }
    }
    return null;
  }
  function origin(fallback) {
    return location.origin && location.origin !== "null" ? location.origin : fallback;
  }
  function depositUrl(site, coin) {
    const base = origin("https://www.gate.com");
    if (site === "gate")
      return `${base}/myaccount/deposit/${coin}`;
    if (site === "mexc")
      return `${base}/assets/deposit/${coin}`;
    if (site === "binance")
      return `${base}/my/wallet/deposit`;
    if (site === "kucoin")
      return `${base}/assets/deposit`;
    if (site === "bybit")
      return `${base}/en/assets/deposit`;
    return "";
  }
  function withdrawUrl(site, coin) {
    const base = origin("https://www.gate.com");
    if (site === "gate")
      return `${base}/myaccount/withdraw/${coin}`;
    if (site === "mexc")
      return `${base}/assets/withdraw/${coin}`;
    if (site === "binance")
      return `${base}/my/wallet/withdraw`;
    if (site === "kucoin")
      return `${base}/assets/withdraw`;
    if (site === "bybit")
      return `${base}/en/assets/withdraw`;
    return "";
  }

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
  function currentRate() {
    return snapshot;
  }
  function rateValue() {
    return snapshot.rate;
  }
  function onRateChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
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
  function syncRateFromStorage() {
    const next = readRateFromStorage();
    if (next.rate !== snapshot.rate)
      publish(next);
    return snapshot;
  }
  async function getUsdtIdrRate(options = {}) {
    const ttlMs = Math.max(1, options.ttlHours ?? 6) * 3600000;
    const cached = readRateFromStorage();
    if (cached.updatedAt && Date.now() - cached.updatedAt < ttlMs) {
      publish(cached);
      return cached;
    }
    if (options.enableNetwork) {
      for (const source of RATE_SOURCES) {
        try {
          const body = await requestJson(source.url);
          const rate = source.parse(body);
          if (rate) {
            const saved = saveRate(rate, source.id);
            log(`rate ${rate} from ${source.label}`);
            return saved;
          }
        } catch (error) {
          log(`rate source ${source.id} failed`, error);
        }
      }
    }
    if (cached.rate > 0 && cached.source !== "constant") {
      publish(cached);
      return cached;
    }
    const fallback = options.fallbackRate && options.fallbackRate > 0 ? options.fallbackRate : DEFAULT_USDT_IDR;
    publish({ rate: fallback, updatedAt: cached.updatedAt, source: cached.source === "constant" ? "constant" : cached.source });
    return snapshot;
  }
  function initRate() {
    publish(readRateFromStorage());
    return snapshot;
  }

  // src/lib/dom.ts
  var INJECTED = "tc-injected";
  var PRICE_IDR = "tc-idr-price";
  var SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "CANVAS",
    "INPUT",
    "TEXTAREA",
    "SELECT",
    "OPTION",
    "svg",
    "path",
    "TEMPLATE"
  ]);
  function cleanText(el) {
    const raw = el.textContent;
    if (!raw)
      return "";
    if (!el.querySelector("." + INJECTED))
      return raw.trim();
    let out = "";
    const visit = (node) => {
      node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          out += child.textContent ?? "";
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const childEl = child;
          if (!childEl.classList.contains(INJECTED))
            visit(childEl);
        }
      });
    };
    visit(el);
    return out.trim();
  }
  var rendered = new WeakMap;
  function siteText(el) {
    const current = cleanText(el);
    const previous = rendered.get(el);
    if (previous !== undefined && previous === current) {
      const original = el.dataset["tcOrig"];
      if (original !== undefined)
        return original;
    }
    return current;
  }
  function isVisible(el) {
    if (el.hidden)
      return false;
    if (el.getAttribute("aria-hidden") === "true")
      return false;
    const candidate = el;
    if (typeof candidate.checkVisibility === "function") {
      try {
        return candidate.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
      } catch {}
    }
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
  }
  function ownText(el) {
    let out = "";
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE)
        out += node.textContent ?? "";
    });
    return out.replace(/\s+/g, " ").trim();
  }
  function walkLeaves(root, out, maxLeaves = 1200, maxNodes = 20000) {
    let visited = 0;
    const filter = {
      acceptNode(node) {
        const el = node;
        visited += 1;
        if (visited > maxNodes || out.length >= maxLeaves)
          return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(el.tagName))
          return NodeFilter.FILTER_REJECT;
        if (el.classList.contains(INJECTED))
          return NodeFilter.FILTER_REJECT;
        const text = ownText(el);
        if (text && text.length <= 32) {
          out.push(el);
          return out.length >= maxLeaves ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_SKIP;
      }
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, filter);
    walker.nextNode();
  }
  function cellOf(leaf, row) {
    let node = leaf;
    while (node.parentElement && node.parentElement !== row)
      node = node.parentElement;
    return node;
  }

  // src/lib/format.ts
  var UNIT = {
    k: 1000,
    m: 1e6,
    b: 1e9,
    t: 1000000000000,
    "万": 1e4,
    "亿": 1e8
  };
  var SEP_SPACE = /[\s\u00a0\u202f\u2009\u2007\u2008]/g;
  var SUBSCRIPT_DIGITS = {
    "₀": "0",
    "₁": "1",
    "₂": "2",
    "₃": "3",
    "₄": "4",
    "₅": "5",
    "₆": "6",
    "₇": "7",
    "₈": "8",
    "₉": "9"
  };
  function expandCollapsed(input) {
    return input.replace(/\{(\d{1,3})\}|([₀-₉]+)/g, (match, braces, subs) => {
      const subscript = subs ? Number([...subs].map((char) => SUBSCRIPT_DIGITS[char] ?? "").join("")) : NaN;
      const count = braces ? Number(braces) : subscript;
      if (!Number.isFinite(count) || count < 1)
        return match;
      return "0".repeat(Math.min(24, count - 1));
    });
  }
  function parseNumber(input) {
    return parseNumberInfo(input)?.value ?? null;
  }
  function parseNumberInfo(input) {
    if (typeof input === "number") {
      return Number.isFinite(input) ? { value: input, step: 0 } : null;
    }
    if (input == null)
      return null;
    let s = String(input).replace(SEP_SPACE, "");
    s = s.replace(/[^0-9.,+\-A-Za-z万亿{}₀-₉]/g, "");
    if (!s)
      return null;
    if (s.includes(".") && (s.includes("{") || /[₀-₉]/.test(s))) {
      s = expandCollapsed(s);
    }
    let mult = 1;
    const unitMatch = s.match(/([0-9.,])([kKmMbBtT万亿])$/);
    const unitKey = unitMatch?.[2];
    if (unitKey) {
      mult = UNIT[unitKey.toLowerCase()] ?? UNIT[unitKey] ?? 1;
      s = s.slice(0, -1);
    }
    s = s.replace(/[A-Za-z万亿{}₀-₉]/g, "");
    const negative = /^-/.test(s);
    s = s.replace(/[+\-]/g, "");
    if (!s || !/\d/.test(s))
      return null;
    const dots = (s.match(/\./g) || []).length;
    const commas = (s.match(/,/g) || []).length;
    let norm;
    if (dots > 0 && commas > 0) {
      norm = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(/,/g, ".") : s.replace(/,/g, "");
    } else if (dots > 1) {
      norm = s.replace(/\./g, "");
    } else if (commas > 1) {
      norm = s.replace(/,/g, "");
    } else if (dots === 1) {
      norm = s;
    } else if (commas === 1) {
      const [intPart = "", fracPart = ""] = s.split(",");
      const looksLikeThousands = intPart !== "0" && /^\d{1,3}$/.test(intPart) && fracPart.length === 3;
      norm = looksLikeThousands ? intPart + fracPart : s.replace(",", ".");
    } else {
      norm = s;
    }
    const n = Number(norm);
    if (!Number.isFinite(n))
      return null;
    const decimals = norm.includes(".") ? (norm.split(".")[1] ?? "").length : 0;
    const step = Math.pow(10, -decimals) * mult;
    return { value: negative ? -n * mult : n * mult, step };
  }
  var idNum = (value, options) => {
    try {
      return value.toLocaleString("id-ID", options);
    } catch {
      return String(value);
    }
  };
  var COMPACT_UNITS = [
    [1000000000000, " T"],
    [1e9, " M"],
    [1e6, " jt"],
    [1000, " rb"]
  ];
  function formatCompactIdr(value) {
    const abs = Math.abs(value);
    for (const [divisor, suffix] of COMPACT_UNITS) {
      if (abs >= divisor)
        return idNum(value / divisor, { maximumFractionDigits: 2 }) + suffix;
    }
    return idNum(value, { maximumFractionDigits: 2 });
  }
  function formatIdr(value, options = {}) {
    if (!Number.isFinite(value))
      return "";
    const prefix = options.prefix ?? "";
    const mode = options.mode ?? "full";
    const abs = Math.abs(value);
    if (abs === 0)
      return `${prefix}0`;
    if (mode === "full" && options.precision === "price" && abs >= 1) {
      const digits = abs < 10 ? 3 : 2;
      return prefix + idNum(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    if (abs < 1) {
      if (mode === "compact") {
        const decimals = Math.min(12, Math.max(2, 1 - Math.floor(Math.log10(abs))));
        return prefix + idNum(value, { maximumFractionDigits: decimals });
      }
      const decimals = Math.min(12, Math.max(2, Math.ceil(-Math.log10(abs)) + 4));
      return prefix + idNum(value, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
    }
    if (abs < 1000) {
      return prefix + idNum(value, { maximumFractionDigits: options.decimals ?? 2 });
    }
    const fraction = options.decimals ?? 0;
    const full = prefix + idNum(value, {
      minimumFractionDigits: fraction,
      maximumFractionDigits: fraction
    });
    if (mode === "compact")
      return prefix + formatCompactIdr(value);
    if (mode === "auto") {
      const limit = options.maxFullLength ?? 13;
      return full.length <= limit ? full : prefix + formatCompactIdr(value);
    }
    return full;
  }

  // src/lib/detect.ts
  var MAX_ROW_NUMBERS = 8;
  function leavesOf(el, limit = 10) {
    const els = [];
    walkLeaves(el, els, 32, 800);
    const out = [];
    for (const node of els) {
      if (out.length >= limit)
        break;
      if (!isVisible(node))
        continue;
      const text = siteText(node);
      const info = parseNumberInfo(text);
      if (!info || !(info.value > 0))
        continue;
      out.push({ el: node, text, value: info.value, step: info.step });
    }
    return out;
  }
  function matches(price, amount, total) {
    const tolerance = Math.max(total.value * 0.02, total.step * 1.05, price.value * amount.step * 1.05) + 0.000000000001;
    return Math.abs(price.value * amount.value - total.value) <= tolerance;
  }
  function findTriple(leaves) {
    const count = Math.min(leaves.length, MAX_ROW_NUMBERS + 2);
    let best = null;
    for (let i = 0;i < count; i += 1) {
      const price = leaves[i];
      if (!price)
        continue;
      for (let j = i + 1;j < count; j += 1) {
        const amount = leaves[j];
        if (!amount)
          continue;
        for (let k = j + 1;k < count; k += 1) {
          const total = leaves[k];
          if (!total)
            continue;
          if (!matches(price, amount, total))
            continue;
          const candidate = { price, amount, total, key: `${i},${j},${k}`, span: k - i };
          if (!best || candidate.span < best.span || candidate.span === best.span && candidate.key < best.key) {
            best = candidate;
          }
        }
      }
    }
    return best;
  }
  function toOrderRow(row, triple) {
    return {
      row,
      price: triple.price,
      amount: triple.amount,
      total: triple.total,
      priceCell: cellOf(triple.price.el, row),
      amountCell: cellOf(triple.amount.el, row),
      totalCell: cellOf(triple.total.el, row),
      key: triple.key
    };
  }
  function refreshRow(row) {
    if (!row.row.isConnected)
      return null;
    const leaves = leavesOf(row.row, MAX_ROW_NUMBERS + 2);
    const [priceIndex = 0, amountIndex = 1, totalIndex = 2] = row.key.split(",").map(Number);
    const price = leaves[priceIndex];
    const amount = leaves[amountIndex];
    const total = leaves[totalIndex];
    if (price && amount && total) {
      const fresh = toOrderRow(row.row, {
        price,
        amount,
        total,
        key: row.key,
        span: totalIndex - priceIndex
      });
      if (row.deriveTotal)
        fresh.totalValue = price.value * amount.value;
      if (row.cumulative)
        fresh.cumulative = row.cumulative;
      return fresh;
    }
    return rowTriple(row.row);
  }
  function rowTriple(row) {
    const leaves = leavesOf(row, MAX_ROW_NUMBERS + 2);
    if (leaves.length < 3)
      return null;
    const triple = findTriple(leaves);
    return triple ? toOrderRow(row, triple) : null;
  }
  function dominantKey(rows) {
    const votes = new Map;
    for (const row of rows)
      votes.set(row.key, (votes.get(row.key) ?? 0) + 1);
    let best = null;
    let bestCount = 0;
    for (const [key, count] of votes) {
      if (count > bestCount) {
        best = key;
        bestCount = count;
      }
    }
    return best;
  }
  function detectRowGroups(scope, options = {}) {
    const minRows = options.minRows ?? 2;
    const leaves = [];
    const els = [];
    walkLeaves(scope, els, options.maxLeaves ?? 1500, options.maxNodes ?? 20000);
    for (const el of els) {
      if (!isVisible(el))
        continue;
      const info = parseNumberInfo(siteText(el));
      if (!info || !(info.value > 0))
        continue;
      leaves.push({ el, text: siteText(el), value: info.value, step: info.step });
    }
    if (leaves.length < 3)
      return [];
    const buckets = new Map;
    for (const leaf of leaves) {
      let node = leaf.el.parentElement;
      for (let depth = 0;node && depth < 10; depth += 1, node = node.parentElement) {
        const bucket = buckets.get(node);
        if (bucket)
          bucket.push(leaf);
        else
          buckets.set(node, [leaf]);
      }
    }
    const groups = [];
    for (const [parent, numbers] of buckets) {
      if (numbers.length < minRows * 2)
        continue;
      const kids = Array.from(parent.children).filter((kid) => kid instanceof HTMLElement && !kid.classList.contains(INJECTED));
      if (kids.length < minRows || kids.length > 96)
        continue;
      const numbered = [];
      let tooMany = false;
      for (const kid of kids) {
        const own = numbers.filter((leaf) => kid.contains(leaf.el));
        if (own.length === 0)
          continue;
        if (own.length > MAX_ROW_NUMBERS) {
          tooMany = true;
          break;
        }
        if (own.length < 2)
          continue;
        numbered.push({ kid, own, triple: findTriple(own) });
      }
      if (tooMany)
        continue;
      if (numbered.length / kids.length < 0.6)
        continue;
      const candidates = numbered.filter((entry) => entry.triple !== null).map((entry) => toOrderRow(entry.kid, entry.triple));
      if (candidates.length < minRows)
        continue;
      const key = dominantKey(candidates);
      if (!key)
        continue;
      const [priceIndex, amountIndex, totalIndex] = key.split(",").map(Number);
      const rows = [];
      for (const entry of numbered) {
        if (entry.triple && entry.triple.key === key) {
          rows.push(toOrderRow(entry.kid, entry.triple));
          continue;
        }
        const price = entry.own[priceIndex ?? 0];
        const amount = entry.own[amountIndex ?? 1];
        const total = entry.own[totalIndex ?? 2];
        if (!price || !amount || !total)
          continue;
        rows.push(toOrderRow(entry.kid, {
          price,
          amount,
          total,
          key,
          span: (totalIndex ?? 2) - (priceIndex ?? 0)
        }));
      }
      if (rows.length < minRows)
        continue;
      groups.push({ parent, rows });
    }
    return groups;
  }
  function related(a, b) {
    if (a === b)
      return true;
    let node = a;
    for (let depth = 0;node && depth < 4; depth += 1, node = node.parentElement) {
      if (node === b || node.contains(b))
        return true;
    }
    node = b;
    for (let depth = 0;node && depth < 4; depth += 1, node = node.parentElement) {
      if (node === a || node.contains(a))
        return true;
    }
    return false;
  }
  function chooseRows(groups) {
    if (groups.length === 0)
      return [];
    const ranked = [...groups].sort((a, b) => b.rows.length - a.rows.length);
    const anchor = ranked[0];
    if (!anchor)
      return [];
    const minimum = Math.max(2, Math.floor(anchor.rows.length * 0.4));
    const rows = [];
    const seen = new Set;
    const chosen = [];
    const overlaps = (el) => {
      for (const existing of chosen) {
        if (existing.contains(el) || el.contains(existing))
          return true;
      }
      return false;
    };
    for (const group of ranked) {
      if (group !== anchor && (group.rows.length < minimum || !related(group.parent, anchor.parent)))
        continue;
      for (const row of group.rows) {
        if (seen.has(row.row) || overlaps(row.row))
          continue;
        seen.add(row.row);
        chosen.push(row.row);
        rows.push(row);
      }
    }
    return rows;
  }
  function detectRows(scope, minRows = 2) {
    return chooseRows(detectRowGroups(scope, { minRows }));
  }

  // src/lib/exchanges/scan.ts
  function queryAll(doc, selector) {
    try {
      return Array.from(doc.querySelectorAll(selector));
    } catch {
      return [];
    }
  }
  function rowsFromElements(doc, selectors) {
    for (const selector of selectors) {
      const rows = [];
      for (const item of queryAll(doc, selector)) {
        if (item === doc.body || item === doc.documentElement)
          continue;
        const row = rowTriple(item);
        if (row)
          rows.push(row);
      }
      if (rows.length >= 2)
        return rows;
    }
    return [];
  }
  function rowsFromScopes(doc, selectors, minRows) {
    const rows = [];
    const seen = new Set;
    for (const selector of selectors) {
      for (const scope of queryAll(doc, selector)) {
        if (scope === doc.body || scope === doc.documentElement)
          continue;
        const found = chooseRows(detectRowGroups(scope, { minRows, maxNodes: 15000 }));
        for (const row of found) {
          if (seen.has(row.row))
            continue;
          seen.add(row.row);
          rows.push(row);
        }
      }
    }
    return rows;
  }
  function rowsByPosition(doc, selectors) {
    for (const selector of selectors) {
      const rows = [];
      const seen = new Set;
      for (const item of queryAll(doc, selector)) {
        if (seen.has(item) || item === doc.body || item === doc.documentElement)
          continue;
        const leaves = leavesOf(item, 6);
        const price = leaves[0];
        const amount = leaves[1];
        const total = leaves[2];
        if (!price || !amount || !total || !(price.value > 0) || !(amount.value > 0))
          continue;
        seen.add(item);
        rows.push({
          row: item,
          price,
          amount,
          total,
          priceCell: cellOf(price.el, item),
          amountCell: cellOf(amount.el, item),
          totalCell: cellOf(total.el, item),
          key: "0,1,2",
          deriveTotal: true,
          totalValue: price.value * amount.value
        });
      }
      if (rows.length >= 2)
        return rows;
    }
    return null;
  }
  function locateRows(doc, hints) {
    const minRows = hints.minRows ?? 2;
    const byRow = rowsFromElements(doc, hints.rows ?? []);
    if (byRow.length > 0)
      return byRow;
    const byScope = rowsFromScopes(doc, hints.scopes ?? [], minRows);
    return byScope.length > 0 ? byScope : null;
  }

  // src/lib/exchanges/binance.ts
  var ROW_SELECTORS = [
    '[class*="orderbook" i] [class*="row-content" i]',
    '[class*="progress-container" i] > [class*="row-content" i]',
    '[class*="row-content" i]',
    '[class*="orderbook-row" i]',
    '[class*="orderbook-item" i]'
  ];
  var SCOPE_SELECTORS = [
    '[class*="tradew-ob-container" i]',
    '[class*="orderbook-list" i]',
    '[class*="orderbook" i]'
  ];
  var VISUAL_KEY = "trd-orderbook-visual";
  function cumulativeMode() {
    try {
      const raw = localStorage.getItem(VISUAL_KEY);
      if (!raw)
        return false;
      return JSON.parse(raw) === "cumulative";
    } catch {
      return false;
    }
  }
  function markCumulative(rows) {
    if (!rows.length || !cumulativeMode())
      return;
    const sides = new Map;
    for (const row of rows) {
      let side = "";
      try {
        const holder = row.row.closest('[class*="orderbook-ask" i], [class*="orderbook-bid" i]');
        const cls = holder?.className ?? "";
        if (/ask/i.test(cls))
          side = "ask";
        else if (/bid/i.test(cls))
          side = "bid";
      } catch {}
      if (!side)
        continue;
      const list = sides.get(side) ?? [];
      list.push(row);
      sides.set(side, list);
    }
    for (const [side, list] of sides) {
      const count = list.length;
      list.forEach((row, index) => {
        row.cumulative = { group: side, index: side === "ask" ? count - 1 - index : index };
      });
    }
  }
  var binanceAdapter = {
    id: "binance",
    cacheMs: 300,
    locate(doc) {
      const rows = locateRows(doc, { rows: ROW_SELECTORS, scopes: SCOPE_SELECTORS });
      if (rows)
        markCumulative(rows);
      return rows;
    }
  };

  // src/lib/exchanges/gate.ts
  var SCOPES = [
    '[id*="market-list" i]',
    '[class*="orderbook" i]',
    '[class*="order-book" i]',
    '[class*="order_book" i]',
    '[class*="entrust" i]',
    '[class*="trade-grid" i]',
    '[id*="orderbook" i]'
  ];
  function rowsIn(scope, minRows) {
    return chooseRows(detectRowGroups(scope, { minRows, maxNodes: 12000 }));
  }
  var gateAdapter = {
    id: "gate",
    cacheMs: 500,
    locate(doc) {
      let single = null;
      for (const selector of SCOPES) {
        let nodes;
        try {
          nodes = doc.querySelectorAll(selector);
        } catch {
          continue;
        }
        for (const scope of nodes) {
          if (scope === doc.body || scope === doc.documentElement)
            continue;
          const rows = rowsIn(scope, 2);
          if (rows.length >= 2)
            return rows;
          if (!single && rows.length === 1)
            single = rows;
        }
      }
      if (single)
        return single;
      return rowsIn(doc.body, 2);
    }
  };

  // src/lib/exchanges/generic.ts
  var genericAdapter = {
    id: "generic",
    cacheMs: 800,
    locate(doc) {
      const scope = doc.body;
      if (!scope)
        return null;
      const rows = chooseRows(detectRowGroups(scope, { minRows: 3, maxNodes: 25000, maxLeaves: 2000 }));
      return rows.length ? rows : null;
    }
  };

  // src/lib/exchanges/kucoin.ts
  var ROW_SELECTORS2 = [
    '[class*="ReactVirtualized__Grid__innerScrollContainer" i] > div',
    '[class*="orderbook-row" i]',
    '[class*="orderbook-item" i]',
    '[class*="orderBookItem" i]'
  ];
  var SCOPE_SELECTORS2 = [
    '[class*="orderbook-content" i]',
    '[class*="order-book" i]',
    '[class*="orderbook" i]'
  ];
  var kucoinAdapter = {
    id: "kucoin",
    cacheMs: 300,
    locate(doc) {
      const positional = rowsByPosition(doc, ROW_SELECTORS2);
      if (positional)
        return positional;
      return locateRows(doc, { rows: [], scopes: SCOPE_SELECTORS2 });
    }
  };

  // src/lib/exchanges/mexc.ts
  var ITEM_SELECTORS = [
    '[class*="orderbookItem" i]',
    '[class*="orderbook-item" i]',
    '[class*="orderBookItem" i]'
  ];
  var BOX_SELECTORS = [
    '[class*="asksBox" i]',
    '[class*="bidsBox" i]',
    '[class*="asks" i]',
    '[class*="bids" i]'
  ];
  function locateItems(doc) {
    for (const selector of ITEM_SELECTORS) {
      let items;
      try {
        items = doc.querySelectorAll(selector);
      } catch {
        continue;
      }
      if (items.length === 0)
        continue;
      const rows = [];
      for (const item of items) {
        const row = rowTriple(item);
        if (row)
          rows.push(row);
      }
      if (rows.length > 0)
        return rows;
    }
    return [];
  }
  function locateBoxes(doc) {
    const groups = [];
    for (const selector of BOX_SELECTORS) {
      let boxes;
      try {
        boxes = doc.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const box of boxes) {
        for (const group of detectRowGroups(box, { minRows: 2, maxNodes: 3000 }))
          groups.push(group);
      }
    }
    return chooseRows(groups);
  }
  var mexcAdapter = {
    id: "mexc",
    cacheMs: 300,
    locate(doc) {
      const items = locateItems(doc);
      if (items.length > 0)
        return items;
      const boxes = locateBoxes(doc);
      if (boxes.length > 0)
        return boxes;
      const rows = detectRows(doc.body, 2);
      return rows.length > 0 ? rows : null;
    }
  };

  // src/lib/exchanges/index.ts
  var ADAPTERS = {
    gate: gateAdapter,
    mexc: mexcAdapter,
    binance: binanceAdapter,
    kucoin: kucoinAdapter,
    generic: genericAdapter
  };
  function adapterFor(site = detectSite()) {
    return ADAPTERS[site] ?? genericAdapter;
  }

  // src/lib/orderbook.ts
  var COLOR_RE = /^(#[0-9a-f]{3,8}|[a-z]{3,24}|rgba?\([\d.,%\s/]+\)|hsla?\([\d.,%\s/]+\))$/i;
  function sanitizeColor(value) {
    if (!value)
      return "";
    const candidate = String(value).trim();
    return COLOR_RE.test(candidate) ? candidate : "";
  }
  var LAYER = "tc-idr-layer";
  var VOLUME_IDR = "tc-idr-volume";
  var BADGE_BASE_STYLE = [
    "position:absolute",
    "font-weight:400",
    "white-space:nowrap",
    "letter-spacing:0",
    "display:inline-block",
    "pointer-events:none",
    "user-select:none",
    "font-variant-numeric:tabular-nums",
    "z-index:1"
  ];
  var VOLUME_CSS = [
    "[data-tc-total],[data-tc-total] *{color:transparent!important}",
    '[data-tc-host] [class*="totalText"]{color:transparent!important}',
    '[data-tc-host] [class*="__amount"] span{color:transparent!important}'
  ].join(`
`);
  var LAYER_STYLE = [
    "position:absolute",
    "left:0",
    "top:0",
    "width:0",
    "height:0",
    "overflow:visible",
    "pointer-events:none",
    "z-index:1"
  ].join(";");
  var metricsCache = new WeakMap;
  var METRICS_TTL = 1500;
  var widthEpoch = 0;
  if (typeof window !== "undefined") {
    window.addEventListener("resize", () => {
      widthEpoch += 1;
    }, { passive: true });
  }
  var canvasCtx;
  function measureText(text, font) {
    if (!text)
      return 0;
    if (canvasCtx === undefined) {
      try {
        canvasCtx = document.createElement("canvas").getContext("2d");
      } catch {
        canvasCtx = null;
      }
    }
    if (!canvasCtx)
      return text.length * 7;
    canvasCtx.font = font;
    return canvasCtx.measureText(text).width;
  }
  function metricsFor(cell) {
    const now = Date.now();
    const cached = metricsCache.get(cell);
    if (cached && cached.epoch === widthEpoch && now - cached.at < METRICS_TTL)
      return cached;
    let style;
    try {
      style = getComputedStyle(cell);
    } catch {
      return null;
    }
    const fontPx = parseFloat(style.fontSize) || 12;
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const contentWidth = cell.clientWidth - padding;
    if (!(contentWidth > 0))
      return null;
    const metrics = {
      contentWidth,
      paddingLeft: parseFloat(style.paddingLeft) || 0,
      paddingRight: parseFloat(style.paddingRight) || 0,
      fontPx,
      weight: style.fontWeight || "400",
      family: style.fontFamily || "sans-serif",
      color: style.color || "inherit",
      position: style.position || "static",
      epoch: widthEpoch,
      at: now
    };
    metricsCache.set(cell, metrics);
    return metrics;
  }
  function fontFor(metrics, em) {
    return `${metrics.weight} ${Math.max(8, metrics.fontPx * em).toFixed(2)}px ${metrics.family}`;
  }
  var textWidthCache = new WeakMap;
  function elementTextWidth(el, text, fallbackFont) {
    const cached = textWidthCache.get(el);
    if (cached && cached.text === text)
      return cached.width;
    let width = 0;
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE)
        continue;
      if (!(node.textContent ?? "").trim())
        continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      width += range.getBoundingClientRect().width;
    }
    if (!width)
      width = measureText(text, fallbackFont);
    textWidthCache.set(el, { text, width });
    return width;
  }
  function choosePriceText(full, compact, available, priceMetrics, fit) {
    const tight = compact.replace(/\s+/g, "");
    if (!fit || !priceMetrics)
      return { text: full, fontEm: 1 };
    const tiers = [
      { text: full, em: 1 },
      { text: compact, em: 1 },
      { text: tight, em: 1 },
      { text: tight, em: 0.85 }
    ];
    const SAFETY = 4;
    for (const tier of tiers) {
      const width = measureText(tier.text, fontFor(priceMetrics, tier.em)) + SAFETY;
      if (width <= available)
        return { text: tier.text, fontEm: tier.em };
    }
    const last = tiers[tiers.length - 1];
    return { text: last?.text ?? tight, fontEm: last?.em ?? 0.85 };
  }
  function chooseVolumeText(full, compact, metrics, fit) {
    if (!fit || !metrics)
      return full;
    const font = fontFor(metrics, 1);
    const available = metrics.contentWidth - 2;
    if (measureText(full, font) <= available)
      return full;
    if (measureText(compact, font) <= available)
      return compact;
    return compact.replace(/\s+/g, "");
  }
  var overlays = new Map;
  var layers = new Set;
  var markedHosts = new Set;
  var hostPositions = new WeakSet;
  var volumeStyle = null;
  function ensureVolumeCss() {
    if (volumeStyle && volumeStyle.isConnected)
      return;
    volumeStyle = document.createElement("style");
    volumeStyle.className = INJECTED;
    volumeStyle.textContent = VOLUME_CSS;
    (document.head ?? document.documentElement).appendChild(volumeStyle);
  }
  function markHost(host) {
    if (!hostPositions.has(host)) {
      hostPositions.add(host);
      try {
        if (getComputedStyle(host).position === "static")
          host.style.position = "relative";
      } catch {}
    }
    if (host.getAttribute("data-tc-host") !== "1")
      host.setAttribute("data-tc-host", "1");
    markedHosts.add(host);
  }
  function layerFor(host) {
    const existing = host.querySelector(":scope > ." + LAYER);
    if (existing)
      return existing;
    const layer = document.createElement("div");
    layer.className = `${INJECTED} ${LAYER}`;
    layer.setAttribute("aria-hidden", "true");
    layer.setAttribute("style", LAYER_STYLE);
    host.appendChild(layer);
    layers.add(layer);
    if (!hostPositions.has(host)) {
      hostPositions.add(host);
      try {
        if (getComputedStyle(host).position === "static")
          host.style.position = "relative";
      } catch {}
    }
    return layer;
  }
  function detach(entry, kind) {
    if (kind !== "volume") {
      entry.price?.remove();
      entry.price = null;
    }
    if (kind !== "price") {
      entry.volume?.remove();
      entry.volume = null;
      if (entry.totalCell) {
        entry.totalCell.removeAttribute("data-tc-total");
        entry.totalCell = null;
      }
    }
  }
  function overlayFor(rowEl, host) {
    let entry = overlays.get(rowEl);
    if (entry && entry.host !== host) {
      detach(entry);
      entry = undefined;
    }
    if (!entry) {
      entry = { host, layer: layerFor(host), price: null, volume: null, totalCell: null };
      overlays.set(rowEl, entry);
    }
    return entry;
  }
  function makeBadge(entry, kind) {
    const existing = kind === "price" ? entry.price : entry.volume;
    if (existing && existing.isConnected)
      return existing;
    const badge = document.createElement("span");
    badge.className = `${INJECTED} ${kind === "price" ? PRICE_IDR : VOLUME_IDR}`;
    badge.setAttribute("aria-hidden", "true");
    entry.layer.appendChild(badge);
    if (kind === "price")
      entry.price = badge;
    else
      entry.volume = badge;
    return badge;
  }
  function cleanupOverlays(keep, keepPrice, keepVolume) {
    for (const [rowEl, entry] of overlays) {
      if (!keep.has(rowEl) || !rowEl.isConnected) {
        detach(entry);
        overlays.delete(rowEl);
        continue;
      }
      if (!keepPrice.has(rowEl))
        detach(entry, "price");
      if (!keepVolume.has(rowEl))
        detach(entry, "volume");
    }
    for (const host of markedHosts) {
      let used = false;
      for (const entry of overlays.values()) {
        if (entry.host === host && entry.volume) {
          used = true;
          break;
        }
      }
      if (!used) {
        host.removeAttribute("data-tc-host");
        markedHosts.delete(host);
      }
    }
    for (const layer of layers) {
      if (!layer.isConnected) {
        layers.delete(layer);
        continue;
      }
      if (layer.childElementCount === 0) {
        layer.remove();
        layers.delete(layer);
      }
    }
  }
  function clearOverlays() {
    for (const entry of overlays.values())
      detach(entry);
    overlays.clear();
    for (const layer of layers)
      layer.remove();
    layers.clear();
    for (const host of markedHosts)
      host.removeAttribute("data-tc-host");
    markedHosts.clear();
    volumeStyle?.remove();
    volumeStyle = null;
  }
  function hostFor(row, rowElements) {
    let node = row.parentElement;
    for (let depth = 0;node && depth < 8; depth += 1, node = node.parentElement) {
      let found = 0;
      for (const el of rowElements) {
        if (found >= 2)
          break;
        if (node.contains(el))
          found += 1;
      }
      if (found >= 2)
        return node;
    }
    return row.parentElement ?? document.body;
  }
  function applyCumulativeTotals(rows) {
    const groups = new Map;
    for (const row of rows) {
      if (!row.cumulative)
        continue;
      const list = groups.get(row.cumulative.group) ?? [];
      list.push(row);
      groups.set(row.cumulative.group, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => (a.cumulative?.index ?? 0) - (b.cumulative?.index ?? 0));
      let sum = 0;
      for (const row of list) {
        const own = row.totalValue ?? parseNumber(siteText(row.total.el));
        if (own == null || own <= 0)
          continue;
        sum += own;
        row.totalValue = sum;
      }
    }
  }
  function planRows(rows, rate, config) {
    const prices = [];
    const volumes = [];
    const rowElements = rows.map((row) => row.row);
    const hosts = new Map;
    const hostOf = (row) => {
      const existing = hosts.get(row.row);
      if (existing)
        return existing;
      const host = hostFor(row.row, rowElements);
      hosts.set(row.row, host);
      return host;
    };
    for (const row of rows) {
      const priceText = siteText(row.price.el);
      const price = parseNumber(priceText);
      if (config.showPrice && price != null && price > 0) {
        const idr = price * rate;
        const full = formatIdr(idr, {
          prefix: config.prefix,
          mode: config.priceMode,
          precision: "price"
        });
        const fullTitle = formatIdr(idr, { prefix: config.prefix, mode: config.priceMode });
        const compact = formatIdr(idr, { prefix: config.prefix, mode: "compact" });
        const priceMetrics = metricsFor(row.priceCell);
        const amountText = row.amount ? siteText(row.amount.el) : null;
        const amountMetrics = row.amountCell ? metricsFor(row.amountCell) : null;
        const priceTextWidth = priceMetrics ? elementTextWidth(row.price.el, priceText, fontFor(priceMetrics, 1)) : 0;
        const amountTextWidth = amountMetrics && amountText && row.amount ? elementTextWidth(row.amount.el, amountText, fontFor(amountMetrics, 1)) : 0;
        const priceRect = row.priceCell.getBoundingClientRect();
        const amountRect = row.amountCell ? row.amountCell.getBoundingClientRect() : null;
        const priceTextRight = priceRect.left + (priceMetrics?.paddingLeft ?? 0) + priceTextWidth;
        const amountTextLeft = amountRect && amountMetrics ? amountRect.right - amountMetrics.paddingRight - amountTextWidth : priceRect.right;
        const gap = 4;
        const choice = choosePriceText(full, compact, amountTextLeft - priceTextRight - gap, priceMetrics, config.fit);
        prices.push({
          rowEl: row.row,
          host: hostOf(row),
          cell: row.priceCell,
          text: choice.text,
          full: fullTitle,
          fontPx: (priceMetrics?.fontPx ?? 12) * choice.fontEm,
          left: priceTextRight + gap
        });
      }
      if (config.convertTotal) {
        const total = row.totalValue ?? parseNumber(siteText(row.total.el));
        if (total == null || total <= 0)
          continue;
        const idr = total * rate;
        const full = formatIdr(idr, { prefix: config.prefix, mode: config.volumeMode });
        const compact = formatIdr(idr, { prefix: config.prefix, mode: "compact" });
        const metrics = metricsFor(row.totalCell);
        const text = chooseVolumeText(full, compact, metrics, config.fit);
        volumes.push({
          rowEl: row.row,
          host: hostOf(row),
          cell: row.totalCell,
          text,
          full,
          fontPx: metrics?.fontPx ?? 12,
          textWidth: metrics ? measureText(text, fontFor(metrics, 1)) : text.length * 7,
          color: sanitizeColor(config.volumeColor) || metrics?.color || "inherit"
        });
      }
    }
    return { prices, volumes };
  }
  function styleFor(left, top, height, fontPx, color, opacity) {
    return [
      ...BADGE_BASE_STYLE,
      `left:${Math.round(left)}px`,
      `top:${Math.round(top)}px`,
      `height:${Math.round(height)}px`,
      `line-height:${Math.round(height)}px`,
      `font-size:${fontPx.toFixed(2)}px`,
      `color:${color}`,
      `opacity:${opacity}`
    ].join(";");
  }
  function paint(badge, style, text, full) {
    if (badge.dataset["tcStyle"] !== style) {
      badge.dataset["tcStyle"] = style;
      badge.setAttribute("style", `${style};display:inline-block`);
    } else if (badge.style.display === "none") {
      badge.style.display = "inline-block";
    }
    if (badge.textContent !== text)
      badge.textContent = text;
    if (badge.getAttribute("title") !== full)
      badge.setAttribute("title", full);
  }
  function applyOverlays(prices, volumes, config) {
    const keep = new Set;
    const keepPrice = new Set;
    const keepVolume = new Set;
    const pricePlaced = [];
    const volumePlaced = [];
    for (const write of prices) {
      keep.add(write.rowEl);
      keepPrice.add(write.rowEl);
      const entry = overlayFor(write.rowEl, write.host);
      pricePlaced.push({ write, entry, badge: makeBadge(entry, "price") });
    }
    for (const write of volumes) {
      keep.add(write.rowEl);
      keepVolume.add(write.rowEl);
      const entry = overlayFor(write.rowEl, write.host);
      const badge = makeBadge(entry, "volume");
      ensureVolumeCss();
      markHost(write.host);
      if (entry.totalCell !== write.cell) {
        entry.totalCell?.removeAttribute("data-tc-total");
        entry.totalCell = write.cell;
      }
      if (write.cell.getAttribute("data-tc-total") !== "1")
        write.cell.setAttribute("data-tc-total", "1");
      volumePlaced.push({ write, entry, badge });
    }
    cleanupOverlays(keep, keepPrice, keepVolume);
    const pricePositions = pricePlaced.map((item) => ({
      ...item,
      cellRect: item.write.cell.getBoundingClientRect(),
      layerRect: item.entry.layer.getBoundingClientRect()
    }));
    const volumePositions = volumePlaced.map((item) => ({
      ...item,
      cellRect: item.write.cell.getBoundingClientRect(),
      layerRect: item.entry.layer.getBoundingClientRect()
    }));
    const priceColor = sanitizeColor(config.priceColor);
    for (const { write, badge, cellRect, layerRect } of pricePositions) {
      if (cellRect.width <= 0 || cellRect.height <= 0) {
        badge.style.display = "none";
        continue;
      }
      const style = styleFor(write.left - layerRect.left, cellRect.top - layerRect.top, cellRect.height, write.fontPx, priceColor || "inherit", priceColor ? "1" : "0.75");
      paint(badge, style, write.text, write.full);
    }
    for (const { write, badge, cellRect, layerRect } of volumePositions) {
      if (cellRect.width <= 0 || cellRect.height <= 0) {
        badge.style.display = "none";
        continue;
      }
      const width = write.textWidth + 2;
      const style = styleFor(cellRect.right - layerRect.left - width - 2, cellRect.top - layerRect.top, cellRect.height, write.fontPx, write.color, "1");
      paint(badge, style, write.text, write.full);
    }
  }
  function describeOrderbook(site) {
    const adapter = adapterFor(site);
    const rows = adapter.locate(document) ?? [];
    return {
      adapter: adapter.id,
      rows: rows.length,
      sample: rows.slice(0, 3).map((row) => {
        const amount = row.amount ? siteText(row.amount.el) : "?";
        return `${siteText(row.price.el)} × ${amount} = ${siteText(row.total.el)}`;
      })
    };
  }
  function startOrderbook(options) {
    const adapter = adapterFor(options.site);
    let rows = null;
    let locatedAt = 0;
    let observer = null;
    let debounce = null;
    let heartbeat = null;
    let stopped = false;
    const locate = () => {
      const found = adapter.locate(document) ?? [];
      const merged = new Map;
      for (const row of rows ?? []) {
        if (row.row.isConnected)
          merged.set(row.row, row);
      }
      for (const row of found)
        merged.set(row.row, row);
      rows = merged.size > 0 ? [...merged.values()] : null;
      locatedAt = Date.now();
    };
    const tick = () => {
      if (stopped)
        return;
      const stale = !rows || rows.length === 0 || Date.now() - locatedAt > adapter.cacheMs || rows.some((row) => !row.row.isConnected);
      if (stale)
        locate();
      if (!rows || rows.length === 0)
        return;
      const current = [];
      for (const row of rows) {
        const fresh = refreshRow(row);
        if (fresh)
          current.push(fresh);
      }
      if (current.length === 0)
        return;
      applyCumulativeTotals(current);
      const config = options.getConfig();
      const plan = planRows(current, options.getRate(), config);
      applyOverlays(plan.prices, plan.volumes, config);
    };
    const schedule = (delay = 120) => {
      if (stopped || debounce !== null)
        return;
      debounce = setTimeout(() => {
        debounce = null;
        tick();
      }, delay);
    };
    const start = () => {
      observer = new MutationObserver(() => schedule(60));
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      document.addEventListener("scroll", () => schedule(0), { capture: true, passive: true });
      window.addEventListener("resize", () => schedule(0), { passive: true });
      locate();
      tick();
      heartbeat = setInterval(tick, 500);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
    return {
      rescan: () => {
        rows = null;
        locatedAt = 0;
        schedule(0);
      },
      stop: () => {
        stopped = true;
        if (debounce)
          clearTimeout(debounce);
        if (heartbeat)
          clearInterval(heartbeat);
        observer?.disconnect();
        clearOverlays();
      }
    };
  }

  // src/lib/bybit.ts
  var ROWS = 8;
  var WIDTH = 318;
  var POLL_FALLBACK_MS = 4000;
  var POLL_INTERVAL_MS = 3000;
  var COLLAPSE_KEY = "ui.bybit.collapsed";
  var installed = false;
  var latest = null;
  var restDepth = null;
  var listeners2 = new Set;
  function ingest(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b))
      return;
    const asks = a.filter((row) => Array.isArray(row) && row.length >= 2);
    const bids = b.filter((row) => Array.isArray(row) && row.length >= 2);
    if (!asks.length && !bids.length)
      return;
    latest = { a: asks, b: bids, at: Date.now() };
    for (const listener of listeners2)
      listener();
  }
  function installBybitDepthHook() {
    if (installed)
      return;
    if (typeof Worker === "undefined")
      return;
    installed = true;
    try {
      const proto = Worker.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "onmessage");
      if (!descriptor?.get || !descriptor.set)
        return;
      Object.defineProperty(proto, "onmessage", {
        configurable: true,
        enumerable: descriptor.enumerable ?? true,
        get: descriptor.get,
        set(handler) {
          const wrapped = function(event) {
            try {
              const message = event?.data;
              if (message && message.topic === "spot.ob_") {
                const data = message.data?.data ?? message.data;
                ingest(data?.a, data?.b);
              }
            } catch {}
            return typeof handler === "function" ? handler.call(this, event) : undefined;
          };
          return descriptor.set?.call(this, wrapped);
        }
      });
    } catch {}
  }
  var CSS = `
:host { all: initial; }
.panel {
  position: fixed;
  z-index: 2147483000;
  width: 318px;
  display: flex;
  flex-direction: column;
  font: 12px/1.4 Inter, Arial, ui-sans-serif, system-ui, sans-serif;
  color: #e6edf3;
  background: #0e0f13;
  border: 1px solid #24262d;
  border-radius: 6px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  user-select: none;
}
.panel[data-collapsed="true"] .cols,
.panel[data-collapsed="true"] .rows { display: none; }
.head {
  display: flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 8px; flex: none;
  background: #12141a; border-bottom: 1px solid #1c1e24;
  cursor: default;
}
.title { font-weight: 600; color: #c9d1d9; letter-spacing: 0.02em; }
.pair { color: #8b949e; font-size: 11px; }
.grow { flex: 1; }
.icon {
  all: unset; cursor: pointer; padding: 0 4px; border-radius: 4px;
  color: #8b949e; font-size: 13px; line-height: 1;
}
.icon:hover { color: #e6edf3; background: rgba(255,255,255,0.08); }
.rate { color: #6e7681; font-size: 10px; }
.cols {
  display: grid; grid-template-columns: 1fr 88px 96px; gap: 0 4px;
  padding: 3px 8px; flex: none;
  color: #6e7681; font-size: 10px; border-bottom: 1px solid #1c1e24;
}
.cols span:nth-child(2), .cols span:nth-child(3) { text-align: right; }
.rows { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
.sell, .buy { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.row {
  position: relative; flex: 1; min-height: 0;
  display: grid; grid-template-columns: 1fr 88px 96px; gap: 0 4px;
  align-items: center; padding: 0 8px; overflow: hidden;
}
.row .depth {
  position: absolute; right: 0; top: 0; height: 100%;
  opacity: 0.22; z-index: 1; transition: width 0.15s ease-out;
}
.row.sell .depth { background: #ef454a; }
.row.buy .depth { background: #20b26c; }
.row .v { position: relative; z-index: 2; font-variant-numeric: tabular-nums; white-space: nowrap; }
.row .v.price { color: #ead05a; }
.row .v.qty, .row .v.total { color: #ead05a; text-align: right; }
.mid {
  flex: none; display: flex; align-items: baseline; gap: 8px;
  padding: 6px 8px; margin: 1px 0;
  border-top: 1px solid #24262d; border-bottom: 1px solid #24262d;
}
.mid .cur { color: #ebd61e; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.mid .src { margin-left: auto; color: #6e7681; font-size: 10px; }
.empty { padding: 8px; color: #6e7681; font-size: 11px; }
`;
  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  var currency = (value) => formatIdr(value, { prefix: "", decimals: 2 });
  var compact = (value) => formatIdr(value, { mode: "compact" });
  function convertSide(levels, rate, side) {
    const top = levels.slice(0, ROWS);
    let cumulative = 0;
    const rows = top.map(([priceRaw, qtyRaw]) => {
      const price = num(priceRaw);
      const qty = num(qtyRaw);
      cumulative += qty;
      const priceIdr = price * rate;
      const totalIdr = cumulative * priceIdr;
      return {
        price: currency(priceIdr),
        qty: compact(qty * priceIdr),
        total: compact(totalIdr),
        raw: totalIdr
      };
    });
    let max = 0;
    for (const row of rows)
      max = Math.max(max, row.raw);
    const converted = rows.map(({ raw, ...row }) => ({ ...row, pct: max > 0 ? raw / max * 100 : 0 }));
    return side === "sell" ? converted.reverse() : converted;
  }
  function mountBybitBook() {
    const host = document.createElement("div");
    host.id = "tradecat-book-host";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
    <div class="head">
      <span class="title">Converted IDR</span>
      <span class="pair">—</span>
      <span class="grow"></span>
      <span class="rate"></span>
      <button class="icon" data-act="refresh" title="Refresh">↻</button>
      <button class="icon" data-act="collapse" title="Collapse">−</button>
    </div>
    <div class="cols"><span>Price (IDR)</span><span>Qty (IDR)</span><span>Total (IDR)</span></div>
    <div class="rows">
      <div class="sell"></div>
      <div class="mid"><span class="cur">—</span><span class="src"></span></div>
      <div class="buy"></div>
    </div>`;
    shadow.append(style, panel);
    const $ = (selector) => panel.querySelector(selector);
    const pairEl = $(".pair");
    const rateEl = $(".rate");
    const sellEl = $(".sell");
    const buyEl = $(".buy");
    const curEl = $(".mid .cur");
    const srcEl = $(".mid .src");
    const sellRows = Array.from({ length: ROWS }, () => makeRow("sell"));
    const buyRows = Array.from({ length: ROWS }, () => makeRow("buy"));
    sellEl.append(...sellRows.map((row) => row.el));
    buyEl.append(...buyRows.map((row) => row.el));
    let stopped = false;
    let scheduled = false;
    let pollTimer = null;
    let fallbackTimer = null;
    let anchorTimer = null;
    let base = "";
    let quote = "";
    function makeRow(kind) {
      const el = document.createElement("div");
      el.className = `row ${kind}`;
      const depth = document.createElement("div");
      depth.className = "depth";
      const price = document.createElement("span");
      price.className = "v price";
      price.textContent = "—";
      const qty = document.createElement("span");
      qty.className = "v qty";
      qty.textContent = "—";
      const total = document.createElement("span");
      total.className = "v total";
      total.textContent = "—";
      el.append(depth, price, qty, total);
      return { el, depth, price, qty, total };
    }
    const writeSide = (rows, converted) => {
      rows.forEach((row, index) => {
        const data = converted[index];
        if (!data) {
          row.el.style.display = "none";
          return;
        }
        row.el.style.display = "grid";
        row.price.textContent = data.price;
        row.qty.textContent = data.qty;
        row.total.textContent = data.total;
        row.depth.style.width = `${data.pct}%`;
        row.el.title = `${data.price} · ${data.qty} · ${data.total}`;
      });
    };
    const render = () => {
      if (stopped)
        return;
      const depth = latest ?? restDepth;
      const rate = currentRate().rate;
      pairEl.textContent = base && quote ? `${base}/${quote}` : "—";
      rateEl.textContent = rate > 0 ? `1 USDT = ${formatIdr(rate, { mode: "full", prefix: "Rp. " })}` : "rate not set";
      if (!depth || rate <= 0) {
        for (const row of [...sellRows, ...buyRows])
          row.el.style.display = "none";
        curEl.textContent = "—";
        srcEl.textContent = depth ? "USDT/IDR rate not set" : "waiting for depth…";
        return;
      }
      const sell = convertSide(depth.a, rate, "sell");
      const buy = convertSide(depth.b, rate, "buy");
      writeSide(sellRows, sell);
      writeSide(buyRows, buy);
      const bestAsk = num(depth.a[0]?.[0]);
      const bestBid = num(depth.b[0]?.[0]);
      const mid = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : bestAsk || bestBid;
      curEl.textContent = mid > 0 ? currency(mid * rate) : "—";
      srcEl.textContent = latest ? "live worker" : "rest fallback";
    };
    const schedule = () => {
      if (scheduled || stopped)
        return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        render();
      });
    };
    const onDepth = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      restDepth = null;
      schedule();
    };
    const bybitSymbol = () => `${base}${quote}`;
    const loadRest = async () => {
      if (stopped || !base)
        return;
      try {
        const body = await requestJson(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${encodeURIComponent(bybitSymbol())}&limit=50`, 1e4);
        const result = body?.result;
        if (!result || latest)
          return;
        restDepth = { a: result.a ?? [], b: result.b ?? [], at: Date.now() };
        schedule();
      } catch {}
    };
    const startFallback = () => {
      if (pollTimer || latest || stopped)
        return;
      loadRest();
      pollTimer = setInterval(() => void loadRest(), POLL_INTERVAL_MS);
    };
    const anchor = () => {
      if (stopped)
        return;
      const area = document.querySelector("#orderBookArea") ?? document.querySelector(".order-book-area");
      const rect = area?.getBoundingClientRect();
      if (!rect || rect.width < 100 || rect.height < 80) {
        panel.style.left = "auto";
        panel.style.top = "auto";
        panel.style.right = "14px";
        panel.style.bottom = "14px";
        panel.style.height = "420px";
        return;
      }
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.top = `${Math.round(rect.top)}px`;
      const height = Math.max(280, Math.min(rect.height, window.innerHeight - rect.top - 8));
      panel.style.height = `${Math.round(height)}px`;
      const left = rect.left - WIDTH - 6;
      panel.style.left = `${Math.round(left >= 8 ? left : Math.max(8, rect.right + 6))}px`;
    };
    const syncPair = () => {
      const pair = currentPair();
      if (!pair) {
        host.style.display = "none";
        return;
      }
      host.style.display = "";
      if (pair.base === base && pair.quote === quote)
        return;
      base = pair.base;
      quote = pair.quote;
      latest = null;
      restDepth = null;
      schedule();
      if (fallbackTimer)
        clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(startFallback, POLL_FALLBACK_MS);
    };
    panel.addEventListener("click", (event) => {
      const target = event.target.closest("[data-act]");
      if (!target)
        return;
      const action = target.dataset["act"];
      if (action === "refresh") {
        loadRest();
        schedule();
      }
      if (action === "collapse") {
        const collapsed = panel.dataset["collapsed"] !== "true";
        panel.dataset["collapsed"] = String(collapsed);
        target.textContent = collapsed ? "+" : "−";
        setStored(COLLAPSE_KEY, collapsed);
      }
    });
    const mount = () => {
      if (!document.body) {
        requestAnimationFrame(mount);
        return;
      }
      document.body.appendChild(host);
      if (getStored(COLLAPSE_KEY, false)) {
        panel.dataset["collapsed"] = "true";
        $('[data-act="collapse"]').textContent = "+";
      }
      syncPair();
      anchor();
      listeners2.add(onDepth);
      window.addEventListener("resize", anchor, { passive: true });
      anchorTimer = setInterval(anchor, 800);
      if (fallbackTimer)
        clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(startFallback, POLL_FALLBACK_MS);
      schedule();
    };
    mount();
    return {
      refresh: () => {
        syncPair();
        anchor();
        schedule();
      },
      destroy: () => {
        stopped = true;
        listeners2.delete(onDepth);
        window.removeEventListener("resize", anchor);
        if (pollTimer)
          clearInterval(pollTimer);
        if (fallbackTimer)
          clearTimeout(fallbackTimer);
        if (anchorTimer)
          clearInterval(anchorTimer);
        host.remove();
      },
      describe: () => {
        const depth = latest ?? restDepth;
        const rows = depth ? Math.min(depth.a.length, ROWS) + Math.min(depth.b.length, ROWS) : 0;
        const sample = sellRows[ROWS - 1]?.el.textContent?.trim().replace(/\s+/g, " ") ?? "";
        return { adapter: "bybit:converted-book", rows, sample: sample ? [sample] : [] };
      }
    };
  }

  // src/lib/simple.ts
  var POS_KEY = "ui.simple.pos";
  var COLLAPSE_KEY2 = "ui.simple.collapsed";
  var FEE_TTL = 10 * 60 * 1000;
  var TICKER_MS = 15000;
  var CSS2 = `
:host { all: initial; }
.panel {
  position: fixed;
  z-index: 2147482999;
  min-width: 216px;
  max-width: 280px;
  font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #e6edf3;
  background: rgba(13, 17, 23, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  overflow: hidden;
  user-select: none;
}
.panel.pos-bottom-left { left: 14px; bottom: 14px; }
.panel.pos-bottom-right { right: 14px; bottom: 14px; }
.panel.pos-top-left { left: 14px; top: 70px; }
.panel.pos-top-right { right: 14px; top: 70px; }
.head { display: flex; align-items: center; gap: 4px; padding: 6px 8px; cursor: move; background: rgba(255, 255, 255, 0.04); }
.coin { font-weight: 700; letter-spacing: 0.02em; }
.quote { color: #8b949e; font-size: 11px; }
.grow { flex: 1; }
.icon { all: unset; cursor: pointer; padding: 0 4px; border-radius: 4px; color: #8b949e; font-size: 13px; line-height: 1; }
.icon:hover { color: #e6edf3; background: rgba(255, 255, 255, 0.08); }
.body { padding: 8px; display: flex; flex-direction: column; gap: 5px; }
.panel[data-collapsed="true"] .body { display: none; }
.line { display: flex; align-items: baseline; gap: 8px; }
.line .k { color: #8b949e; font-size: 11px; white-space: nowrap; }
.line .v { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.line .v.price { color: #e6edf3; }
.line .v.margin { color: #ead05a; }
.line .v.fee { color: #ead05a; }
.line .net { color: #c9d1d9; font-weight: 600; }
.hint { color: #d29922; font-size: 10px; line-height: 1.35; }
.hint:empty { display: none; }
.foot { display: flex; gap: 6px; align-items: center; font-size: 10px; color: #6e7681; }
.foot .retry { all: unset; cursor: pointer; color: #58a6ff; margin-left: auto; }
`;
  var feeKey = (coin) => `indodax.fee.${coin}`;
  function parseFeePage(html) {
    if (typeof DOMParser !== "function")
      return { network: null, fee: null, needsLogin: false, at: Date.now() };
    const doc = new DOMParser().parseFromString(html, "text/html");
    const feeNode = doc.querySelector("#withdraw_fee_value");
    const netNode = doc.querySelector("#withdraw_network");
    const network = (netNode?.selectedOptions?.[0]?.textContent ?? netNode?.value ?? netNode?.textContent ?? "").trim() || null;
    const feeText = (feeNode?.textContent ?? "").replace(/\s+/g, " ").trim();
    const fee = feeText ? parseNumber(feeText) : null;
    return { network, fee, needsLogin: !feeNode, at: Date.now() };
  }
  async function fetchFeePage(coin) {
    if (typeof fetch === "function" && /(^|\.)indodax\.com$/.test(location.hostname)) {
      try {
        const response = await fetch(`/finance/${encodeURIComponent(coin)}`, { credentials: "same-origin" });
        if (response.ok)
          return response.text();
      } catch {}
    }
    return requestText(`https://indodax.com/finance/${encodeURIComponent(coin)}`, 15000);
  }
  async function readFee(coin, force) {
    const cached = getStored(feeKey(coin), null);
    if (!force && cached && Date.now() - cached.at < FEE_TTL)
      return cached;
    try {
      const html = await fetchFeePage(coin);
      const info = parseFeePage(html);
      setStored(feeKey(coin), info);
      return info;
    } catch (error) {
      log("indodax finance failed", error);
      return cached ?? { network: null, fee: null, needsLogin: true, at: Date.now() };
    }
  }
  function mountSimpleHud(options) {
    const host = document.createElement("div");
    host.id = "tradecat-simple-host";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS2;
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
    <div class="head">
      <span class="coin">—</span>
      <span class="quote"></span>
      <span class="grow"></span>
      <button class="icon" data-act="refresh" title="Refresh fee">↻</button>
      <button class="icon" data-act="collapse" title="Collapse">−</button>
    </div>
    <div class="body">
      <div class="line"><span class="k">Harga</span><span class="v price">—</span></div>
      <div class="line"><span class="k">Selisih 1%</span><span class="v margin">—</span></div>
      <div class="line"><span class="k">Fee <span class="net"></span></span><span class="v fee">—</span></div>
      <div class="hint"></div>
    </div>
    <div class="foot"><span class="status"></span><button class="retry" data-act="refresh">retry</button></div>`;
    shadow.append(style, panel);
    const $ = (selector) => panel.querySelector(selector);
    const coinEl = $(".coin");
    const quoteEl = $(".quote");
    const priceEl = $(".v.price");
    const marginEl = $(".v.margin");
    const feeEl = $(".v.fee");
    const netEl = $(".net");
    const hintEl = $(".hint");
    const statusEl = $(".status");
    let base = "";
    let quote = "";
    let ticker = { last: null, ask: null };
    let feeInfo = null;
    let stopped = false;
    let timer = null;
    const applyPosition = () => {
      const saved = getStored(POS_KEY, null);
      panel.classList.remove("pos-bottom-left", "pos-bottom-right", "pos-top-left", "pos-top-right");
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        panel.style.left = `${saved.left}px`;
        panel.style.top = `${saved.top}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        return;
      }
      panel.style.left = "";
      panel.style.top = "";
      panel.style.right = "";
      panel.style.bottom = "";
      panel.classList.add(`pos-${options.getConfig().position || "bottom-left"}`);
    };
    const toIdr = (value) => {
      if (value == null)
        return 0;
      if (quote === "IDR")
        return value;
      if (quote === "USDT")
        return value * currentRate().rate;
      return 0;
    };
    const render = () => {
      coinEl.textContent = base || "—";
      quoteEl.textContent = quote ? `/${quote}` : "";
      const price = toIdr(ticker.last);
      priceEl.textContent = price > 0 ? formatIdr(price, { prefix: "Rp. " }) : "—";
      priceEl.title = ticker.last != null && quote !== "IDR" ? `last ${ticker.last} ${quote}` : "";
      const ask = ticker.ask ?? ticker.last;
      const margin = toIdr(ask);
      marginEl.textContent = margin > 0 ? formatIdr(margin * 0.01, { prefix: "Rp. " }) : "—";
      const coinPrice = toIdr(ticker.last);
      if (feeInfo?.fee != null) {
        netEl.textContent = feeInfo.network ? `(${feeInfo.network})` : "";
        const rupiah = coinPrice > 0 ? feeInfo.fee * coinPrice : 0;
        const coinText = `${feeInfo.fee.toLocaleString("id-ID", { maximumFractionDigits: 8 })} ${base}`;
        feeEl.textContent = rupiah > 0 ? `${coinText} ≈ ${formatIdr(rupiah, { prefix: "Rp. " })}` : coinText;
        feeEl.title = rupiah > 0 ? `${coinText} × ${formatIdr(coinPrice, { prefix: "Rp. " })}` : coinText;
        hintEl.textContent = "";
      } else if (feeInfo?.needsLogin) {
        netEl.textContent = "";
        feeEl.textContent = "—";
        hintEl.textContent = "Login untuk memuat fee penarikan (halaman finance).";
      } else {
        netEl.textContent = "";
        feeEl.textContent = "—";
        hintEl.textContent = feeInfo ? "Fee tidak tersedia untuk koin ini." : "Memuat fee…";
      }
      statusEl.textContent = ticker.last ? `api · ${new Date().toLocaleTimeString()}` : "memuat harga…";
    };
    const loadTicker = async () => {
      if (!base || stopped)
        return;
      try {
        const body = await requestJson(`https://indodax.com/api/ticker/${base}_${quote}`.toLowerCase(), 1e4);
        const raw = body?.ticker ?? body;
        ticker = {
          last: parseNumber(raw?.last ?? raw?.lastPrice),
          ask: parseNumber(raw?.sell ?? raw?.ask)
        };
        render();
      } catch (error) {
        log("indodax ticker failed", error);
        statusEl.textContent = "harga tidak tersedia";
      }
    };
    const loadFee = async (force) => {
      if (!base)
        return;
      feeInfo = await readFee(base, force);
      render();
    };
    const syncPair = () => {
      const pair = currentPair();
      if (!pair) {
        host.style.display = "none";
        return;
      }
      host.style.display = "";
      if (pair.base === base && pair.quote === quote)
        return;
      base = pair.base;
      quote = pair.quote;
      ticker = { last: null, ask: null };
      feeInfo = null;
      render();
      loadTicker();
      loadFee(false);
    };
    const schedule = () => {
      if (timer)
        clearInterval(timer);
      timer = setInterval(() => {
        if (document.hidden)
          return;
        loadTicker();
      }, TICKER_MS);
    };
    panel.addEventListener("click", (event) => {
      const target = event.target.closest("[data-act]");
      if (!target)
        return;
      const action = target.dataset["act"];
      if (action === "refresh") {
        loadTicker();
        loadFee(true);
      }
      if (action === "collapse") {
        const collapsed = panel.dataset["collapsed"] !== "true";
        panel.dataset["collapsed"] = String(collapsed);
        target.textContent = collapsed ? "+" : "−";
        setStored(COLLAPSE_KEY2, collapsed);
      }
    });
    const head = $(".head");
    let drag = null;
    head.addEventListener("pointerdown", (event) => {
      if (event.target.closest("[data-act]"))
        return;
      const rect = panel.getBoundingClientRect();
      drag = { startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top };
      head.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    head.addEventListener("pointermove", (event) => {
      if (!drag)
        return;
      const left = Math.max(0, Math.min(window.innerWidth - 80, drag.left + event.clientX - drag.startX));
      const top = Math.max(0, Math.min(window.innerHeight - 40, drag.top + event.clientY - drag.startY));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    });
    head.addEventListener("pointerup", (event) => {
      if (!drag)
        return;
      const rect = panel.getBoundingClientRect();
      setStored(POS_KEY, { left: Math.round(rect.left), top: Math.round(rect.top) });
      drag = null;
      try {
        head.releasePointerCapture(event.pointerId);
      } catch {}
    });
    const mount = () => {
      if (!document.body) {
        requestAnimationFrame(mount);
        return;
      }
      document.body.appendChild(host);
      applyPosition();
      if (getStored(COLLAPSE_KEY2, false)) {
        panel.dataset["collapsed"] = "true";
        $('[data-act="collapse"]').textContent = "+";
      }
      syncPair();
      schedule();
    };
    mount();
    return {
      refresh: () => {
        applyPosition();
        syncPair();
        loadTicker();
      },
      destroy: () => {
        stopped = true;
        if (timer)
          clearInterval(timer);
        host.remove();
      },
      describe: () => ({
        adapter: "indodax:simple",
        rows: ticker.last ? 1 : 0,
        sample: [`${base}/${quote} last=${ticker.last ?? "-"} fee=${feeInfo?.fee ?? "-"} net=${feeInfo?.network ?? "-"}`]
      })
    };
  }

  // src/lib/coininfo.ts
  var CACHE_TTL = 10 * 60 * 1000;
  var CACHE_PREFIX = "coininfo.v2";
  var cacheKey = (site, coin) => `${CACHE_PREFIX}.${site}.${coin}`;
  var num2 = (value) => {
    if (value === null || value === undefined || value === "")
      return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  function asBool(value, fallback = true) {
    if (typeof value === "boolean")
      return value;
    if (typeof value === "number")
      return value !== 0;
    if (typeof value === "string")
      return !/^(false|0|off|disabled?|no)$/i.test(value.trim());
    return fallback;
  }
  function listOf(value) {
    if (Array.isArray(value))
      return value;
    if (value && typeof value === "object")
      return Object.values(value);
    return [];
  }
  function chainNameOf(chain) {
    return String(chain?.chainName ?? chain?.chain ?? chain?.network ?? chain?.name ?? "").trim().toUpperCase();
  }
  var emptyChain = (name) => ({
    name,
    deposit: true,
    withdraw: true,
    depositDelayed: false,
    withdrawDelayed: false,
    fee: null,
    feePercent: null,
    minWithdraw: null,
    maxWithdraw: null
  });
  function coinsDeposit(chains, fallback = true) {
    return chains.length ? chains.some((chain) => chain.deposit) : fallback;
  }
  function coinsWithdraw(chains, fallback = true) {
    return chains.length ? chains.some((chain) => chain.withdraw) : fallback;
  }
  function gateInfoFrom(chainsRaw, feeBody, coin) {
    const fees = new Map;
    let priceUsdt = null;
    let needsLogin = false;
    const message = String(feeBody?.resMsg?.message ?? feeBody?.message ?? "");
    if (feeBody && (Number(feeBody?.resMsg?.code) === 1000 || /log ?in|login first/i.test(message))) {
      needsLogin = true;
    } else if (feeBody) {
      priceUsdt = num2(feeBody?.datas?.rate_usdt ?? feeBody?.datas?.rateUsdt);
      for (const chain of listOf(feeBody?.datas?.chains)) {
        const name = chainNameOf(chain);
        if (!name)
          continue;
        fees.set(name, {
          fee: num2(chain?.withdraw_txfee ?? chain?.withdraw_fee ?? chain?.withdrawFix),
          percent: num2(chain?.withdraw_percent ?? chain?.withdrawPercent),
          min: num2(chain?.withdraw_min ?? chain?.withdrawMin),
          max: num2(chain?.withdraw_max ?? chain?.withdrawMax)
        });
      }
    }
    const chains = [];
    for (const raw of listOf(chainsRaw)) {
      const name = chainNameOf(raw);
      if (!name)
        continue;
      const fee = fees.get(name);
      const disabled = asBool(raw?.is_disabled, false);
      chains.push({
        name,
        deposit: !disabled && !asBool(raw?.is_deposit_disabled, false),
        withdraw: !disabled && !asBool(raw?.is_withdraw_disabled, false),
        depositDelayed: asBool(raw?.deposit_delayed, false),
        withdrawDelayed: asBool(raw?.withdraw_delayed, false),
        fee: fee?.fee ?? null,
        feePercent: fee?.percent ?? null,
        minWithdraw: num2(raw?.withdraw_amount_min ?? raw?.withdraw_min) ?? fee?.min ?? null,
        maxWithdraw: num2(raw?.withdraw_amount_max ?? raw?.withdraw_max) ?? fee?.max ?? null
      });
    }
    for (const [name, fee] of fees) {
      if (chains.some((chain) => chain.name === name))
        continue;
      chains.push({
        ...emptyChain(name),
        fee: fee.fee,
        feePercent: fee.percent,
        minWithdraw: fee.min,
        maxWithdraw: fee.max
      });
    }
    return {
      coin,
      deposit: coinsDeposit(chains),
      withdraw: coinsWithdraw(chains),
      chains,
      priceUsdt,
      source: needsLogin ? "gate:wallet/currency_chains (login for fees)" : "gate:wallet/currency_chains + json_svr",
      updatedAt: Date.now(),
      needsLogin
    };
  }
  function mexcInfoFrom(body, coin) {
    const code = Number(body?.code);
    const message = String(body?.msg ?? body?.message ?? "");
    if (code === 401 || /log ?in/i.test(message)) {
      return {
        coin,
        deposit: true,
        withdraw: true,
        chains: [],
        priceUsdt: null,
        source: "mexc:currency/v3 (login required)",
        updatedAt: Date.now(),
        needsLogin: true
      };
    }
    const data = body?.data ?? body;
    const chains = [];
    for (const raw of listOf(data?.chains ?? data?.networkList ?? data?.networks)) {
      const name = chainNameOf(raw);
      if (!name)
        continue;
      chains.push({
        name,
        deposit: asBool(raw?.enableDeposit ?? raw?.depositEnable ?? raw?.deposit_enable, true),
        withdraw: asBool(raw?.enableWithdraw ?? raw?.withdrawEnable ?? raw?.withdraw_enable, true),
        depositDelayed: asBool(raw?.depositDelayed ?? raw?.deposit_delayed, false),
        withdrawDelayed: asBool(raw?.withdrawDelayed ?? raw?.withdraw_delayed, false),
        fee: num2(raw?.withdrawFee ?? raw?.withdraw_fee ?? raw?.fee),
        feePercent: num2(raw?.withdrawFeePercent ?? raw?.withdrawPercent ?? raw?.withdraw_percent),
        minWithdraw: num2(raw?.withdrawMin ?? raw?.withdraw_min ?? raw?.minWithdraw),
        maxWithdraw: num2(raw?.withdrawMax ?? raw?.withdraw_max ?? raw?.maxWithdraw)
      });
    }
    return {
      coin,
      deposit: coinsDeposit(chains, asBool(data?.enableDeposit, true)),
      withdraw: coinsWithdraw(chains, asBool(data?.enableWithdraw, true)),
      chains,
      priceUsdt: num2(data?.currencyPrice ?? data?.currency_price),
      source: "mexc:currency/v3",
      updatedAt: Date.now(),
      needsLogin: false
    };
  }
  function binanceInfoFrom(body, coin) {
    const rows = listOf(body?.data ?? body);
    const symbol = coin.toUpperCase();
    const entry = rows.find((row) => String(row?.coin ?? "").toUpperCase() === symbol);
    if (!entry) {
      return {
        coin,
        deposit: true,
        withdraw: true,
        chains: [],
        priceUsdt: null,
        source: "binance:getNetworkCoinAll (coin not listed)",
        updatedAt: Date.now(),
        needsLogin: false
      };
    }
    const chains = [];
    for (const raw of listOf(entry?.networkList ?? entry?.networks)) {
      const name = String(raw?.network ?? raw?.networkDisplay ?? raw?.chain ?? "").trim().toUpperCase();
      if (!name)
        continue;
      chains.push({
        name,
        deposit: asBool(raw?.depositEnable ?? raw?.deposit_enable, true),
        withdraw: asBool(raw?.withdrawEnable ?? raw?.withdraw_enable, true),
        depositDelayed: asBool(raw?.depositDelayed ?? raw?.deposit_delayed, false),
        withdrawDelayed: asBool(raw?.withdrawDelayed ?? raw?.withdraw_delayed, false),
        fee: num2(raw?.withdrawFee ?? raw?.withdraw_fee),
        feePercent: null,
        minWithdraw: num2(raw?.withdrawMin ?? raw?.withdraw_min),
        maxWithdraw: num2(raw?.withdrawMax ?? raw?.withdraw_max)
      });
    }
    return {
      coin,
      deposit: coinsDeposit(chains, asBool(entry?.depositAllEnable, true)),
      withdraw: coinsWithdraw(chains, asBool(entry?.withdrawAllEnable, true)),
      chains,
      priceUsdt: null,
      source: "binance:getNetworkCoinAll",
      updatedAt: Date.now(),
      needsLogin: false
    };
  }
  function kucoinInfoFrom(body, coin) {
    const code = String(body?.code ?? "");
    if (code !== "200000" && code !== "0" && body?.data == null) {
      return {
        coin,
        deposit: true,
        withdraw: true,
        chains: [],
        priceUsdt: null,
        source: "kucoin:currencies (unavailable)",
        updatedAt: Date.now(),
        needsLogin: false,
        error: String(body?.msg ?? body?.message ?? "unexpected response")
      };
    }
    const data = body?.data ?? body;
    const chains = [];
    for (const raw of listOf(data?.chains ?? data?.networkList)) {
      const name = String(raw?.chainName ?? raw?.chain ?? raw?.network ?? "").trim().toUpperCase();
      if (!name)
        continue;
      chains.push({
        name,
        deposit: asBool(raw?.isDepositEnabled ?? raw?.depositEnabled, true),
        withdraw: asBool(raw?.isWithdrawEnabled ?? raw?.withdrawEnabled, true),
        depositDelayed: false,
        withdrawDelayed: false,
        fee: num2(raw?.withdrawMinFee ?? raw?.withdrawalMinFee ?? raw?.withdrawFee),
        feePercent: null,
        minWithdraw: num2(raw?.withdrawMinSize ?? raw?.withdrawalMinSize),
        maxWithdraw: num2(raw?.withdrawMaxSize ?? raw?.withdrawalMaxSize)
      });
    }
    return {
      coin,
      deposit: coinsDeposit(chains, asBool(data?.isDepositEnabled, true)),
      withdraw: coinsWithdraw(chains, asBool(data?.isWithdrawEnabled, true)),
      chains,
      priceUsdt: null,
      source: "kucoin:currencies",
      updatedAt: Date.now(),
      needsLogin: false
    };
  }
  function bybitInfoFrom(body, coin) {
    const retCode = Number(body?.ret_code ?? body?.retCode ?? 0);
    const message = String(body?.ret_msg ?? body?.retMsg ?? body?.message ?? "");
    if (retCode !== 0 || /auth|login/i.test(message)) {
      return {
        coin,
        deposit: true,
        withdraw: true,
        chains: [],
        priceUsdt: null,
        source: "bybit:coin-config (login required)",
        updatedAt: Date.now(),
        needsLogin: true
      };
    }
    const result = body?.result ?? body?.data ?? body;
    const rows = listOf(result?.rows ?? result?.list ?? result);
    const symbol = coin.toUpperCase();
    const entry = rows.find((row) => String(row?.coin ?? row?.currency ?? "").toUpperCase() === symbol) ?? rows[0];
    const chains = [];
    for (const raw of listOf(entry?.chains ?? entry?.networkList)) {
      const name = String(raw?.chain ?? raw?.chainName ?? raw?.network ?? "").trim().toUpperCase();
      if (!name)
        continue;
      chains.push({
        name,
        deposit: asBool(raw?.chainDeposit ?? raw?.depositEnable, true),
        withdraw: asBool(raw?.chainWithdraw ?? raw?.withdrawEnable, true),
        depositDelayed: false,
        withdrawDelayed: false,
        fee: num2(raw?.withdrawFee ?? raw?.withdraw_fee),
        feePercent: null,
        minWithdraw: num2(raw?.withdrawMin ?? raw?.withdraw_min),
        maxWithdraw: num2(raw?.withdrawMax ?? raw?.withdraw_max)
      });
    }
    return {
      coin,
      deposit: coinsDeposit(chains),
      withdraw: coinsWithdraw(chains),
      chains,
      priceUsdt: null,
      source: "bybit:coin-config",
      updatedAt: Date.now(),
      needsLogin: false
    };
  }
  var gateChainsUrl = (coin) => `https://api.gateio.ws/api/v4/wallet/currency_chains?currency=${encodeURIComponent(coin)}`;
  var gateTickerUrl = (coin) => `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${encodeURIComponent(coin)}_USDT`;
  var mexcCurrencyUrl = (coin) => `/api/platform/asset/api/asset/spot/currency/v3?currency=${encodeURIComponent(coin)}`;
  var mexcTickerUrl = (coin) => `https://api.mexc.com/api/v3/ticker/price?symbol=${encodeURIComponent(coin)}USDT`;
  var binanceAllCoinsUrl = "https://www.binance.com/bapi/capital/v1/public/capital/getNetworkCoinAll";
  var binanceTickerUrl = (coin) => `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(coin)}USDT`;
  var kucoinCurrencyUrl = (coin) => `https://api.kucoin.com/api/v3/currencies/${encodeURIComponent(coin)}`;
  var kucoinTickerUrl = (coin) => `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${encodeURIComponent(coin)}-USDT`;
  var bybitCoinUrl = (coin) => `https://api2.bybit.com/v3/private/cht/asset-common/coin-config?coin=${encodeURIComponent(coin)}`;
  var bybitTickerUrl = (coin) => `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${encodeURIComponent(coin)}USDT`;
  async function gateFeeBody(coin) {
    if (typeof fetch !== "function")
      throw new Error("fetch unavailable");
    const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
    const headers = { "content-type": "application/x-www-form-urlencoded" };
    if (csrf)
      headers["Csrftoken"] = decodeURIComponent(csrf);
    const response = await fetch("/json_svr/query?u=116", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: new URLSearchParams({ type: "getWithdrawChainsInfo", curr_type: coin }).toString()
    });
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  async function bybitCoinBody(coin) {
    if (typeof fetch === "function" && /(^|\.)bybit\.com$/.test(location.hostname)) {
      try {
        const response = await fetch(bybitCoinUrl(coin), {
          credentials: "include",
          headers: { accept: "application/json" }
        });
        if (response.ok)
          return response.json();
      } catch {}
    }
    return requestJson(bybitCoinUrl(coin));
  }
  async function mexcCurrencyBody(coin) {
    if (typeof fetch !== "function")
      throw new Error("fetch unavailable");
    const response = await fetch(mexcCurrencyUrl(coin), {
      credentials: "same-origin",
      headers: { accept: "application/json" }
    });
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  async function gatePriceUsdt(coin) {
    try {
      const rows = await requestJson(gateTickerUrl(coin), 8000);
      const pair = `${coin.toUpperCase()}_USDT`;
      const row = Array.isArray(rows) ? rows.find((item) => String(item?.currency_pair).toUpperCase() === pair) : null;
      return num2(row?.last);
    } catch {
      return null;
    }
  }
  async function mexcPriceUsdt(coin) {
    try {
      const raw = await requestJson(mexcTickerUrl(coin), 8000);
      return num2(raw?.price);
    } catch {
      return null;
    }
  }
  async function binancePriceUsdt(coin) {
    try {
      const raw = await requestJson(binanceTickerUrl(coin), 8000);
      return num2(raw?.price);
    } catch {
      return null;
    }
  }
  async function kucoinPriceUsdt(coin) {
    try {
      const raw = await requestJson(kucoinTickerUrl(coin), 8000);
      return num2(raw?.data?.price);
    } catch {
      return null;
    }
  }
  async function bybitPriceUsdt(coin) {
    try {
      const raw = await requestJson(bybitTickerUrl(coin), 8000);
      return num2(raw?.result?.list?.[0]?.lastPrice);
    } catch {
      return null;
    }
  }
  function readCache(site, coin) {
    const cached = getStored(cacheKey(site, coin), null);
    if (!cached || !cached.updatedAt)
      return null;
    if (Date.now() - cached.updatedAt > CACHE_TTL)
      return null;
    return cached;
  }
  function unavailable(coin, message) {
    return {
      coin,
      deposit: true,
      withdraw: true,
      chains: [],
      priceUsdt: null,
      source: "unavailable",
      updatedAt: Date.now(),
      needsLogin: false,
      error: message
    };
  }
  var binanceCoinsCache = null;
  async function binanceCoinsPayload() {
    if (binanceCoinsCache && Date.now() - binanceCoinsCache.at < CACHE_TTL)
      return binanceCoinsCache.body;
    const body = await requestJson(binanceAllCoinsUrl, 20000);
    binanceCoinsCache = { at: Date.now(), body };
    return body;
  }
  async function getCoinInfo(site, coin, force = false) {
    if (!force) {
      const cached = readCache(site, coin);
      if (cached)
        return cached;
    }
    if (site === "gate") {
      let chainsRaw = [];
      let feeBody = null;
      try {
        chainsRaw = await requestJson(gateChainsUrl(coin));
      } catch (error) {
        log("gate currency_chains failed", error);
      }
      try {
        feeBody = await gateFeeBody(coin);
      } catch (error) {
        log("gate withdraw fee request failed", error);
      }
      if (!listOf(chainsRaw).length && !feeBody)
        return unavailable(coin, "Gate API unreachable");
      const info = gateInfoFrom(chainsRaw, feeBody, coin);
      if (info.priceUsdt == null)
        info.priceUsdt = await gatePriceUsdt(coin);
      setStored(cacheKey(site, coin), info);
      return info;
    }
    if (site === "mexc") {
      let body;
      try {
        body = await mexcCurrencyBody(coin);
      } catch (error) {
        log("mexc currency/v3 failed", error);
        return unavailable(coin, "MEXC asset API unreachable");
      }
      const info = mexcInfoFrom(body, coin);
      if (info.priceUsdt == null && !info.needsLogin)
        info.priceUsdt = await mexcPriceUsdt(coin);
      setStored(cacheKey(site, coin), info);
      return info;
    }
    if (site === "binance") {
      let body;
      try {
        body = await binanceCoinsPayload();
      } catch (error) {
        log("binance getNetworkCoinAll failed", error);
        return unavailable(coin, "Binance asset API unreachable");
      }
      const info = binanceInfoFrom(body, coin);
      if (info.priceUsdt == null)
        info.priceUsdt = await binancePriceUsdt(coin);
      if (!info.chains.length && !info.error)
        info.error = "Coin is not listed on Binance";
      setStored(cacheKey(site, coin), info);
      return info;
    }
    if (site === "kucoin") {
      let body;
      try {
        body = await requestJson(kucoinCurrencyUrl(coin));
      } catch (error) {
        log("kucoin currencies failed", error);
        return unavailable(coin, "KuCoin asset API unreachable");
      }
      const info = kucoinInfoFrom(body, coin);
      if (info.priceUsdt == null && !info.error)
        info.priceUsdt = await kucoinPriceUsdt(coin);
      setStored(cacheKey(site, coin), info);
      return info;
    }
    if (site === "bybit") {
      let body;
      try {
        body = await bybitCoinBody(coin);
      } catch (error) {
        log("bybit coin-config failed", error);
        return unavailable(coin, "Bybit asset API unreachable");
      }
      const info = bybitInfoFrom(body, coin);
      if (info.priceUsdt == null && !info.needsLogin)
        info.priceUsdt = await bybitPriceUsdt(coin);
      setStored(cacheKey(site, coin), info);
      return info;
    }
    return unavailable(coin, "Unsupported site");
  }

  // src/lib/panel.ts
  var POS_KEY2 = "ui.panel.pos";
  var COLLAPSE_KEY3 = "ui.panel.collapsed";
  var CSS3 = `
:host { all: initial; }
.panel {
  position: fixed;
  z-index: 2147483000;
  min-width: 216px;
  max-width: 268px;
  font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #e6edf3;
  background: rgba(13, 17, 23, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  overflow: hidden;
  user-select: none;
}
.panel.pos-bottom-left { left: 14px; bottom: 14px; }
.panel.pos-bottom-right { right: 14px; bottom: 14px; }
.panel.pos-top-left { left: 14px; top: 70px; }
.panel.pos-top-right { right: 14px; top: 70px; }
.head {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 8px; cursor: move;
  background: rgba(255, 255, 255, 0.04);
}
.coin { font-weight: 700; letter-spacing: 0.02em; }
.quote { color: #8b949e; font-size: 11px; }
.grow { flex: 1; }
.icon {
  all: unset; cursor: pointer; padding: 0 4px; border-radius: 4px;
  color: #8b949e; font-size: 13px; line-height: 1;
}
.icon:hover { color: #e6edf3; background: rgba(255, 255, 255, 0.08); }
.body { padding: 8px; display: flex; flex-direction: column; gap: 7px; }
.panel[data-collapsed="true"] .body { display: none; }
.chips { display: flex; gap: 6px; }
.chip {
  flex: 1; display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 6px; border-radius: 6px; font-size: 11px;
  background: rgba(255, 255, 255, 0.05); color: #8b949e;
}
.chip i { width: 6px; height: 6px; border-radius: 50%; background: #6e7681; flex: none; }
.chip b { margin-left: auto; font-weight: 600; color: #8b949e; }
.chip.ok { color: #c9d1d9; } .chip.ok i { background: #2ea043; } .chip.ok b { color: #3fb950; }
.chip.bad { color: #c9d1d9; } .chip.bad i { background: #f85149; } .chip.bad b { color: #f85149; }
.chip.warn i { background: #d29922; } .chip.warn b { color: #d29922; }
.chains { display: flex; flex-direction: column; gap: 2px; max-height: 168px; overflow-y: auto; }
.chain {
  display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 0 6px;
  font-size: 11px; padding: 3px 4px; border-radius: 4px; background: rgba(255, 255, 255, 0.03);
}
.chain .name { color: #c9d1d9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chain .flags { display: flex; gap: 6px; font-variant-numeric: tabular-nums; }
.chain .flags span { color: #6e7681; }
.chain .flags span.yes { color: #3fb950; }
.chain .flags span.no { color: #f85149; }
.chain .fee {
  grid-column: 1 / -1; font-size: 10px; color: #ead05a;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chain.hint { display: block; color: #d29922; font-size: 10px; background: none; padding: 2px 4px; }
.actions { display: flex; gap: 6px; }
.btn {
  all: unset; flex: 1; text-align: center; cursor: pointer;
  padding: 5px 8px; border-radius: 6px; font-size: 11px; font-weight: 600;
  color: #e6edf3; background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.btn:hover { background: rgba(255, 255, 255, 0.14); }
.btn.primary { background: #1f6feb; border-color: #1f6feb; }
.btn.primary:hover { background: #2f81f7; }
.foot { font-size: 10px; color: #6e7681; display: flex; gap: 6px; align-items: center; }
.foot .rate { margin-left: auto; font-size: 12px; font-weight: 600; color: #ead05a; white-space: nowrap; }
.foot .retry { all: unset; cursor: pointer; color: #58a6ff; }
`;
  function formatCoin(value) {
    return value.toLocaleString("id-ID", { maximumFractionDigits: 8 });
  }
  function feeLabel(chain, coin, priceUsdt, usdtIdr) {
    const parts = [];
    if (chain.fee != null) {
      const coinAmount = `${formatCoin(chain.fee)} ${coin}`;
      if (priceUsdt && usdtIdr) {
        parts.push(`${coinAmount} ≈ ${formatIdr(chain.fee * priceUsdt * usdtIdr, { prefix: "Rp. " })}`);
      } else {
        parts.push(coinAmount);
      }
    }
    if (chain.feePercent)
      parts.push(`${formatCoin(chain.feePercent)}%`);
    return `fee ${parts.join(" + ")}`;
  }
  function timeAgo(timestamp) {
    if (!timestamp)
      return "never";
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60)
      return `${seconds}s ago`;
    if (seconds < 3600)
      return `${Math.round(seconds / 60)}m ago`;
    if (seconds < 86400)
      return `${Math.round(seconds / 3600)}h ago`;
    return `${Math.round(seconds / 86400)}d ago`;
  }
  function mountPanel(options) {
    const host = document.createElement("div");
    host.id = "tradecat-panel-host";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS3;
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
    <div class="head">
      <span class="coin">—</span>
      <span class="quote"></span>
      <span class="grow"></span>
      <button class="icon" data-act="refresh" title="Refresh coin info">↻</button>
      <button class="icon" data-act="collapse" title="Collapse">−</button>
    </div>
    <div class="body">
      <div class="chips">
        <span class="chip" data-kind="dep"><i></i>Deposit<b>—</b></span>
        <span class="chip" data-kind="wd"><i></i>Withdraw<b>—</b></span>
      </div>
      <div class="chains"></div>
      <div class="actions">
        <button class="btn primary" data-act="deposit">Deposit</button>
        <button class="btn" data-act="withdraw">Withdraw</button>
      </div>
      <div class="foot"></div>
    </div>`;
    shadow.append(style, panel);
    const $ = (selector) => panel.querySelector(selector);
    const coinEl = $(".coin");
    const quoteEl = $(".quote");
    const depChip = $('.chip[data-kind="dep"]');
    const wdChip = $('.chip[data-kind="wd"]');
    const chainsEl = $(".chains");
    const footEl = $(".foot");
    let coin = "";
    let quote = "";
    let info = null;
    let loading = false;
    const applyPosition = () => {
      const saved = getStored(POS_KEY2, null);
      panel.classList.remove("pos-bottom-left", "pos-bottom-right", "pos-top-left", "pos-top-right");
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        panel.style.left = `${saved.left}px`;
        panel.style.top = `${saved.top}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        return;
      }
      panel.style.left = "";
      panel.style.top = "";
      panel.style.right = "";
      panel.style.bottom = "";
      const position = options.getConfig().position || "bottom-left";
      panel.classList.add(`pos-${position}`);
    };
    const setChip = (chip, available, delayed = false) => {
      const value = chip.querySelector("b");
      chip.classList.remove("ok", "bad", "warn");
      if (available === null) {
        value.textContent = "—";
        return;
      }
      if (available) {
        chip.classList.add(delayed ? "warn" : "ok");
        value.textContent = delayed ? "delayed" : "enabled";
      } else {
        chip.classList.add("bad");
        value.textContent = "disabled";
      }
    };
    const render = () => {
      coinEl.textContent = coin || "—";
      quoteEl.textContent = quote ? `/${quote}` : "";
      if (loading) {
        setChip(depChip, null);
        setChip(wdChip, null);
        footEl.textContent = "loading coin info…";
        return;
      }
      if (!info || info.error) {
        setChip(depChip, null);
        setChip(wdChip, null);
        chainsEl.textContent = "";
        footEl.innerHTML = "";
        const message = document.createElement("span");
        message.textContent = info?.error ? `${info.error} · ` : "no coin info · ";
        const retry = document.createElement("button");
        retry.className = "retry";
        retry.textContent = "retry";
        retry.addEventListener("click", () => void load(true));
        footEl.append(message, retry);
        return;
      }
      const depositDelayed = info.chains.some((chain) => chain.depositDelayed);
      const withdrawDelayed = info.chains.some((chain) => chain.withdrawDelayed);
      const unknown = info.needsLogin && info.chains.length === 0;
      setChip(depChip, unknown ? null : info.deposit, depositDelayed);
      setChip(wdChip, unknown ? null : info.withdraw, withdrawDelayed);
      chainsEl.textContent = "";
      if (options.getConfig().showChains && info.chains.length) {
        for (const chain of info.chains) {
          const row = document.createElement("div");
          row.className = "chain";
          const name = document.createElement("span");
          name.className = "name";
          name.textContent = chain.name;
          name.title = chain.name;
          const flags = document.createElement("span");
          flags.className = "flags";
          const dep = document.createElement("span");
          dep.textContent = chain.deposit ? "D✓" : "D✗";
          dep.className = chain.deposit ? "yes" : "no";
          dep.title = chain.deposit ? "deposit enabled" : "deposit disabled";
          const wd = document.createElement("span");
          wd.textContent = chain.withdraw ? "W✓" : "W✗";
          wd.className = chain.withdraw ? "yes" : "no";
          wd.title = chain.withdraw ? "withdraw enabled" : "withdraw disabled";
          flags.append(dep, wd);
          const details = [
            chain.deposit ? "deposit enabled" : "deposit disabled",
            chain.withdraw ? "withdraw enabled" : "withdraw disabled"
          ];
          if (chain.fee != null)
            details.push(`fee ${formatCoin(chain.fee)} ${coin}`);
          if (chain.feePercent)
            details.push(`+ ${formatCoin(chain.feePercent)}%`);
          if (chain.minWithdraw != null)
            details.push(`min ${formatCoin(chain.minWithdraw)} ${coin}`);
          if (chain.maxWithdraw != null)
            details.push(`max ${formatCoin(chain.maxWithdraw)} ${coin}`);
          row.title = `${chain.name} · ${details.join(" · ")}`;
          row.append(name, flags);
          if (!info.needsLogin && (chain.fee != null || chain.feePercent != null)) {
            const fee = document.createElement("span");
            fee.className = "fee";
            fee.textContent = feeLabel(chain, coin, info.priceUsdt, currentRate().rate);
            row.append(fee);
          }
          chainsEl.append(row);
        }
      }
      if (info.needsLogin) {
        const hint = document.createElement("div");
        hint.className = "chain hint";
        hint.textContent = "Log in to load network fees";
        hint.title = "Networks and fees come from the exchange session; the orderbook keeps working without it.";
        chainsEl.append(hint);
      }
      const rate = currentRate();
      footEl.textContent = "";
      const ago = document.createElement("span");
      ago.textContent = timeAgo(info.updatedAt);
      footEl.append(ago);
      if (rate.rate) {
        const rateEl = document.createElement("span");
        rateEl.className = "rate";
        rateEl.textContent = `1 USDT = ${formatIdr(rate.rate, { mode: "full", prefix: "Rp. " })}`;
        footEl.append(rateEl);
      }
      footEl.title = `${info.source}${rate.source ? ` · rate from ${rate.source} (${timeAgo(rate.updatedAt)})` : ""}`;
    };
    const load = async (force = false) => {
      if (!coin)
        return;
      loading = true;
      render();
      try {
        info = await getCoinInfo(options.site, coin, force);
      } finally {
        loading = false;
        render();
      }
    };
    const syncPair = () => {
      const pair = currentPair();
      if (!pair) {
        host.style.display = "none";
        return;
      }
      host.style.display = "";
      const nextCoin = pair.base;
      const nextQuote = pair.quote;
      if (nextCoin !== coin || nextQuote !== quote) {
        coin = nextCoin;
        quote = nextQuote;
        info = null;
        load();
        return;
      }
      render();
    };
    panel.addEventListener("click", (event) => {
      const target = event.target.closest("[data-act]");
      if (!target)
        return;
      const action = target.dataset["act"];
      if (action === "deposit")
        window.open(depositUrl(options.site, coin), "_blank", "noopener");
      if (action === "withdraw")
        window.open(withdrawUrl(options.site, coin), "_blank", "noopener");
      if (action === "refresh")
        load(true);
      if (action === "collapse") {
        const collapsed = panel.dataset["collapsed"] !== "true";
        panel.dataset["collapsed"] = String(collapsed);
        target.textContent = collapsed ? "+" : "−";
        setStored(COLLAPSE_KEY3, collapsed);
      }
    });
    const head = $(".head");
    let drag = null;
    head.addEventListener("pointerdown", (event) => {
      if (event.target.closest("[data-act]"))
        return;
      const rect = panel.getBoundingClientRect();
      drag = { startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top };
      head.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    head.addEventListener("pointermove", (event) => {
      if (!drag)
        return;
      const left = Math.max(0, Math.min(window.innerWidth - 80, drag.left + event.clientX - drag.startX));
      const top = Math.max(0, Math.min(window.innerHeight - 40, drag.top + event.clientY - drag.startY));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    });
    head.addEventListener("pointerup", (event) => {
      if (!drag)
        return;
      const rect = panel.getBoundingClientRect();
      setStored(POS_KEY2, { left: Math.round(rect.left), top: Math.round(rect.top) });
      drag = null;
      try {
        head.releasePointerCapture(event.pointerId);
      } catch {}
    });
    const mount = () => {
      if (!document.body) {
        requestAnimationFrame(mount);
        return;
      }
      document.body.appendChild(host);
      applyPosition();
      if (getStored(COLLAPSE_KEY3, false)) {
        panel.dataset["collapsed"] = "true";
        $('[data-act="collapse"]').textContent = "+";
      }
      syncPair();
    };
    mount();
    return {
      refresh: () => {
        applyPosition();
        syncPair();
      },
      destroy: () => host.remove()
    };
  }

  // src/main.ts
  function num3(key, fallback) {
    const raw = getStored(key, fallback);
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }
  function str(key, fallback) {
    const raw = getStored(key, fallback);
    if (typeof raw === "string")
      return raw;
    if (raw == null)
      return fallback;
    return String(raw);
  }
  function bool(key, fallback) {
    const raw = getStored(key, fallback);
    if (typeof raw === "boolean")
      return raw;
    if (typeof raw === "string")
      return /^(true|1|on|yes)$/i.test(raw);
    if (typeof raw === "number")
      return raw !== 0;
    return fallback;
  }
  var asMode = (value, fallback) => value === "full" || value === "compact" || value === "auto" ? value : fallback;
  var cachedOrderbookConfig = null;
  var cachedOrderbookConfigAt = 0;
  function orderbookConfig() {
    const now = Date.now();
    if (cachedOrderbookConfig && now - cachedOrderbookConfigAt < 3000)
      return cachedOrderbookConfig;
    cachedOrderbookConfig = {
      showPrice: bool("idr.showPrice", true),
      convertTotal: bool("idr.convertTotal", true),
      priceMode: asMode(str("idr.priceFormat", "full"), "full"),
      volumeMode: asMode(str("idr.volumeFormat", "full"), "full"),
      prefix: str("idr.prefix", ""),
      priceColor: str("idr.priceColor", "#ead05a"),
      volumeColor: str("idr.volumeColor", "#ead05a"),
      fit: bool("idr.fit", true)
    };
    cachedOrderbookConfigAt = now;
    return cachedOrderbookConfig;
  }
  function panelConfig() {
    return {
      enabled: bool("coin.panel", true),
      showChains: bool("coin.showChains", true),
      position: str("coin.position", "bottom-left")
    };
  }
  function watchNavigation(onChange) {
    let last = location.href;
    const check = () => {
      if (location.href === last)
        return;
      last = location.href;
      onChange();
    };
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function patched(...args) {
        const result = original.apply(this, args);
        setTimeout(check, 0);
        return result;
      };
    }
    window.addEventListener("popstate", check);
    setInterval(check, 1000);
  }
  function registerMenu(handlers) {
    if (typeof GM_registerMenuCommand !== "function")
      return;
    const register = (label, fn) => {
      try {
        GM_registerMenuCommand(label, fn);
      } catch {}
    };
    register("TradeCat: rescan orderbook", handlers.rescan);
    register("TradeCat: set USDT → IDR rate", handlers.setRate);
    register("TradeCat: debug orderbook", handlers.debug);
    register("TradeCat: open settings", () => {
      if (typeof CAT_userConfig === "function") {
        CAT_userConfig();
        return;
      }
      log("Open the ScriptCat dashboard → this script → Settings.");
    });
  }
  async function boot() {
    const site = detectSite();
    initRate();
    const simple = isSimpleSite(site) ? mountSimpleHud({ getConfig: () => ({ position: panelConfig().position }) }) : null;
    const apiBook = usesApiBook(site) ? mountBybitBook() : null;
    const orderbook = simple || apiBook ? null : startOrderbook({ site, getRate: rateValue, getConfig: orderbookConfig });
    const describe = () => orderbook ? describeOrderbook(site) : simple ? simple.describe() : apiBook.describe();
    const rescan = () => {
      orderbook?.rescan();
      apiBook?.refresh();
      simple?.refresh();
    };
    globalThis.TradeCat = {
      describe,
      rescan,
      rate: () => rateValue(),
      setRate: (value) => saveRate(value, "manual")
    };
    const panel = panelConfig().enabled && !simple ? mountPanel({ site, getConfig: panelConfig }) : null;
    onRateChange(rescan);
    getUsdtIdrRate({
      ttlHours: num3("idr.ttlHours", 6),
      enableNetwork: bool("idr.enableNetworkRate", false),
      fallbackRate: num3("idr.fallbackRate", 18000)
    }).then((snapshot) => {
      log(`site=${site} rate=${snapshot.rate} (${snapshot.source})`);
    });
    window.addEventListener("storage", (event) => {
      if (event.key && event.key.startsWith("tradecat:idr"))
        syncRateFromStorage();
    });
    setInterval(syncRateFromStorage, 30000);
    watchNavigation(() => {
      panel?.refresh();
      rescan();
    });
    registerMenu({
      rescan,
      setRate: () => {
        const answer = window.prompt("1 USDT = ? IDR", String(rateValue()));
        if (!answer)
          return;
        const parsed = Number(answer.replace(/[^\d.]/g, ""));
        if (!Number.isFinite(parsed) || parsed <= 0)
          return;
        saveRate(parsed, "manual");
        rescan();
      },
      debug: () => {
        const info = describe();
        log("orderbook debug", info);
        if (typeof GM_notification === "function") {
          GM_notification({ title: "TradeCat", text: `${info.rows} rows · adapter: ${info.adapter}` });
        }
      }
    });
  }
  if (detectSite() === "bybit")
    installBybitDepthHook();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void boot(), { once: true });
  } else {
    boot();
  }
})();


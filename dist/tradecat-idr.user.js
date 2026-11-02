// ==UserScript==
// @name         TradeCat · IDR Orderbook
// @namespace    https://github.com/sulthonuladib/tradecat
// @homepageURL  https://github.com/sulthonuladib/tradecat
// @supportURL   https://github.com/sulthonuladib/tradecat/issues
// @updateURL    https://raw.githubusercontent.com/sulthonuladib/tradecat/main/dist/tradecat-idr.user.js
// @downloadURL  https://raw.githubusercontent.com/sulthonuladib/tradecat/main/dist/tradecat-idr.user.js
// @version      0.1.0
// @description  IDR price beside every orderbook price, Total (USDT) replaced by IDR volume, plus deposit/withdraw status with chain details and quick Deposit/Withdraw buttons. Works on gate.com and mexc.fm.
// @author       tradecat
// @license      MIT
// @match        https://www.gate.com/trade/*
// @match        https://gate.com/trade/*
// @match        https://www.gate.io/trade/*
// @match        https://gate.io/trade/*
// @match        https://www.mexc.com/exchange/*
// @match        https://mexc.com/exchange/*
// @match        https://www.mexc.fm/exchange/*
// @match        https://mexc.fm/exchange/*
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
    description: Colour of the converted Total column. Leave empty to inherit the cell colour.
    type: text
    default: ""
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
  function detectSite(host = location.hostname) {
    const forced = globalThis.__TRADECAT_SITE__;
    if (forced === "gate" || forced === "mexc")
      return forced;
    if (/(^|\.)gate\.(com|io)$/.test(host))
      return "gate";
    if (/(^|\.)mexc\.(com|fm)$/.test(host))
      return "mexc";
    return "generic";
  }
  function currentPair(path = location.pathname) {
    const match = path.match(/\/(?:trade|exchange|spot)\/([A-Za-z0-9]{1,12})[_-]([A-Za-z0-9]{1,12})/);
    if (!match)
      return null;
    return { base: match[1].toUpperCase(), quote: match[2].toUpperCase() };
  }
  function depositUrl(site, coin) {
    const origin = location.origin && location.origin !== "null" ? location.origin : "https://www.gate.com";
    if (site === "gate")
      return `${origin}/myaccount/deposit/${coin}`;
    if (site === "mexc")
      return `${origin}/assets/deposit/${coin}`;
    return "";
  }
  function withdrawUrl(site, coin) {
    const origin = location.origin && location.origin !== "null" ? location.origin : "https://www.gate.com";
    if (site === "gate")
      return `${origin}/myaccount/withdraw/${coin}`;
    if (site === "mexc")
      return `${origin}/assets/withdraw/${coin}`;
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
      url: "https://indodax.com/api/ticker/usdt_idr",
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
    s = s.replace(/[^0-9.,+\-A-Za-z万亿]/g, "");
    if (!s)
      return null;
    let mult = 1;
    const unitMatch = s.match(/([0-9.,])([kKmMbBtT万亿])$/);
    if (unitMatch) {
      const key = unitMatch[2];
      mult = UNIT[key.toLowerCase()] ?? UNIT[key] ?? 1;
      s = s.slice(0, -1);
    }
    s = s.replace(/[A-Za-z万亿]/g, "");
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
      const [intPart, fracPart] = s.split(",");
      const looksLikeThousands = intPart !== "0" && /^\d{1,3}$/.test(intPart) && fracPart.length === 3;
      norm = looksLikeThousands ? intPart + fracPart : s.replace(",", ".");
    } else {
      norm = s;
    }
    const n = Number(norm);
    if (!Number.isFinite(n))
      return null;
    const decimals = norm.includes(".") ? norm.split(".")[1].length : 0;
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
    if (abs < 1) {
      const decimals = Math.min(12, Math.max(2, Math.ceil(-Math.log10(abs)) + 4));
      return prefix + idNum(value, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
    }
    if (abs < 1000)
      return prefix + idNum(value, { maximumFractionDigits: 2 });
    const full = prefix + idNum(value, { maximumFractionDigits: 0 });
    if (mode === "compact")
      return prefix + formatCompactIdr(value);
    if (mode === "auto") {
      const limit = options.maxFullLength ?? 13;
      return full.length <= limit ? full : prefix + formatCompactIdr(value);
    }
    return full;
  }

  // src/lib/orderbook.ts
  var INJECTED = "tc-injected";
  var PRICE_IDR = "tc-idr-price";
  var PRICE_IDR_BASE_STYLE = [
    "margin-left:6px",
    "font-size:0.82em",
    "font-weight:400",
    "line-height:1",
    "white-space:nowrap",
    "letter-spacing:0",
    "display:inline-block",
    "vertical-align:baseline",
    "pointer-events:none"
  ];
  var COLOR_RE = /^(#[0-9a-f]{3,8}|[a-z]{3,24}|rgba?\([\d.,%\s/]+\)|hsla?\([\d.,%\s/]+\))$/i;
  function sanitizeColor(value) {
    if (!value)
      return "";
    const candidate = String(value).trim();
    return COLOR_RE.test(candidate) ? candidate : "";
  }
  function priceBadgeStyle(config) {
    const color = sanitizeColor(config.priceColor);
    return [...PRICE_IDR_BASE_STYLE, color ? `color:${color}` : "color:inherit", color ? "opacity:1" : "opacity:0.72"].join(";");
  }
  var rendered = new WeakMap;
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
  function siteText(el) {
    const current = cleanText(el);
    const previous = rendered.get(el);
    if (previous !== undefined && previous === current) {
      const original = el.dataset.tcOrig;
      if (original !== undefined)
        return original;
    }
    return current;
  }
  var SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CANVAS", "INPUT", "TEXTAREA", "SELECT", "OPTION", "svg", "path"]);
  function walkLeaves(root, out, maxLeaves = 1200, maxNodes = 20000) {
    let visited = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        const el = node;
        visited += 1;
        if (visited > maxNodes || out.length >= maxLeaves)
          return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(el.tagName))
          return NodeFilter.FILTER_REJECT;
        if (el.classList && el.classList.contains(INJECTED))
          return NodeFilter.FILTER_REJECT;
        const kids = el.children;
        let hasRealChild = false;
        for (let index = 0;index < kids.length; index += 1) {
          if (!kids[index].classList.contains(INJECTED)) {
            hasRealChild = true;
            break;
          }
        }
        if (hasRealChild)
          return NodeFilter.FILTER_SKIP;
        const text = cleanText(el);
        if (!text || text.length > 24)
          return NodeFilter.FILTER_REJECT;
        out.push(el);
        return NodeFilter.FILTER_REJECT;
      }
    });
    walker.nextNode();
  }
  function lowestCommonAncestor(a, b) {
    const ancestors = new Set;
    for (let node = a;node; node = node.parentNode)
      ancestors.add(node);
    for (let node = b;node; node = node.parentNode) {
      if (ancestors.has(node))
        return node;
    }
    return null;
  }
  function numericLeavesIn(row, leaves, parsed) {
    let count = 0;
    for (let index = 0;index < leaves.length; index += 1) {
      if (parsed[index] == null)
        continue;
      if (row.contains(leaves[index])) {
        count += 1;
        if (count > 8)
          break;
      }
    }
    return count;
  }
  function collectTriples(root) {
    const leaves = [];
    walkLeaves(root, leaves);
    if (leaves.length < 3)
      return [];
    const parsed = leaves.map((el) => parseNumberInfo(siteText(el)));
    const triples = [];
    const seen = new Set;
    let i = 0;
    while (i < leaves.length) {
      const priceInfo = parsed[i];
      if (!priceInfo || priceInfo.value <= 0) {
        i += 1;
        continue;
      }
      const price = priceInfo.value;
      let matched = false;
      const maxJ = Math.min(i + 5, leaves.length);
      for (let j = i + 1;j < maxJ && !matched; j += 1) {
        const amountInfo = parsed[j];
        if (!amountInfo || amountInfo.value <= 0)
          continue;
        const amount = amountInfo.value;
        const maxK = Math.min(j + 5, leaves.length);
        for (let k = j + 1;k < maxK; k += 1) {
          const totalInfo = parsed[k];
          if (!totalInfo || totalInfo.value <= 0)
            continue;
          const total = totalInfo.value;
          const tolerance = Math.max(total * 0.02, totalInfo.step * 1.05, price * amountInfo.step * 1.05) + 0.000000000001;
          if (Math.abs(price * amount - total) > tolerance)
            continue;
          const rowNode = lowestCommonAncestor(leaves[i], lowestCommonAncestor(leaves[j], leaves[k]) ?? leaves[k]);
          if (!rowNode || !(rowNode instanceof HTMLElement) || rowNode === root || !root.contains(rowNode))
            continue;
          const numeric = numericLeavesIn(rowNode, leaves, parsed);
          if (numeric < 3 || numeric > 8)
            continue;
          if (seen.has(rowNode))
            continue;
          seen.add(rowNode);
          triples.push({ row: rowNode, price: leaves[i], amount: leaves[j], total: leaves[k] });
          i = k + 1;
          matched = true;
          break;
        }
      }
      if (!matched)
        i += 1;
    }
    return triples;
  }
  function headerKey(text) {
    return text.toLowerCase().replace(/[^a-z]/g, "");
  }
  var PRICE_HEADER_KEYS = new Set(["priceusdt", "pricetusdt", "priceusdtprice"]);
  var TOTAL_HEADER_KEYS = new Set(["totalusdt", "totaltusdt"]);
  function isPriceHeader(text) {
    return PRICE_HEADER_KEYS.has(headerKey(text));
  }
  function isTotalHeader(text) {
    return TOTAL_HEADER_KEYS.has(headerKey(text));
  }
  function findHeaders(doc) {
    const result = {};
    const body = doc.body;
    if (!body)
      return result;
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const raw = (node.nodeValue || "").trim();
        if (!raw || raw.length > 24)
          return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || SKIP_TAGS.has(parent.tagName))
          return NodeFilter.FILTER_REJECT;
        const text = parent.children.length === 0 ? (parent.textContent || "").trim() : raw;
        if (isPriceHeader(text)) {
          if (!result.price)
            result.price = parent;
        } else if (isTotalHeader(text)) {
          if (!result.total)
            result.total = parent;
        }
        return NodeFilter.FILTER_REJECT;
      }
    });
    walker.nextNode();
    return result;
  }
  function findContainer(anchor, totalHeader) {
    let fallback = null;
    let node = anchor;
    for (let depth = 0;node && depth < 14; depth += 1, node = node.parentElement) {
      const triples = collectTriples(node);
      if (triples.length >= 2)
        return node;
      if (!fallback && triples.length === 1 && totalHeader && node.contains(totalHeader))
        fallback = node;
    }
    return fallback;
  }
  function cellOf(leaf, row) {
    let node = leaf;
    while (node.parentElement && node.parentElement !== row)
      node = node.parentElement;
    return node;
  }
  function applyTriples(triples, rate, config) {
    const badgeStyle = priceBadgeStyle(config);
    const volumeColor = sanitizeColor(config.volumeColor);
    for (const triple of triples) {
      if (config.showPrice) {
        const price = parseNumber(siteText(triple.price));
        if (price != null && price > 0) {
          const text = formatIdr(price * rate, { prefix: config.prefix, mode: config.priceMode });
          const cell = cellOf(triple.price, triple.row);
          let badge = cell.querySelector(":scope > ." + PRICE_IDR);
          if (!badge) {
            badge = document.createElement("span");
            badge.className = `${INJECTED} ${PRICE_IDR}`;
            cell.appendChild(badge);
          }
          if (badge.dataset.tcStyle !== badgeStyle) {
            badge.dataset.tcStyle = badgeStyle;
            badge.setAttribute("style", badgeStyle);
          }
          if (badge.textContent !== text)
            badge.textContent = text;
        }
      }
      if (config.convertTotal) {
        const target = triple.total;
        const original = siteText(target);
        const total = parseNumber(original);
        if (total == null || total <= 0)
          continue;
        if ((target.dataset.tcVolColor ?? "") !== volumeColor) {
          target.dataset.tcVolColor = volumeColor;
          target.style.color = volumeColor;
        }
        const text = formatIdr(total * rate, { prefix: config.prefix, mode: config.volumeMode });
        if (cleanText(target) === text)
          continue;
        rendered.set(target, text);
        target.dataset.tcOrig = original;
        target.textContent = text;
      }
    }
  }
  function describeOrderbook() {
    const headers = findHeaders(document);
    const anchor = headers.price ?? headers.total ?? null;
    const container = anchor ? findContainer(anchor, headers.total) : null;
    const triples = container ? collectTriples(container) : [];
    return {
      header: anchor ? cleanText(anchor) : null,
      container: container ? `${container.tagName.toLowerCase()}${container.className ? "." + String(container.className).split(/\s+/).join(".") : ""}` : null,
      rows: triples.length,
      sample: triples.slice(0, 3).map((t) => `${siteText(t.price)} × ${siteText(t.amount)} = ${siteText(t.total)}`)
    };
  }
  function startOrderbook(options) {
    let container = null;
    let anchor = null;
    let observer = null;
    let debounce = null;
    let heartbeat = null;
    let stopped = false;
    const observe = (el) => {
      observer?.disconnect();
      observer = new MutationObserver(() => schedule(80));
      observer.observe(el, { childList: true, subtree: true, characterData: true });
    };
    const locate = () => {
      const headers = findHeaders(document);
      anchor = headers.price ?? headers.total ?? null;
      if (!anchor)
        return false;
      const found = findContainer(anchor, headers.total);
      if (!found)
        return false;
      container = found;
      observe(found);
      return true;
    };
    const tick = () => {
      if (stopped)
        return;
      if (!container || !container.isConnected) {
        container = null;
        if (!locate())
          return;
      }
      if (!container)
        return;
      const config = options.getConfig();
      const triples = collectTriples(container);
      if (triples.length === 0) {
        container = null;
        return;
      }
      applyTriples(triples, options.getRate(), config);
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
      if (!locate()) {}
      tick();
      heartbeat = setInterval(tick, 700);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
    return {
      rescan: () => {
        container = null;
        schedule(0);
      },
      stop: () => {
        stopped = true;
        if (debounce)
          clearTimeout(debounce);
        if (heartbeat)
          clearInterval(heartbeat);
        observer?.disconnect();
      }
    };
  }

  // src/lib/coininfo.ts
  var CACHE_TTL = 10 * 60 * 1000;
  var gateUrl = (coin) => `https://api.gateio.ws/api/v4/spot/currencies/${encodeURIComponent(coin)}`;
  var mexcUrls = (coin) => [
    `https://www.mexc.com/api/asset/v1/coin/detail?currency=${encodeURIComponent(coin)}`,
    `https://www.mexc.com/api/v3/capital/config/getall`,
    `https://www.mexc.fm/api/v3/capital/config/getall`,
    `https://www.mexc.com/api/asset/v1/coin/list`
  ];
  var cacheKey = (site, coin) => `coininfo.${site}.${coin}`;
  function asBool(value, fallback = true) {
    if (typeof value === "boolean")
      return value;
    if (typeof value === "number")
      return value !== 0;
    if (typeof value === "string")
      return !/^(false|0|off|disabled?)$/i.test(value.trim());
    return fallback;
  }
  function pickChainList(raw) {
    const candidates = [raw?.networkList, raw?.chains, raw?.networks, raw?.data?.networkList];
    for (const candidate of candidates)
      if (Array.isArray(candidate))
        return candidate;
    return [];
  }
  function fromGate(raw, coin) {
    const chains = (Array.isArray(raw?.chains) ? raw.chains : []).map((chain) => ({
      name: String(chain?.name ?? chain?.chain ?? "?"),
      deposit: !asBool(chain?.deposit_disabled, false),
      withdraw: !asBool(chain?.withdraw_disabled, false),
      depositDelayed: asBool(chain?.deposit_delayed, false),
      withdrawDelayed: asBool(chain?.withdraw_delayed, false)
    }));
    return {
      coin,
      deposit: !asBool(raw?.deposit_disabled, false),
      withdraw: !asBool(raw?.withdraw_disabled, false),
      chains,
      source: "gate:spot/currencies",
      updatedAt: Date.now()
    };
  }
  function fromMexc(raw, coin) {
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.data?.list) ? raw.data.list : [];
    const entry = list.find((item) => String(item?.coin ?? item?.currency ?? item?.symbol ?? "").toUpperCase() === coin) ?? (String(raw?.coin ?? raw?.currency ?? "").toUpperCase() === coin ? raw : null);
    if (!entry)
      return null;
    const chains = pickChainList(entry).map((chain) => ({
      name: String(chain?.network ?? chain?.chain ?? chain?.name ?? "?"),
      deposit: asBool(chain?.depositEnable ?? chain?.deposit_enable ?? chain?.depositEnabled, true),
      withdraw: asBool(chain?.withdrawEnable ?? chain?.withdraw_enable ?? chain?.withdrawEnabled, true),
      depositDelayed: asBool(chain?.depositDelayed ?? chain?.deposit_delayed, false),
      withdrawDelayed: asBool(chain?.withdrawDelayed ?? chain?.withdraw_delayed, false),
      minWithdraw: chain?.withdrawMin != null ? Number(chain.withdrawMin) : null
    }));
    return {
      coin,
      deposit: asBool(entry?.depositEnable ?? entry?.deposit_enable, true),
      withdraw: asBool(entry?.withdrawEnable ?? entry?.withdraw_enable, true),
      chains,
      source: "mexc:asset",
      updatedAt: Date.now()
    };
  }
  function readCache(site, coin) {
    const cached = getStored(cacheKey(site, coin), null);
    if (!cached || !cached.updatedAt)
      return null;
    if (Date.now() - cached.updatedAt > CACHE_TTL)
      return null;
    return cached;
  }
  async function getCoinInfo(site, coin, force = false) {
    if (!force) {
      const cached = readCache(site, coin);
      if (cached)
        return cached;
    }
    const fail = (message) => ({
      coin,
      deposit: true,
      withdraw: true,
      chains: [],
      source: "unavailable",
      updatedAt: Date.now(),
      error: message
    });
    if (site === "gate") {
      try {
        const raw = await requestJson(gateUrl(coin));
        const info = fromGate(raw, coin);
        setStored(cacheKey(site, coin), info);
        return info;
      } catch (error) {
        log("gate coin info failed", error);
        return fail("Gate API unreachable");
      }
    }
    if (site === "mexc") {
      for (const url of mexcUrls(coin)) {
        try {
          const raw = await requestJson(url);
          const info = fromMexc(raw, coin);
          if (info) {
            setStored(cacheKey(site, coin), info);
            return info;
          }
        } catch (error) {
          log(`mexc coin info failed (${url})`, error);
        }
      }
      return fail("MEXC asset API unavailable");
    }
    return fail("Unsupported site");
  }

  // src/lib/panel.ts
  var POS_KEY = "ui.panel.pos";
  var COLLAPSE_KEY = "ui.panel.collapsed";
  var CSS = `
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
.chains { display: flex; flex-direction: column; gap: 2px; max-height: 132px; overflow-y: auto; }
.chain {
  display: flex; align-items: center; gap: 6px; font-size: 11px;
  padding: 2px 4px; border-radius: 4px; background: rgba(255, 255, 255, 0.03);
}
.chain .name { color: #c9d1d9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chain .flags { margin-left: auto; display: flex; gap: 6px; font-variant-numeric: tabular-nums; }
.chain .flags span { color: #6e7681; }
.chain .flags span.yes { color: #3fb950; }
.chain .flags span.no { color: #f85149; }
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
.foot .retry { all: unset; cursor: pointer; color: #58a6ff; }
`;
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
    style.textContent = CSS;
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
      setChip(depChip, info.deposit, depositDelayed);
      setChip(wdChip, info.withdraw, withdrawDelayed);
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
          row.append(name, flags);
          chainsEl.append(row);
        }
      }
      const rate = currentRate();
      const rateText = rate.rate ? ` · 1 USDT = ${formatIdr(rate.rate, { mode: "full" })}` : "";
      footEl.textContent = `${timeAgo(info.updatedAt)}${rateText}`;
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
      const action = target.dataset.act;
      if (action === "deposit")
        window.open(depositUrl(options.site, coin), "_blank", "noopener");
      if (action === "withdraw")
        window.open(withdrawUrl(options.site, coin), "_blank", "noopener");
      if (action === "refresh")
        load(true);
      if (action === "collapse") {
        const collapsed = panel.dataset.collapsed !== "true";
        panel.dataset.collapsed = String(collapsed);
        target.textContent = collapsed ? "+" : "−";
        setStored(COLLAPSE_KEY, collapsed);
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
      if (getStored(COLLAPSE_KEY, false)) {
        panel.dataset.collapsed = "true";
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
  function num(key, fallback) {
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
      volumeColor: str("idr.volumeColor", "")
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
    const orderbook = startOrderbook({ getRate: rateValue, getConfig: orderbookConfig });
    globalThis.TradeCat = {
      describe: describeOrderbook,
      rescan: () => orderbook.rescan(),
      rate: () => rateValue(),
      setRate: (value) => saveRate(value, "manual")
    };
    const panel = panelConfig().enabled ? mountPanel({ site, getConfig: panelConfig }) : null;
    onRateChange(() => orderbook.rescan());
    getUsdtIdrRate({
      ttlHours: num("idr.ttlHours", 6),
      enableNetwork: bool("idr.enableNetworkRate", false),
      fallbackRate: num("idr.fallbackRate", 18000)
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
      orderbook.rescan();
    });
    registerMenu({
      rescan: () => orderbook.rescan(),
      setRate: () => {
        const answer = window.prompt("1 USDT = ? IDR", String(rateValue()));
        if (!answer)
          return;
        const parsed = Number(answer.replace(/[^\d.]/g, ""));
        if (!Number.isFinite(parsed) || parsed <= 0)
          return;
        saveRate(parsed, "manual");
        orderbook.rescan();
      },
      debug: () => {
        const info = describeOrderbook();
        log("orderbook debug", info);
        if (typeof GM_notification === "function") {
          GM_notification({ title: "TradeCat", text: `${info.rows} rows · header: ${info.header ?? "not found"}` });
        }
      }
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void boot(), { once: true });
  } else {
    boot();
  }
})();


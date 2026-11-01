/**
 * Storage helper.
 *
 * ScriptCat/Tampermonkey `GM_*` storage is the source of truth (it is shared
 * between scripts that declare the same `@storageName`), with `localStorage`
 * as a mirror so a plain page script or the DevTools console can also set
 * values.
 */

const LS_PREFIX = 'tradecat:';

export function hasGM(): boolean {
  try {
    return typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  } catch {
    return false;
  }
}

export function getStored<T>(key: string, fallback: T): T {
  try {
    if (hasGM()) {
      const value = GM_getValue(key, undefined);
      if (value !== undefined && value !== null) return value as T;
    }
  } catch {
    /* ignore */
  }
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw !== null) return JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function setStored(key: string, value: unknown): void {
  try {
    if (hasGM()) GM_setValue(key, value);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function deleteStored(key: string): void {
  try {
    if (hasGM() && typeof GM_deleteValue === 'function') GM_deleteValue(key);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(LS_PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** JSON fetch through GM_xmlhttpRequest when available (bypasses CORS). */
export async function requestJson<T = any>(url: string, timeoutMs = 12000): Promise<T> {
  const text = await requestText(url, timeoutMs);
  return JSON.parse(text) as T;
}

export async function requestText(url: string, timeoutMs = 12000): Promise<string> {
  if (hasGM() && typeof GM_xmlhttpRequest === 'function') {
    return new Promise<string>((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: timeoutMs,
        headers: { Accept: 'application/json, text/plain, */*' },
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) resolve(res.responseText);
          else reject(new Error(`HTTP ${res.status} for ${url}`));
        },
        onerror: () => reject(new Error(`network error for ${url}`)),
        ontimeout: () => reject(new Error(`timeout for ${url}`)),
      });
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export function log(...args: unknown[]): void {
  try {
    console.log('%c[TradeCat]', 'color:#22c55e;font-weight:bold', ...args);
  } catch {
    /* ignore */
  }
}

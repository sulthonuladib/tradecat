// Minimal ScriptCat / Tampermonkey API surface used by these scripts.
declare function GM_getValue(key: string, defaultValue?: any): any;
declare function GM_setValue(key: string, value: any): void;
declare function GM_deleteValue(key: string): void;
declare function GM_registerMenuCommand(name: string, fn: () => void, accessKey?: string): void;
declare function GM_notification(details: { text: string; title?: string; timeout?: number } | string, ondone?: () => void): void;
declare function GM_log(message: string, level?: 'debug' | 'info' | 'warn' | 'error'): void;
declare function GM_xmlhttpRequest(details: {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  onload?: (res: { status: number; responseText: string }) => void;
  onerror?: (err: unknown) => void;
  ontimeout?: () => void;
}): void;
declare function CAT_userConfig(): void;
declare const unsafeWindow: any;

/**
 * tvbox.ts — client for the local TVBox spider sidecar + TVBox config parsing.
 *
 * Sidecar contract (Phase 1, Java service on 127.0.0.1:17890):
 *   GET  /spiders -> {"spiders":["com.github.catvod.spider.Bili", ...]}
 *   POST /invoke   body {"spider","method","args",...} -> {"ok":true,"result":"{...TVBox JSON...}"}
 *
 * TVBox JSON shapes:
 *   home     -> {"class":[{"type_id","type_name"}],"filters":{}}
 *   category -> {"page","pagecount","list":[{"vod_id","vod_name","vod_pic","vod_remarks"}]}
 *   detail   -> {"list":[{"vod_id","vod_name","vod_play_from","vod_play_url"}]}
 *               vod_play_url: "第1集$http://...#第2集$http://..."
 *   player   -> {"url":"http://...","header":{}}
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export const SIDECAR_BASE = 'http://127.0.0.1:17890';
const SIDECAR_TIMEOUT_MS = 8000;

/** A site entry from a TVBox JSON config. */
export interface TvboxSite {
  key: string;
  name: string;
  /** 1 = direct JSON API, 3 = spider (JAR), ... */
  type: number;
  /** For type 3: e.g. "csp_Bili". For type 1: the API base URL. */
  api: string;
  /** Spider init ext: strings stay as-is, objects are JSON-stringified (like TVBox). */
  ext?: string;
  /** Which config URL this site came from (for management UI). */
  configUrl: string;
}

/** A live (直播) entry from a TVBox JSON config `lives[]`. */
export interface TvboxLive {
  name: string;
  url: string;
  ua?: string;
  configUrl: string;
}

/** A user-added TVBox config source. */
export interface TvboxConfigSource {
  url: string;
  addedAt: number;
}

export interface TvboxCategory {
  type_id: string;
  type_name: string;
}

export interface TvboxVideo {
  vod_id: string;
  vod_name: string;
  vod_pic?: string;
  vod_remarks?: string;
}

export interface TvboxEpisode {
  name: string;
  url: string;
}

export interface TvboxDetail {
  vod_id: string;
  vod_name: string;
  vod_pic?: string;
  vod_remarks?: string;
  /** Raw "from" string, "$$$" separated when multiple sources. */
  vod_play_from?: string;
  episodes: TvboxEpisode[];
}

/** Map a TVBox site `api` value (e.g. "csp_Bili") to the sidecar spider class. */
export function apiToSpiderClass(api: string): string | null {
  const m = /^csp_([A-Za-z0-9_]+)$/.exec(api.trim());
  if (!m) return null;
  return `com.github.catvod.spider.${m[1]}`;
}

/**
 * Resolve a site `api` to a spider class the sidecar actually has.
 * Handles protected configs (e.g. 饭太硬) whose apis are `csp_XxxGuard`:
 * their Guard jar needs Android ARM native libs and can't run on desktop,
 * so we fall back to the plain `Xxx` spider bundled with the sidecar.
 * Matching is case-insensitive (csp_Appgz -> AppGZ, csp_WoGG -> Wogg).
 */
export function resolveSpiderClass(api: string, available: Iterable<string>): string | null {
  const m = /^csp_([A-Za-z0-9_]+)$/.exec((api || '').trim());
  if (!m) return null;
  const byLower = new Map<string, string>();
  for (const cls of available) {
    const simple = cls.slice(cls.lastIndexOf('.') + 1);
    byLower.set(simple.toLowerCase(), cls);
  }
  const name = m[1];
  const noGuard = name.replace(/guard$/i, '');
  // Wrapper prefixes used by protected configs (王二小: WexAi/AiNew…, 摸鱼: Fish…).
  // `Live…` is deliberately not stripped: LiveAiBiLi is a live spider, not Bili VOD.
  const stripped = noGuard.replace(/^(wex|manju)/i, '').replace(/^ai/i, '').replace(/^new/i, '');
  // Same site, different spider name in the bundled jar.
  const ALIAS: Record<string, string> = { wencai: 'Jpys', cz: 'Czzy', newcz: 'Czzy', guazi: 'AppGZ', nmyswv: 'Nmys' };
  for (const c of [name, noGuard, stripped]) {
    const hit = byLower.get(c.toLowerCase());
    if (hit) return hit;
    const alias = ALIAS[c.toLowerCase()];
    if (alias && byLower.get(alias.toLowerCase())) return byLower.get(alias.toLowerCase())!;
  }
  return null;
}

/** Parse TVBox config text: tolerates // line comments and a BOM. */
export function parseTvboxConfigText(text: string): any {
  const clean = text.replace(/^\uFEFF/, '');
  try {
    return JSON.parse(clean);
  } catch {
    // Strip full-line // comments (common in hand-edited configs), keep URLs intact.
    return JSON.parse(clean.replace(/^\s*\/\/.*$/gm, ''));
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await (tauriFetch as unknown as typeof fetch)(url, {
      signal: ctrl.signal as any,
      headers: { 'User-Agent': 'okhttp/3.12.13' },
    } as any);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = SIDECAR_TIMEOUT_MS): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await (tauriFetch as unknown as typeof fetch)(url, {
      ...init,
      signal: ctrl.signal as any,
    } as any);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Check the sidecar is reachable; returns the spider class list. */
export async function getSidecarSpiders(): Promise<string[]> {
  const data = await fetchJson(`${SIDECAR_BASE}/spiders`);
  const list = data?.spiders;
  if (!Array.isArray(list)) throw new Error('bad /spiders response');
  return list as string[];
}

/** Invoke one spider method through the sidecar; returns the parsed TVBox JSON. */
export async function invokeSpider(
  spiderClass: string,
  method: string,
  args: unknown[],
  extend?: string,
  timeoutMs = 30000,
): Promise<any> {
  const data = await fetchJson(
    `${SIDECAR_BASE}/invoke`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spider: spiderClass, method, args, extend: extend ?? '' }),
    },
    timeoutMs,
  );
  if (!data?.ok) throw new Error(data?.error || 'spider invoke failed');
  const raw = data.result;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

export interface TvboxConfig {
  sites: TvboxSite[];
  lives: TvboxLive[];
}

function extToString(ext: unknown): string | undefined {
  if (ext == null) return undefined;
  if (typeof ext === 'string') return ext;
  try { return JSON.stringify(ext); } catch { return String(ext); }
}

/** Fetch and parse a full TVBox JSON config (sites + lives). */
export async function fetchTvboxConfigFull(url: string): Promise<TvboxConfig> {
  const data = parseTvboxConfigText(await fetchText(url, 20000));
  const rawSites = Array.isArray(data?.sites) ? data.sites : [];
  const rawLives = Array.isArray(data?.lives) ? data.lives : [];
  if (rawSites.length === 0 && rawLives.length === 0) throw new Error('config has no sites[] or lives[]');
  const sites: TvboxSite[] = rawSites
    .filter((s: any) => s && typeof s.key === 'string' && typeof s.name === 'string')
    .map((s: any) => ({
      key: String(s.key),
      name: String(s.name),
      type: Number(s.type ?? 0),
      api: String(s.api ?? ''),
      ext: extToString(s.ext),
      configUrl: url,
    }));
  const lives: TvboxLive[] = rawLives
    .filter((l: any) => l && typeof l.url === 'string' && /^https?:\/\//i.test(l.url))
    // 127.0.0.1:9978 is TVBox's own on-device proxy; it doesn't exist on desktop.
    .filter((l: any) => !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(l.url))
    .map((l: any) => ({
      name: String(l.name ?? l.group ?? '直播'),
      url: String(l.url),
      ua: l.ua ? String(l.ua) : undefined,
      configUrl: url,
    }));
  return { sites, lives };
}

/** Fetch and parse a TVBox JSON config URL into site entries. */
export async function fetchTvboxConfig(url: string): Promise<TvboxSite[]> {
  return (await fetchTvboxConfigFull(url)).sites;
}

/** Split a TVBox vod_play_url ("name$url#name$url...") into episodes. */
export function parseEpisodes(vodPlayUrl: string | undefined): TvboxEpisode[] {
  if (!vodPlayUrl) return [];
  // Multiple sources are "$$$" separated; take the first source for v1.
  const first = vodPlayUrl.split('$$$')[0] ?? '';
  return first
    .split('#')
    .map((part) => {
      const idx = part.indexOf('$');
      if (idx < 0) return null;
      const name = part.slice(0, idx).trim() || '正片';
      const url = part.slice(idx + 1).trim();
      if (!url) return null;
      return { name, url };
    })
    .filter((e): e is TvboxEpisode => e !== null);
}

/** Normalize a detailContent response into TvboxDetail. */
export function normalizeDetail(data: any): TvboxDetail | null {
  const item = data?.list?.[0];
  if (!item) return null;
  return {
    vod_id: String(item.vod_id ?? ''),
    vod_name: String(item.vod_name ?? ''),
    vod_pic: item.vod_pic ? String(item.vod_pic) : undefined,
    vod_remarks: item.vod_remarks ? String(item.vod_remarks) : undefined,
    vod_play_from: item.vod_play_from ? String(item.vod_play_from) : undefined,
    episodes: parseEpisodes(item.vod_play_url ? String(item.vod_play_url) : undefined),
  };
}

/** Normalize a categoryContent response list. */
export function normalizeVideoList(data: any): { videos: TvboxVideo[]; page: number; pagecount: number } {
  const list = Array.isArray(data?.list) ? data.list : [];
  return {
    videos: list.map((v: any) => ({
      vod_id: String(v.vod_id ?? ''),
      vod_name: String(v.vod_name ?? ''),
      vod_pic: v.vod_pic ? String(v.vod_pic) : undefined,
      vod_remarks: v.vod_remarks ? String(v.vod_remarks) : undefined,
    })),
    page: Number(data?.page ?? 1),
    pagecount: Number(data?.pagecount ?? 1),
  };
}

/** Normalize a homeContent response into categories. */
export function normalizeCategories(data: any): TvboxCategory[] {
  const list = Array.isArray(data?.class) ? data.class : [];
  return list.map((c: any) => ({
    type_id: String(c.type_id ?? ''),
    type_name: String(c.type_name ?? ''),
  }));
}

// ---------------------------------------------------------------------------
// Type-1 direct JSON API sites (AppleCMS/Maccms style, no spider needed)
//   home:     GET {api}?ac=home            -> {"class":[...]} (some APIs: GET {api})
//   category: GET {api}?ac=videolist&t={tid}&pg={pg}
//   detail:   GET {api}?ac=detail&ids={id}
//   search:   GET {api}?ac=videolist&wd={kw}&pg={pg}
// ---------------------------------------------------------------------------

function type1Url(api: string, params: Record<string, string>): string {
  const base = api.includes('?') ? `${api}&` : `${api}?`;
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${base}${qs}`;
}

/** Fetch categories for a type-1 site. */
export async function type1Home(api: string): Promise<TvboxCategory[]> {
  // Try ?ac=home first; fall back to bare api (some return class list directly).
  let data: any = null;
  try {
    data = await fetchJson(type1Url(api, { ac: 'home' }), undefined, 20000);
  } catch {
    data = null;
  }
  if (!data?.class) {
    try {
      data = await fetchJson(api, undefined, 20000);
    } catch {
      data = null;
    }
  }
  return normalizeCategories(data);
}

/** Fetch a video list page for a type-1 site. */
export async function type1Category(
  api: string,
  tid: string,
  pg: number,
): Promise<{ videos: TvboxVideo[]; page: number; pagecount: number }> {
  const data = await fetchJson(type1Url(api, { ac: 'videolist', t: tid, pg: String(pg) }), undefined, 20000);
  return normalizeVideoList(data);
}

/** Fetch detail for a type-1 site. */
export async function type1Detail(api: string, id: string): Promise<TvboxDetail | null> {
  const data = await fetchJson(type1Url(api, { ac: 'detail', ids: id }), undefined, 20000);
  return normalizeDetail(data);
}

/** Search a type-1 site. */
export async function type1Search(
  api: string,
  keyword: string,
  pg = 1,
): Promise<{ videos: TvboxVideo[]; page: number; pagecount: number }> {
  const data = await fetchJson(type1Url(api, { ac: 'videolist', wd: keyword, pg: String(pg) }), undefined, 20000);
  return normalizeVideoList(data);
}

// ---------------------------------------------------------------------------
// Local persistence for user-added config URLs (small data: localStorage is fine)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ynotv.tvbox.configs.v1';

/** Built-in configs added once for every user (饭太硬 / 摸鱼 / 王二小). */
export const DEFAULT_CONFIG_URLS = [
  'https://0.wudaozhe.net/tvbox/饭太硬.json',
  'https://0.wudaozhe.net/tvbox/摸鱼.json',
  'https://0.wudaozhe.net/tvbox/王二小.json',
];
const DEFAULTS_SEEDED_KEY = 'ynotv.tvbox.defaults.v1';

export function loadConfigSources(): TvboxConfigSource[] {
  let list: TvboxConfigSource[] = [];
  try {
    const raw = (globalThis as any).localStorage?.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) list = arr.filter((s) => s && typeof s.url === 'string');
  } catch {
    list = [];
  }
  // Seed the defaults once; if the user deletes one later it stays deleted.
  try {
    const ls = (globalThis as any).localStorage;
    if (ls && !ls.getItem(DEFAULTS_SEEDED_KEY)) {
      const have = new Set(list.map((c) => c.url));
      for (const url of DEFAULT_CONFIG_URLS) if (!have.has(url)) list.push({ url, addedAt: Date.now() });
      ls.setItem(STORAGE_KEY, JSON.stringify(list));
      ls.setItem(DEFAULTS_SEEDED_KEY, '1');
    }
  } catch {
    /* storage unavailable */
  }
  return list;
}

export function saveConfigSources(sources: TvboxConfigSource[]): void {
  try {
    (globalThis as any).localStorage?.setItem(STORAGE_KEY, JSON.stringify(sources));
  } catch (e) {
    console.warn('[tvbox] failed to persist config sources', e);
  }
}

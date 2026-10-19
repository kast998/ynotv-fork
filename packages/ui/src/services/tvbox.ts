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
  ext?: string;
  /** Which config URL this site came from (for management UI). */
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
  extend?: Record<string, string>,
  timeoutMs = 30000,
): Promise<any> {
  const data = await fetchJson(
    `${SIDECAR_BASE}/invoke`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spider: spiderClass, method, args, extend: extend ?? {} }),
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

/** Fetch and parse a TVBox JSON config URL into site entries. */
export async function fetchTvboxConfig(url: string): Promise<TvboxSite[]> {
  const data = await fetchJson(url, undefined, 20000);
  const sites = data?.sites;
  if (!Array.isArray(sites)) throw new Error('config has no sites[]');
  return sites
    .filter((s: any) => s && typeof s.key === 'string' && typeof s.name === 'string')
    .map((s: any) => ({
      key: String(s.key),
      name: String(s.name),
      type: Number(s.type ?? 0),
      api: String(s.api ?? ''),
      ext: s.ext != null ? String(s.ext) : undefined,
      configUrl: url,
    }));
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
// Local persistence for user-added config URLs (small data: localStorage is fine)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ynotv.tvbox.configs.v1';

export function loadConfigSources(): TvboxConfigSource[] {
  try {
    const raw = (globalThis as any).localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((s) => s && typeof s.url === 'string');
  } catch {
    return [];
  }
}

export function saveConfigSources(sources: TvboxConfigSource[]): void {
  try {
    (globalThis as any).localStorage?.setItem(STORAGE_KEY, JSON.stringify(sources));
  } catch (e) {
    console.warn('[tvbox] failed to persist config sources', e);
  }
}

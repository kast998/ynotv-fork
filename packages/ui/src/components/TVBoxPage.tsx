import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SIDECAR_BASE,
  TvboxSite,
  TvboxConfigSource,
  TvboxCategory,
  TvboxVideo,
  TvboxDetail,
  apiToSpiderClass,
  getSidecarSpiders,
  invokeSpider,
  fetchTvboxConfig,
  normalizeCategories,
  normalizeVideoList,
  normalizeDetail,
  type1Home,
  type1Category,
  type1Detail,
  type1Search,
  loadConfigSources,
  saveConfigSources,
} from '../services/tvbox';
import type { VodPlayInfo } from '../types/media';
import type { VodPlayerMode } from './vod/SplitPlayButton';
import './TVBoxPage.css';

interface TVBoxPageProps {
  onPlay: (info: VodPlayInfo, targetMode?: VodPlayerMode) => void;
  onClose: () => void;
}

type Screen =
  | { name: 'sites' }
  | { name: 'home'; site: TvboxSite }
  | { name: 'category'; site: TvboxSite; cat: TvboxCategory; page: number }
  | { name: 'detail'; site: TvboxSite; video: TvboxVideo }
  | { name: 'search'; site: TvboxSite; query: string };

/** Resolve which spider class (if any) backs a site, given the sidecar's list. */
function resolveSpider(site: TvboxSite, available: Set<string>): string | null {
  const cls = apiToSpiderClass(site.api);
  if (cls && available.has(cls)) return cls;
  return null;
}

export function TVBoxPage({ onPlay, onClose }: TVBoxPageProps) {
  const [sidecarState, setSidecarState] = useState<'checking' | 'online' | 'offline'>('checking');
  const [spiderClasses, setSpiderClasses] = useState<string[]>([]);
  const [configs, setConfigs] = useState<TvboxConfigSource[]>(() => loadConfigSources());
  const [sites, setSites] = useState<TvboxSite[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: 'sites' });
  const [showManager, setShowManager] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const spiderSet = useMemo(() => new Set(spiderClasses), [spiderClasses]);

  // ---- sidecar status -------------------------------------------------------
  const checkSidecar = useCallback(async () => {
    setSidecarState('checking');
    try {
      const list = await getSidecarSpiders();
      if (!mountedRef.current) return;
      setSpiderClasses(list);
      setSidecarState('online');
    } catch {
      if (!mountedRef.current) return;
      setSidecarState('offline');
    }
  }, []);

  useEffect(() => { void checkSidecar(); }, [checkSidecar]);

  // ---- load sites from configs ----------------------------------------------
  const reloadSites = useCallback(async (cfgList: TvboxConfigSource[]) => {
    setSitesLoading(true);
    setSitesError(null);
    try {
      const results = await Promise.all(
        cfgList.map(async (c) => {
          try {
            return await fetchTvboxConfig(c.url);
          } catch (e) {
            console.warn('[tvbox] config failed', c.url, e);
            return [] as TvboxSite[];
          }
        }),
      );
      if (!mountedRef.current) return;
      const all = results.flat();
      // de-dupe by key, keep first occurrence
      const seen = new Set<string>();
      setSites(all.filter((s) => {
        const k = `${s.configUrl}::${s.key}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }));
    } catch (e) {
      if (mountedRef.current) setSitesError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setSitesLoading(false);
    }
  }, []);

  useEffect(() => { void reloadSites(configs); }, [configs, reloadSites]);

  const addConfig = useCallback(async () => {
    const url = newUrl.trim();
    if (!url || adding) return;
    if (configs.some((c) => c.url === url)) {
      setNewUrl('');
      return;
    }
    setAdding(true);
    try {
      // Validate by fetching before saving.
      await fetchTvboxConfig(url);
      const next = [...configs, { url, addedAt: Date.now() }];
      setConfigs(next);
      saveConfigSources(next);
      setNewUrl('');
    } catch (e) {
      setSitesError(`配置加载失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAdding(false);
    }
  }, [newUrl, adding, configs]);

  const removeConfig = useCallback((url: string) => {
    const next = configs.filter((c) => c.url !== url);
    setConfigs(next);
    saveConfigSources(next);
    setScreen({ name: 'sites' });
  }, [configs]);

  const compatibleSites = useMemo(
    () => sites.filter((s) => s.type === 1 || resolveSpider(s, spiderSet)),
    [sites, spiderSet],
  );
  const incompatibleSites = useMemo(
    () => sites.filter((s) => s.type !== 1 && !resolveSpider(s, spiderSet)),
    [sites, spiderSet],
  );

  return (
    <div className="tvbox-page">
      <header className="tvbox-header">
        <button className="tvbox-back" onClick={onClose} aria-label="返回">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
        </button>
        <h1 className="tvbox-title">TVBox</h1>
        <div
          className={`tvbox-status tvbox-status--${sidecarState}`}
          title={sidecarState === 'online' ? `爬虫服务正常 (${spiderClasses.length} 个)` : sidecarState === 'offline' ? `无法连接 ${SIDECAR_BASE}` : '检查中'}
          onClick={() => void checkSidecar()}
        >
          <span className="tvbox-status-dot" />
          <span className="tvbox-status-text">
            {sidecarState === 'online' && `爬虫服务 · ${spiderClasses.length}`}
            {sidecarState === 'offline' && '爬虫服务未启动'}
            {sidecarState === 'checking' && '检查中…'}
          </span>
        </div>
        <button
          className="tvbox-manage-btn"
          onClick={() => setShowManager((v) => !v)}
        >
          管理站点
        </button>
      </header>

      {sidecarState === 'offline' && (
        <div className="tvbox-warning">
          连不上本地爬虫服务（{SIDECAR_BASE}）。请确认 TVBox sidecar 已随 ynoTV 启动，或手动启动后再点状态重新检查。
        </div>
      )}

      {showManager && (
        <section className="tvbox-manager">
          <div className="tvbox-add-row">
            <input
              className="tvbox-input"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addConfig(); }}
              placeholder="粘贴 TVBox JSON 配置地址，回车添加"
              disabled={adding}
            />
            <button className="tvbox-btn" onClick={() => void addConfig()} disabled={adding || !newUrl.trim()}>
              {adding ? '添加中…' : '添加'}
            </button>
          </div>
          {configs.length === 0 && (
            <p className="tvbox-hint">还没有配置。粘贴你在 TVBox 里用的「配置地址」即可，和手机上填的是同一个。</p>
          )}
          <ul className="tvbox-config-list">
            {configs.map((c) => (
              <li key={c.url} className="tvbox-config-item">
                <span className="tvbox-config-url" title={c.url}>{c.url}</span>
                <button className="tvbox-btn tvbox-btn--danger" onClick={() => removeConfig(c.url)}>删除</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sitesError && <div className="tvbox-error">{sitesError}</div>}

      {screen.name === 'sites' && (
        <SiteList
          loading={sitesLoading}
          compatible={compatibleSites}
          incompatible={incompatibleSites}
          onSelect={(site) => setScreen({ name: 'home', site })}
        />
      )}
      {screen.name === 'home' && (
        <SiteHome
          key={screen.site.key}
          site={screen.site}
          spiderClass={resolveSpider(screen.site, spiderSet) ?? ''}
          onBack={() => setScreen({ name: 'sites' })}
          onOpenCategory={(cat) => setScreen({ name: 'category', site: screen.site, cat, page: 1 })}
          onSearch={(query) => setScreen({ name: 'search', site: screen.site, query })}
        />
      )}
      {screen.name === 'category' && (
        <CategoryView
          key={`${screen.site.key}:${screen.cat.type_id}:${screen.page}`}
          site={screen.site}
          spiderClass={resolveSpider(screen.site, spiderSet) ?? ''}
          cat={screen.cat}
          page={screen.page}
          onBack={() => setScreen({ name: 'home', site: screen.site })}
          onPage={(page) => setScreen({ name: 'category', site: screen.site, cat: screen.cat, page })}
          onOpenVideo={(video) => setScreen({ name: 'detail', site: screen.site, video })}
        />
      )}
      {screen.name === 'detail' && (
        <DetailView
          key={`${screen.site.key}:${screen.video.vod_id}`}
          site={screen.site}
          spiderClass={resolveSpider(screen.site, spiderSet) ?? ''}
          video={screen.video}
          onBack={() => setScreen({ name: 'home', site: screen.site })}
          onPlay={onPlay}
        />
      )}
      {screen.name === 'search' && (
        <SearchView
          key={`${screen.site.key}:search:${screen.query}`}
          site={screen.site}
          spiderClass={resolveSpider(screen.site, spiderSet) ?? ''}
          query={screen.query}
          onBack={() => setScreen({ name: 'home', site: screen.site })}
          onOpenVideo={(video) => setScreen({ name: 'detail', site: screen.site, video })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SiteList({ loading, compatible, incompatible, onSelect }: {
  loading: boolean;
  compatible: TvboxSite[];
  incompatible: TvboxSite[];
  onSelect: (s: TvboxSite) => void;
}) {
  if (loading) return <div className="tvbox-loading">加载站点中…</div>;
  if (compatible.length === 0 && incompatible.length === 0) {
    return <div className="tvbox-empty">暂无站点。点右上角「管理站点」添加 TVBox 配置地址。</div>;
  }
  return (
    <div className="tvbox-sites">
      {compatible.length > 0 && (
        <>
          <h2 className="tvbox-section-title">可用站点（{compatible.length}）</h2>
          <div className="tvbox-grid">
            {compatible.map((s) => (
              <button key={`${s.configUrl}::${s.key}`} className="tvbox-card" onClick={() => onSelect(s)}>
                <span className="tvbox-card-name">{s.name}</span>
                <span className="tvbox-card-meta">{s.api}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {incompatible.length > 0 && (
        <>
          <h2 className="tvbox-section-title">需要爬虫（sidecar 暂无对应爬虫）</h2>
          <div className="tvbox-grid">
            {incompatible.map((s) => (
              <div key={`${s.configUrl}::${s.key}`} className="tvbox-card tvbox-card--disabled" title={`缺少爬虫: ${s.api}`}>
                <span className="tvbox-card-name">{s.name}</span>
                <span className="tvbox-card-meta">缺少爬虫</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SiteHome({ site, spiderClass, onBack, onOpenCategory, onSearch }: {
  site: TvboxSite;
  spiderClass: string;
  onBack: () => void;
  onOpenCategory: (c: TvboxCategory) => void;
  onSearch: (q: string) => void;
}) {
  const [cats, setCats] = useState<TvboxCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cats = site.type === 1
          ? await type1Home(site.api)
          : normalizeCategories(await invokeSpider(spiderClass, 'homeContent', [true]));
        if (!alive) return;
        setCats(cats);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [spiderClass, site]);

  return (
    <div>
      <div className="tvbox-subheader">
        <button className="tvbox-btn" onClick={onBack}>‹ 站点</button>
        <h2 className="tvbox-section-title">{site.name}</h2>
        <form
          className="tvbox-search-form"
          onSubmit={(e) => { e.preventDefault(); if (q.trim()) onSearch(q.trim()); }}
        >
          <input
            className="tvbox-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="在本店搜索…"
          />
        </form>
      </div>
      {loading && <div className="tvbox-loading">加载分类中…</div>}
      {error && <div className="tvbox-error">{error}</div>}
      {!loading && !error && cats.length > 0 && (
        <div className="tvbox-grid">
          {cats.map((c) => (
            <button key={c.type_id} className="tvbox-card" onClick={() => onOpenCategory(c)}>
              <span className="tvbox-card-name">{c.type_name}</span>
            </button>
          ))}
        </div>
      )}
      {!loading && !error && cats.length === 0 && (
        <div className="tvbox-empty">这个站点没有分类，可以用上面的搜索框找片。</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function VideoCard({ v, onOpen }: { v: TvboxVideo; onOpen: () => void }) {
  return (
    <button className="tvbox-video-card" onClick={onOpen}>
      {v.vod_pic
        ? <img className="tvbox-poster" src={v.vod_pic} alt="" loading="lazy" referrerPolicy="no-referrer" />
        : <div className="tvbox-poster tvbox-poster--empty">无图</div>}
      <div className="tvbox-video-name" title={v.vod_name}>{v.vod_name}</div>
      {v.vod_remarks && <div className="tvbox-video-remarks">{v.vod_remarks}</div>}
    </button>
  );
}

function CategoryView({ site, spiderClass, cat, page, onBack, onPage, onOpenVideo }: {
  site: TvboxSite;
  spiderClass: string;
  cat: TvboxCategory;
  page: number;
  onBack: () => void;
  onPage: (p: number) => void;
  onOpenVideo: (v: TvboxVideo) => void;
}) {
  const [videos, setVideos] = useState<TvboxVideo[]>([]);
  const [pagecount, setPagecount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const n = site.type === 1
          ? await type1Category(site.api, cat.type_id, page)
          : normalizeVideoList(await invokeSpider(spiderClass, 'categoryContent', [cat.type_id, String(page), false, {}]));
        if (!alive) return;
        setVideos(n.videos);
        setPagecount(Math.max(1, n.pagecount));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [spiderClass, site, cat.type_id, page]);

  return (
    <div>
      <div className="tvbox-subheader">
        <button className="tvbox-btn" onClick={onBack}>‹ {site.name}</button>
        <h2 className="tvbox-section-title">{cat.type_name}</h2>
        <div className="tvbox-pager">
          <button className="tvbox-btn" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>‹ 上一页</button>
          <span className="tvbox-page-label">{page} / {pagecount}</span>
          <button className="tvbox-btn" disabled={page >= pagecount || loading} onClick={() => onPage(page + 1)}>下一页 ›</button>
        </div>
      </div>
      {loading && <div className="tvbox-loading">加载中…</div>}
      {error && <div className="tvbox-error">{error}</div>}
      {!loading && !error && (
        videos.length === 0
          ? <div className="tvbox-empty">这一页没有内容</div>
          : <div className="tvbox-video-grid">{videos.map((v) => (
            <VideoCard key={v.vod_id || v.vod_name} v={v} onOpen={() => onOpenVideo(v)} />
          ))}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DetailView({ site, spiderClass, video, onBack, onPlay }: {
  site: TvboxSite;
  spiderClass: string;
  video: TvboxVideo;
  onBack: () => void;
  onPlay: (info: VodPlayInfo) => void;
}) {
  const [detail, setDetail] = useState<TvboxDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = site.type === 1
          ? await type1Detail(site.api, video.vod_id)
          : normalizeDetail(await invokeSpider(spiderClass, 'detailContent', [[video.vod_id]]));
        if (!alive) return;
        if (!d) throw new Error('详情为空');
        // fill in name/pic from the list card when detail lacks them
        if (!d.vod_name) d.vod_name = video.vod_name;
        if (!d.vod_pic) d.vod_pic = video.vod_pic;
        setDetail(d);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [spiderClass, site, video.vod_id]);

  const playEpisode = useCallback(async (idx: number) => {
    if (!detail || playingIdx !== null) return;
    const ep = detail.episodes[idx];
    if (!ep) return;
    setPlayingIdx(idx);
    try {
      // Type-1: episode URL is already direct. Spider: resolve via playerContent.
      let url = ep.url;
      let headers: Record<string, string> | undefined;
      if (site.type !== 1) {
        const data = await invokeSpider(spiderClass, 'playerContent', ['', ep.url, []]);
        if (typeof data?.url === 'string' && data.url) url = data.url;
        if (data?.header && typeof data.header === 'object') headers = data.header;
      }
      const info: VodPlayInfo = {
        url,
        title: detail.vod_name || video.vod_name,
        type: 'series',
        episodeInfo: ep.name,
        source_id: 'tvbox',
        mediaId: `tvbox:${site.key}:${detail.vod_id}`,
        posterUrl: detail.vod_pic,
      };
      if (headers && (headers['User-Agent'] || headers['user-agent'])) {
        // Some spiders require a UA; the player layer reads custom headers
        // from the URL fragment convention used by stream-resolver.
        (info as any).httpHeaders = headers;
      }
      onPlay(info);
    } catch (e) {
      setError(`播放解析失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPlayingIdx(null);
    }
  }, [detail, playingIdx, spiderClass, site, video.vod_name, onPlay]);

  return (
    <div>
      <div className="tvbox-subheader">
        <button className="tvbox-btn" onClick={onBack}>‹ {site.name}</button>
        <h2 className="tvbox-section-title">{video.vod_name}</h2>
      </div>
      {loading && <div className="tvbox-loading">加载详情中…</div>}
      {error && <div className="tvbox-error">{error}</div>}
      {!loading && detail && (
        <div className="tvbox-detail">
          {detail.vod_pic && (
            <img className="tvbox-detail-poster" src={detail.vod_pic} alt="" referrerPolicy="no-referrer" />
          )}
          <div className="tvbox-detail-body">
            <h3>{detail.vod_name}</h3>
            {detail.vod_remarks && <p className="tvbox-detail-remarks">{detail.vod_remarks}</p>}
            <h4 className="tvbox-section-title">选集（{detail.episodes.length}）</h4>
            {detail.episodes.length === 0
              ? <div className="tvbox-empty">没有可播放的剧集</div>
              : <div className="tvbox-episodes">
                {detail.episodes.map((ep, i) => (
                  <button
                    key={`${ep.name}-${i}`}
                    className="tvbox-episode-btn"
                    disabled={playingIdx !== null}
                    onClick={() => void playEpisode(i)}
                  >
                    {playingIdx === i ? '解析中…' : ep.name}
                  </button>
                ))}
              </div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SearchView({ site, spiderClass, query, onBack, onOpenVideo }: {
  site: TvboxSite;
  spiderClass: string;
  query: string;
  onBack: () => void;
  onOpenVideo: (v: TvboxVideo) => void;
}) {
  const [videos, setVideos] = useState<TvboxVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const videos = site.type === 1
          ? (await type1Search(site.api, query)).videos
          : normalizeVideoList(await invokeSpider(spiderClass, 'searchContent', [query, false])).videos;
        if (!alive) return;
        setVideos(videos);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [spiderClass, site, query]);

  return (
    <div>
      <div className="tvbox-subheader">
        <button className="tvbox-btn" onClick={onBack}>‹ {site.name}</button>
        <h2 className="tvbox-section-title">搜索：{query}</h2>
      </div>
      {loading && <div className="tvbox-loading">搜索中…</div>}
      {error && <div className="tvbox-error">{error}</div>}
      {!loading && !error && (
        videos.length === 0
          ? <div className="tvbox-empty">没有搜到结果</div>
          : <div className="tvbox-video-grid">{videos.map((v) => (
            <VideoCard key={v.vod_id || v.vod_name} v={v} onOpen={() => onOpenVideo(v)} />
          ))}</div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { VodPlayInfo } from '../types/media';
import type { VodPlayerMode } from './vod/SplitPlayButton';
import './TVBoxPage.css';
import './YouTubePage.css';

/**
 * YouTube section: search (or paste a channel / playlist / video URL) through the
 * bundled yt-dlp, then play the watch URL. The embedded mpv player resolves
 * YouTube itself via its ytdl hook, so no stream URL extraction happens here.
 */

interface YoutubeItem {
  id: string;
  title: string;
  url: string;
  channel?: string | null;
  duration?: number | null;
  thumbnail?: string | null;
  viewCount?: number | null;
  isLive: boolean;
}

interface YouTubePageProps {
  onPlay: (info: VodPlayInfo, targetMode?: VodPlayerMode) => void;
  onClose: () => void;
}

const HISTORY_KEY = 'ynotv.youtube.history.v1';
const QUICK = ['热门音乐', '新闻直播', '纪录片', 'lofi live', '电影解说', 'NHK'];

function loadHistory(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

function fmtDuration(sec?: number | null): string {
  if (!sec || sec <= 0) return '';
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function fmtViews(n?: number | null): string {
  if (!n) return '';
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿次观看`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万次观看`;
  return `${n}次观看`;
}

function describeYtError(msg: string, what: string): string {
  if (msg.startsWith('BOTCHECK|') || /not a bot|sign in/i.test(msg)) {
    return 'YouTube 要求登录验证（当前网络被判为机器人）。点搜索按钮旁的“登录 YouTube”，在弹出窗口登录后点“保存登录”，再点视频即可。'+
      '若已保存过仍出现，说明登录已过期，重新登录保存一次。' +
      `\n详细信息：${msg.replace(/^BOTCHECK\|/, '').replace(/\|/g, ' ; ')}`;
  }
  return `${what}：${msg}。先到 设置 › 关于 › yt-dlp 点更新再试。`;
}

const FEEDS = [
  { key: ':ytrec', label: '推荐' },
  { key: ':ytsubs', label: '订阅' },
  { key: ':ythis', label: '历史' },
];

export function YouTubePage({ onPlay, onClose }: YouTubePageProps) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<YoutubeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(() => loadHistory());

  const search = useCallback(async (query: string) => {
    const term = query.trim();
    if (!term) return;
    setQ(term);
    setFeed(null);
    setLoading(true);
    setError(null);
    setLastQuery(term);
    try {
      const res = await invoke<YoutubeItem[]>('youtube_search', { query: term, limit: 40 });
      setItems(res);
      if (res.length === 0) setError('没有结果');
      setHistory((h) => {
        const next = [term, ...h.filter((x) => x !== term)].slice(0, 12);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    } catch (e) {
      setItems([]);
      const msg = e instanceof Error ? e.message : String(e);
      setError(describeYtError(msg, '搜索失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  const [feed, setFeed] = useState<string | null>(null);
  const loadFeed = useCallback(async (kind: string, quiet = false) => {
    setFeed(kind);
    setLoading(true);
    setError(null);
    setLastQuery(FEEDS.find((f) => f.key === kind)?.label ?? kind);
    try {
      const res = await invoke<YoutubeItem[]>('youtube_search', { query: kind, limit: 48 });
      setItems(res);
      if (res.length === 0 && !quiet) setError('这里暂时没有内容');
    } catch (e) {
      setItems([]);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('NEEDLOGIN')) {
        if (!quiet) setError('推荐和订阅需要先登录：点右上“登录 YouTube”，登录后点“保存登录”。');
      } else {
        setError(describeYtError(msg, '加载失败'));
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void loadFeed(':ytrec', true); }, [loadFeed]);

  const [resolving, setResolving] = useState<string | null>(null);
  const [cookies, setCookies] = useState<string>(() => {
    try { return localStorage.getItem('youtube-cookies') || 'auto'; } catch { return 'auto'; }
  });
  const changeCookies = (v: string) => {
    setCookies(v);
    try { localStorage.setItem('youtube-cookies', v); } catch { /* ignore */ }
  };

  const [loginOpen, setLoginOpen] = useState(false);
  const [zhSubs, setZhSubs] = useState<boolean>(() => {
    try { return localStorage.getItem('youtube-zh-subs') !== 'off'; } catch { return true; }
  });
  const [groqKey, setGroqKey] = useState<string>(() => {
    try { return localStorage.getItem('groq-api-key') || ''; } catch { return ''; }
  });
  const [groqOpen, setGroqOpen] = useState(false);
  const [localWhisper, setLocalWhisper] = useState<boolean>(() => {
    try { return localStorage.getItem('youtube-local-whisper') !== 'off'; } catch { return true; }
  });
  const toggleLocalWhisper = () => {
    const next = !localWhisper;
    setLocalWhisper(next);
    try { localStorage.setItem('youtube-local-whisper', next ? 'on' : 'off'); } catch { /* ignore */ }
  };
  const saveGroqKey = (v: string) => {
    setGroqKey(v);
    try {
      if (v.trim()) localStorage.setItem('groq-api-key', v.trim());
      else localStorage.removeItem('groq-api-key');
    } catch { /* ignore */ }
  };
  const toggleZhSubs = () => {
    const next = !zhSubs;
    setZhSubs(next);
    try { localStorage.setItem('youtube-zh-subs', next ? 'on' : 'off'); } catch { /* ignore */ }
  };
  const [notice, setNotice] = useState<string | null>(null);
  const openLogin = async () => {
    setError(null);
    setNotice(null);
    try {
      await invoke('youtube_login_open');
      setLoginOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const saveLogin = async () => {
    setError(null);
    try {
      const n = await invoke<number>('youtube_login_save');
      setLoginOpen(false);
      changeCookies('auto');
      setNotice(`已保存 YouTube 登录（${n} 个 cookie）。`);
      void loadFeed(':ytrec');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const play = useCallback(async (it: YoutubeItem, mode?: VodPlayerMode) => {
    // A channel or playlist entry: open it as a list instead of playing.
    if (/youtube\.com\/(@|channel\/|c\/|user\/|playlist\?)/.test(it.url)) {
      void search(it.url);
      return;
    }
    if (resolving) return;
    setResolving(it.id);
    setError(null);
    try {
      // Resolve to a direct stream (HLS) so every player mode can open it,
      // instead of relying on mpv's ytdl hook.
      const direct = await invoke<string>('youtube_resolve', { url: it.url, cookies });
      onPlay({
        url: direct,
        title: it.title,
        type: 'movie',
        source_id: 'youtube',
        mediaId: `youtube:${it.id}`,
        posterUrl: it.thumbnail || undefined,
      } as VodPlayInfo, mode);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(describeYtError(msg, '播放解析失败'));
    } finally {
      setResolving(null);
    }
  }, [onPlay, search, resolving, cookies]);

  return (
    <div className="tvbox-page youtube-page">
      <div className="tvbox-header">
        <button className="tvbox-back" onClick={onClose} title="返回">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <h2 className="tvbox-title">YouTube</h2>
      </div>

      <form
        className="tvbox-search-form"
        onSubmit={(e) => { e.preventDefault(); void search(q); }}
      >
        <input
          className="tvbox-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索 YouTube，或粘贴视频 / 频道 / 播放列表链接"
          autoFocus
        />
        <select
          className="tvbox-input"
          style={{ maxWidth: 170, flex: '0 0 auto' }}
          value={cookies}
          onChange={(e) => changeCookies(e.target.value)}
          title="遇到“确认你不是机器人”时，从哪个浏览器读取 YouTube 登录 cookie"
        >
          <option value="auto">登录来源：自动</option>
          <option value="firefox">Firefox</option>
          <option value="edge">Edge</option>
          <option value="chrome">Chrome</option>
          <option value="brave">Brave</option>
          <option value="none">不使用</option>
        </select>
        <button className="tvbox-btn" type="submit" disabled={loading || !q.trim()}>
          {loading ? '搜索中…' : '搜索'}
        </button>
        <button
          className="tvbox-btn"
          type="button"
          onClick={() => void (loginOpen ? saveLogin() : openLogin())}
          title="在内置窗口登录 YouTube，保存后播放时自动使用"
        >
          {loginOpen ? '保存登录' : '登录 YouTube'}
        </button>
        <button
          className="tvbox-btn"
          type="button"
          onClick={toggleZhSubs}
          style={zhSubs ? { background: '#e33', color: '#fff', borderColor: '#e33' } : undefined}
          title="播放时自动加载中文字幕：有官方中文用官方的，没有就用 YouTube 的 AI 机翻"
        >
          {zhSubs ? '中文字幕：开' : '中文字幕：关'}
        </button>
        <button
          className="tvbox-btn"
          type="button"
          onClick={() => setGroqOpen((o) => !o)}
          title="没有字幕的视频，用 Groq Whisper 听语音生成中文字幕"
        >
          {groqKey ? 'Groq Key：已设置' : 'Groq Key'}
        </button>
        <button
          className="tvbox-btn"
          type="button"
          onClick={toggleLocalWhisper}
          style={localWhisper ? { background: '#e33', color: '#fff', borderColor: '#e33' } : undefined}
          title="没有字幕的视频，在本机用 Whisper 听语音生成中文字幕（首次会下载约 160MB）"
        >
          {localWhisper ? '本地语音识别：开' : '本地语音识别：关'}
        </button>
      </form>
      {groqOpen && (
        <div className="tvbox-hint" style={{ padding: '6px 2px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="tvbox-input"
            type="password"
            value={groqKey}
            onChange={(e) => saveGroqKey(e.target.value)}
            placeholder="粘贴 Groq API Key（gsk_ 开头），只保存在本机"
            style={{ flex: 1 }}
          />
          <button className="tvbox-btn" type="button" onClick={() => setGroqOpen(false)}>完成</button>
        </div>
      )}
      {loginOpen && (
        <div className="tvbox-hint" style={{ padding: '6px 2px', opacity: 0.85 }}>
          在弹出的窗口里登录，看到 YouTube 首页后，回来点“保存登录”。
        </div>
      )}
      {notice && (
        <div className="tvbox-hint" style={{ padding: '6px 2px', color: '#7fd18b' }}>{notice}</div>
      )}

      <div className="youtube-chips">
        {FEEDS.map((f) => (
          <button
            key={f.key}
            className="youtube-chip"
            style={feed === f.key ? { background: '#e33', color: '#fff', borderColor: '#e33' } : undefined}
            onClick={() => void loadFeed(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="youtube-chips">
        {(history.length ? history : QUICK).map((t) => (
          <button key={t} className="youtube-chip" onClick={() => void search(t)} title={t}>
            {t.length > 28 ? `${t.slice(0, 28)}…` : t}
          </button>
        ))}
        {history.length > 0 && (
          <button
            className="youtube-chip youtube-chip--muted"
            onClick={() => { setHistory([]); try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ } }}
          >
            清除记录
          </button>
        )}
      </div>

      {error && <div className="tvbox-error" style={{ whiteSpace: 'pre-wrap', userSelect: 'text' }}>{error}</div>}
      {loading && <div className="tvbox-loading">{feed ? `正在加载${lastQuery}…` : `正在用 yt-dlp 搜索「${lastQuery}」…`}</div>}

      {!loading && items.length > 0 && (
        <div className="youtube-grid">
          {items.map((it) => (
            <button key={it.id} className="youtube-card" onClick={() => void play(it)} disabled={!!resolving}>
              <div className="youtube-thumb-wrap">
                {it.thumbnail
                  ? <img className="youtube-thumb" src={it.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  : <div className="youtube-thumb youtube-thumb--empty" />}
                {it.isLive
                  ? <span className="youtube-badge youtube-badge--live">直播</span>
                  : it.duration ? <span className="youtube-badge">{fmtDuration(it.duration)}</span> : null}
              </div>
              <div className="youtube-title" title={it.title}>{resolving === it.id ? '解析中… ' : ''}{it.title}</div>
              <div className="youtube-meta">
                {[it.channel, fmtViews(it.viewCount)].filter(Boolean).join(' · ')}
              </div>
            </button>
          ))}
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="tvbox-hint">
          用内置 yt-dlp 搜索，点视频就用播放器打开（mpv 自动选最高画质）。国内网络需要系统代理。
        </div>
      )}
    </div>
  );
}

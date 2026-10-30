import { invoke } from '@tauri-apps/api/core';

// Live TV speech-to-Chinese captions (local Whisper). The backend stops them
// on every new load/stop; we restart them after a live channel loads.
let last: { url: string; userAgent?: string; headers?: string } | null = null;

export function liveSubsEnabled(): boolean {
  try { return localStorage.getItem('live-tv-subs') === 'on'; } catch { return false; }
}

function toFfmpegHeaders(headerFields?: string): string | undefined {
  if (!headerFields) return undefined;
  const lines = headerFields.split(',').map((h) => h.trim()).filter((h) => h.includes(':'));
  return lines.length ? lines.map((h) => `${h}\r\n`).join('') : undefined;
}

export function onLiveChannelLoaded(url: string, userAgent?: string, headerFields?: string) {
  last = { url, userAgent, headers: toFfmpegHeaders(headerFields) };
  if (liveSubsEnabled()) startLiveSubs();
}

export function onNonLiveLoaded() {
  last = null;
}

export function startLiveSubs() {
  if (!last) return;
  void invoke('live_subtitles_start', { url: last.url, userAgent: last.userAgent ?? null, headers: last.headers ?? null }).catch(() => {});
}

export function setLiveSubsEnabled(on: boolean) {
  try { localStorage.setItem('live-tv-subs', on ? 'on' : 'off'); } catch { /* ignore */ }
  if (on) startLiveSubs();
  else {
    void invoke('live_subtitles_stop').catch(() => {});
    window.dispatchEvent(new CustomEvent('live-subtitle-clear'));
  }
}

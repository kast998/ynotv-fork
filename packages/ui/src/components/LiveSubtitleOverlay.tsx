import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

/** Shows Chinese captions produced from live TV audio by local Whisper. */
export function LiveSubtitleOverlay() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const clear = () => setText('');
    void listen<{ text: string; status?: boolean }>('live-subtitle', (e) => {
      setText(e.payload.text || '');
      setStatus(!!e.payload.status);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(clear, e.payload.status ? 6000 : 14000);
    }).then((u) => { unlisten = u; });
    window.addEventListener('live-subtitle-clear', clear);
    return () => {
      if (unlisten) unlisten();
      window.removeEventListener('live-subtitle-clear', clear);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  if (!text) return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: '8%',
        transform: 'translateX(-50%)',
        maxWidth: '86vw',
        padding: '6px 16px',
        borderRadius: 6,
        background: 'rgba(0,0,0,0.6)',
        color: status ? '#ccc' : '#fff',
        fontSize: status ? 18 : 'clamp(20px, 2.6vw, 40px)',
        lineHeight: 1.35,
        textAlign: 'center',
        textShadow: '0 0 3px #000, 0 0 3px #000',
        pointerEvents: 'none',
        zIndex: 900,
        whiteSpace: 'pre-wrap',
      }}
    >
      {text}
    </div>
  );
}

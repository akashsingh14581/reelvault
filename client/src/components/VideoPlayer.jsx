import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, Loader2, Maximize, Minimize, PictureInPicture2, Pause, Play, RotateCcw, Volume1, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { formatClock } from '../lib/format.js';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const HIDE_MS = 2800;

/**
 * Custom player around <video>.
 * `fetchUrl()` must resolve to a (fresh) playback URL; it is called on load and again whenever
 * playback fails, so an expired signed URL or a dropped connection recovers without a page reload.
 */
export default function VideoPlayer({ fetchUrl, title, poster, onDownload, downloading, durationHint = 0 }) {
  const wrap = useRef(null);
  const video = useRef(null);
  const hideTimer = useRef(null);
  const resumeAt = useRef(0);
  const wasPlaying = useRef(false);
  const tapRef = useRef({ t: 0, x: 0 });
  const seeking = useRef(false);

  const [src, setSrc] = useState('');
  const [loadingUrl, setLoadingUrl] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(durationHint);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [error, setError] = useState(''); // '' | 'interrupted' | 'failed'
  const [flash, setFlash] = useState('');
  const [started, setStarted] = useState(false);
  const canPip = typeof document !== 'undefined' && document.pictureInPictureEnabled;

  const loadUrl = useCallback(async () => {
    setLoadingUrl(true);
    try {
      const url = await fetchUrl();
      setSrc(url);
      setError('');
    } catch {
      setError('interrupted');
    } finally {
      setLoadingUrl(false);
    }
  }, [fetchUrl]);

  useEffect(() => { loadUrl(); }, [loadUrl]);

  // Recover: request a fresh URL, then continue from the same moment.
  const recover = useCallback(async () => {
    const v = video.current;
    if (v) { resumeAt.current = v.currentTime || resumeAt.current; wasPlaying.current = !v.paused || wasPlaying.current; }
    setError('');
    setWaiting(true);
    await loadUrl();
  }, [loadUrl]);

  useEffect(() => {
    const online = () => { if (error) recover(); };
    const offline = () => { if (video.current && !video.current.paused) setError('interrupted'); };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, [error, recover]);

  /* ───── controls visibility ───── */
  const poke = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (video.current && !video.current.paused) { setControlsVisible(false); setSpeedOpen(false); }
    }, HIDE_MS);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  /* ───── actions ───── */
  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }, []);

  const seekTo = useCallback((t) => {
    const v = video.current;
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration, t));
    setTime(v.currentTime);
  }, []);

  const skip = useCallback((d) => {
    const v = video.current;
    if (!v) return;
    seekTo(v.currentTime + d);
    setFlash(d > 0 ? `+${d}s` : `${d}s`);
    setTimeout(() => setFlash(''), 600);
  }, [seekTo]);

  const toggleMute = useCallback(() => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = wrap.current;
    const v = video.current;
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else if (el?.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el?.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      } else if (v?.webkitEnterFullscreen) {
        v.webkitEnterFullscreen(); // iPhone Safari
      }
    } catch { /* user gesture or policy refused */ }
  }, []);

  useEffect(() => {
    const on = () => setFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', on);
    document.addEventListener('webkitfullscreenchange', on);
    return () => { document.removeEventListener('fullscreenchange', on); document.removeEventListener('webkitfullscreenchange', on); };
  }, []);

  const togglePip = useCallback(async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.current?.requestPictureInPicture();
    } catch { /* unsupported */ }
  }, []);

  const changeSpeed = (s) => {
    setSpeed(s);
    if (video.current) video.current.playbackRate = s;
    setSpeedOpen(false);
  };

  /* ───── keyboard shortcuts (only when the player is focused or hovered) ───── */
  const onKeyDown = (e) => {
    if (e.target.closest?.('.pl-menu')) return;
    const k = e.key.toLowerCase();
    const map = {
      ' ': toggle, k: toggle, enter: e.target === wrap.current ? toggle : null,
      arrowleft: () => skip(-5), arrowright: () => skip(5), j: () => skip(-10), l: () => skip(10),
      arrowup: () => adjustVolume(0.05), arrowdown: () => adjustVolume(-0.05),
      m: toggleMute, f: toggleFullscreen, p: canPip ? togglePip : null,
      '>': () => changeSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed) + 1)]),
      '<': () => changeSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(speed) - 1)]),
    };
    const fn = map[k];
    if (fn && !(e.target.tagName === 'INPUT' && (k === ' '))) {
      if (e.target.closest?.('button') && (k === ' ' || k === 'enter')) return; // native button activation
      e.preventDefault();
      fn();
      poke();
    }
  };

  function adjustVolume(d) {
    const v = video.current;
    if (!v) return;
    v.volume = Math.max(0, Math.min(1, v.volume + d));
    v.muted = v.volume === 0;
    setVolume(v.volume);
    setMuted(v.muted);
  }

  /* ───── pointer on the video surface: tap toggles, double-tap seeks (touch) / fullscreen (mouse) ───── */
  const onSurfaceClick = (e) => {
    poke();
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const isTouch = e.nativeEvent.pointerType === 'touch' || window.matchMedia('(pointer: coarse)').matches;
    const prev = tapRef.current;
    const double = now - prev.t < 300;
    tapRef.current = { t: now, x };
    if (double) {
      clearTimeout(prev.timer);
      if (isTouch && (x < 0.35 || x > 0.65)) skip(x < 0.5 ? -10 : 10);
      else toggleFullscreen();
      tapRef.current = { t: 0, x: 0 };
      return;
    }
    // Single tap: on touch, first tap just reveals controls if hidden.
    if (isTouch && !controlsVisible) return;
    tapRef.current.timer = setTimeout(toggle, 250);
  };

  /* ───── progress bar ───── */
  const barRef = useRef(null);
  const posFromEvent = (clientX) => {
    const r = barRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const onBarDown = (e) => {
    e.preventDefault();
    barRef.current.setPointerCapture?.(e.pointerId);
    seeking.current = true;
    seekTo(posFromEvent(e.clientX) * duration);
  };
  const onBarMove = (e) => { if (seeking.current) seekTo(posFromEvent(e.clientX) * duration); };
  const onBarUp = () => { seeking.current = false; };
  const onBarKey = (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); skip(-5); }
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); skip(5); }
    if (e.key === 'Home') { e.preventDefault(); seekTo(0); }
    if (e.key === 'End') { e.preventDefault(); seekTo(duration); }
  };

  /* ───── media events ───── */
  const media = {
    onLoadedMetadata: (e) => {
      const v = e.currentTarget;
      setDuration(Number.isFinite(v.duration) ? v.duration : durationHint);
      v.playbackRate = speed;
      if (resumeAt.current > 0) {
        v.currentTime = resumeAt.current;
        resumeAt.current = 0;
        if (wasPlaying.current) v.play().catch(() => {});
        wasPlaying.current = false;
      }
      setWaiting(false);
    },
    onTimeUpdate: (e) => {
      const v = e.currentTarget;
      if (!seeking.current) setTime(v.currentTime);
      const b = v.buffered;
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) <= v.currentTime + 0.5 && b.end(i) >= v.currentTime) { setBuffered(b.end(i)); break; }
      }
    },
    onProgress: (e) => {
      const v = e.currentTarget;
      const b = v.buffered;
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) <= v.currentTime + 0.5 && b.end(i) >= v.currentTime) { setBuffered(b.end(i)); break; }
      }
    },
    onPlay: () => { setPlaying(true); setStarted(true); poke(); },
    onPause: () => { setPlaying(false); setControlsVisible(true); },
    onWaiting: () => setWaiting(true),
    onSeeking: () => setWaiting(true),
    onCanPlay: () => { setWaiting(false); setError(''); },
    onPlaying: () => { setWaiting(false); setError(''); },
    onSeeked: () => setWaiting(false),
    onEnded: () => { setPlaying(false); setControlsVisible(true); },
    onVolumeChange: (e) => { setVolume(e.currentTarget.volume); setMuted(e.currentTarget.muted); },
    onError: () => {
      const v = video.current;
      resumeAt.current = v?.currentTime || resumeAt.current;
      wasPlaying.current = v ? !v.paused || wasPlaying.current : false;
      setWaiting(false);
      setError(navigator.onLine ? 'failed' : 'interrupted');
    },
  };

  // A stall that never recovers (mobile network switch etc.): after 20s ask for a fresh URL once.
  useEffect(() => {
    if (!waiting || error) return undefined;
    const t = setTimeout(() => { if (waiting) setError(navigator.onLine ? 'failed' : 'interrupted'); }, 20000);
    return () => clearTimeout(t);
  }, [waiting, error]);

  const pct = duration ? (time / duration) * 100 : 0;
  const bufPct = duration ? (buffered / duration) * 100 : 0;
  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const showControls = controlsVisible || !playing || Boolean(error);

  return (
    <div
      ref={wrap}
      className={`pl ${showControls ? 'show' : 'hide'} ${fullscreen ? 'is-fs' : ''}`}
      tabIndex={0}
      role="region"
      aria-label={`Video player: ${title}`}
      onKeyDown={onKeyDown}
      onMouseMove={poke}
      onTouchStart={poke}
      onMouseLeave={() => { if (playing) setControlsVisible(false); }}
    >
      <video
        ref={video}
        className="pl-video"
        src={src || undefined}
        poster={poster || undefined}
        preload="metadata"
        playsInline
        controls={false}
        controlsList="nodownload"
        disablePictureInPicture={!canPip}
        {...media}
      />
      <div className="pl-surface" onClick={onSurfaceClick} aria-hidden="true" />

      {(loadingUrl || (waiting && !error)) && !started && !error && (
        <div className="pl-center" role="status"><Loader2 className="spin" aria-hidden="true" /><span className="sr-only">Loading video…</span></div>
      )}
      {waiting && started && !error && (
        <div className="pl-center pl-buffer" role="status"><Loader2 className="spin" aria-hidden="true" /><span>Buffering…</span></div>
      )}
      {flash && <div className="pl-flash" aria-hidden="true">{flash}</div>}

      {!playing && !error && !waiting && !loadingUrl && (
        <button className="pl-big" onClick={toggle} aria-label={started ? 'Resume playback' : 'Play video'}><Play fill="currentColor" aria-hidden="true" /></button>
      )}

      {error && (
        <div className="pl-error" role="alert">
          {error === 'interrupted' ? <WifiOff aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          <strong>{error === 'interrupted' ? 'Connection interrupted' : 'This video couldn’t be played'}</strong>
          <p>{error === 'interrupted' ? 'We’ll reconnect automatically when you’re back online.' : 'Something went wrong while loading the video.'}</p>
          <button className="btn btn-primary" onClick={recover}><RotateCcw aria-hidden="true" /> Retry</button>
        </div>
      )}

      <div className="pl-controls" onClick={(e) => e.stopPropagation()}>
        <div className="pl-timeline">
          <span className="pl-time" aria-hidden="true">{formatClock(time)}</span>
          <div
            ref={barRef}
            className="pl-bar"
            role="slider"
            tabIndex={0}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.floor(duration) || 0}
            aria-valuenow={Math.floor(time)}
            aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}`}
            onPointerDown={onBarDown}
            onPointerMove={onBarMove}
            onPointerUp={onBarUp}
            onPointerCancel={onBarUp}
            onKeyDown={onBarKey}
          >
            <div className="pl-buf" style={{ width: `${bufPct}%` }} />
            <div className="pl-fill" style={{ width: `${pct}%` }} />
            <div className="pl-thumb" style={{ left: `${pct}%` }} />
          </div>
          <span className="pl-time" aria-hidden="true">{formatClock(duration)}</span>
        </div>

        <div className="pl-row">
          <div className="pl-group">
            <button className="pl-btn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause fill="currentColor" aria-hidden="true" /> : <Play fill="currentColor" aria-hidden="true" />}</button>
            <div className="pl-vol">
              <button className="pl-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}><VolIcon aria-hidden="true" /></button>
              <input className="pl-range" type="range" min="0" max="1" step="0.02" value={muted ? 0 : volume} aria-label="Volume"
                onChange={(e) => { const v = video.current; const n = Number(e.target.value); v.volume = n; v.muted = n === 0; }} />
            </div>
          </div>

          <div className="pl-group">
            <div className="pl-menu-wrap">
              <button className="pl-btn pl-text" onClick={() => setSpeedOpen((o) => !o)} aria-haspopup="menu" aria-expanded={speedOpen} aria-label={`Playback speed ${speed}x`}>{speed}x</button>
              {speedOpen && (
                <div className="pl-menu" role="menu" aria-label="Playback speed">
                  {SPEEDS.map((s) => <button key={s} role="menuitemradio" aria-checked={s === speed} className={s === speed ? 'on' : ''} onClick={() => changeSpeed(s)}>{s === 1 ? 'Normal' : `${s}x`}</button>)}
                </div>
              )}
            </div>
            {canPip && <button className="pl-btn hide-xs" onClick={togglePip} aria-label="Picture in picture"><PictureInPicture2 aria-hidden="true" /></button>}
            <button className="pl-btn" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>{fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}</button>
            {onDownload && (
              <button className="pl-btn pl-download" onClick={onDownload} disabled={downloading} aria-label="Download video">
                {downloading ? <Loader2 className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />}<span className="hide-xs">Download</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, Clock, Copy, Download, Film, Loader2, RotateCw, Share2, Users, WifiOff } from 'lucide-react';
import { api } from '../lib/api.js';
import { copyText, formatBytes, formatDuration, formatRemaining, shareUrl } from '../lib/format.js';
import { useToast } from '../components/Toasts.jsx';
import Badge from '../components/Badge.jsx';

const VideoPlayer = lazy(() => import('../components/VideoPlayer.jsx'));

function sessionId() {
  try {
    let id = sessionStorage.getItem('reelvault.viewer');
    if (!id) {
      id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`).slice(0, 48);
      sessionStorage.setItem('reelvault.viewer', id);
    }
    return id;
  } catch {
    return `anon-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}-xxxx`;
  }
}

const Screen = ({ icon: Icon, title, text, children }) => (
  <div className="center-state" role="status">
    <div className="state-icon"><Icon aria-hidden="true" /></div>
    <h1>{title}</h1>
    <p>{text}</p>
    {children}
  </div>
);

export default function Watch() {
  const { shareId } = useParams();
  const toast = useToast();
  const sid = useRef(sessionId()).current;

  // loading | processing | ready | expired | gone | failed | full | error
  const [phase, setPhase] = useState('loading');
  const [video, setVideo] = useState(null);
  const [viewers, setViewers] = useState({ count: 0, max: 3 });
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [dlBusy, setDlBusy] = useState(false);
  const [dlError, setDlError] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const beat = useRef(null);

  const handleError = useCallback((err) => {
    if (err.code === 'EXPIRED') setPhase('expired');
    else if (err.code === 'DELETED' || err.status === 404) setPhase('gone');
    else if (err.code === 'VIEWER_LIMIT') { setViewers({ count: err.data.viewers ?? 3, max: err.data.maxViewers ?? 3 }); setPhase('full'); }
    else { setErrMsg(err.message); setPhase('error'); }
  }, []);

  const claim = useCallback(async () => {
    const s = await api.watchSession(shareId, sid);
    setViewers({ count: s.viewers, max: s.maxViewers });
    setDeadline(Date.now() + s.remainingMs);
    return s;
  }, [shareId, sid]);

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const { video: v, remainingMs } = await api.watchInfo(shareId);
      setVideo(v);
      setViewers({ count: v.viewers, max: v.maxViewers });
      setDeadline(Date.now() + remainingMs);
      if (v.status === 'PROCESSING' || v.status === 'UPLOADING') { setPhase('processing'); return; }
      if (v.status === 'FAILED') { setPhase('failed'); return; }
      if (v.status === 'EXPIRED') { setPhase('expired'); return; }
      if (v.status !== 'READY') { setPhase('gone'); return; }
      await claim();
      setPhase('ready');
    } catch (err) { handleError(err); }
  }, [shareId, claim, handleError]);

  useEffect(() => { load(); }, [load]);

  // While being prepared: check gently every 5s (and only while the tab is visible).
  useEffect(() => {
    if (phase !== 'processing') return undefined;
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5000);
    return () => clearInterval(id);
  }, [phase, load]);

  // Viewer heartbeat; re-claims the slot if it was lost (e.g. after a sleep).
  useEffect(() => {
    if (phase !== 'ready') return undefined;
    const tick = async () => {
      try {
        const r = await api.watchBeat(shareId, sid);
        setViewers({ count: r.viewers, max: r.maxViewers });
        setDeadline(Date.now() + r.remainingMs);
      } catch (err) {
        if (err.code === 'SESSION_LOST') {
          try { await claim(); } catch (e2) { handleError(e2); }
        } else if (err.code === 'EXPIRED' || err.code === 'DELETED' || err.status === 404 || err.status === 410) handleError(err);
        // network errors: ignore, next beat retries
      }
    };
    beat.current = setInterval(tick, 12000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    const onLeave = () => api.leaveBeacon(shareId, sid);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onLeave);
    return () => {
      clearInterval(beat.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onLeave);
      onLeave();
    };
  }, [phase, shareId, sid, claim, handleError]);

  // Countdown (every 20s is plenty for "days/hours" text) + instant expiry at zero.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (phase === 'ready' && deadline && now >= deadline) setPhase('expired');
  }, [now, deadline, phase]);

  // Signed playback URL, re-requested whenever the player needs a new one.
  const fetchUrl = useCallback(async () => {
    try {
      return (await api.watchPlayback(shareId, sid)).url;
    } catch (err) {
      if (err.code === 'SESSION_LOST') { await claim(); return (await api.watchPlayback(shareId, sid)).url; }
      if (['EXPIRED', 'DELETED'].includes(err.code) || err.status === 404 || err.status === 410) handleError(err);
      throw err;
    }
  }, [shareId, sid, claim, handleError]);

  async function download() {
    if (dlBusy) return;
    setDlBusy(true);
    setDlError(false);
    try {
      let res;
      try { res = await api.watchDownload(shareId, sid); }
      catch (err) { if (err.code === 'SESSION_LOST') { await claim(); res = await api.watchDownload(shareId, sid); } else throw err; }
      const a = document.createElement('a');
      a.href = res.url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.info('Your download is starting.');
    } catch (err) {
      if (['EXPIRED', 'DELETED'].includes(err.code)) handleError(err);
      else { setDlError(true); toast.error('Download interrupted. Please try again.'); }
    } finally {
      setDlBusy(false);
    }
  }

  async function copyLink() {
    const ok = await copyText(shareUrl(shareId));
    if (ok) toast.success('Link copied.'); else toast.error('Could not copy the link.');
  }
  async function share() {
    const url = shareUrl(shareId);
    if (navigator.share) {
      try { await navigator.share({ title: video?.title || 'ReelVault', url }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    const ok = await copyText(url);
    if (ok) toast.success('Link copied.'); else toast.error('Could not copy the link.');
  }

  /* ───────────── Screens ───────────── */
  if (phase === 'loading') {
    return (
      <div className="watch-wrap" aria-busy="true">
        <div className="skeleton" style={{ aspectRatio: '16 / 9' }} role="status"><span className="sr-only">Loading video…</span></div>
        <div className="skeleton" style={{ height: 150 }} />
      </div>
    );
  }
  if (phase === 'expired') return <Screen icon={Clock} title="Video expired" text="This sharing link is no longer active."><Link className="btn btn-primary" to="/">Back to ReelVault</Link></Screen>;
  if (phase === 'gone') return <Screen icon={Film} title="Video not available" text="This video is no longer available."><Link className="btn btn-primary" to="/">Back to ReelVault</Link></Screen>;
  if (phase === 'full') return (
    <Screen icon={Users} title="Too many viewers right now" text={`This video is already being watched by ${viewers.max} people. Please try again in a little while.`}>
      <button className="btn btn-primary" onClick={load}><RotateCw aria-hidden="true" /> Try again</button>
    </Screen>
  );
  if (phase === 'failed') return <Screen icon={AlertTriangle} title="Video unavailable" text="This video couldn’t be prepared for playback. Ask the person who shared it to upload it again."><Link className="btn" to="/">Back to ReelVault</Link></Screen>;
  if (phase === 'error') return (
    <Screen icon={WifiOff} title="Couldn’t load this video" text={errMsg || 'Something went wrong. Please check your connection and try again.'}>
      <button className="btn btn-primary" onClick={load}><RotateCw aria-hidden="true" /> Retry</button>
    </Screen>
  );
  if (phase === 'processing') return (
    <div className="watch-wrap">
      <div className="processing-card" role="status" aria-live="polite">
        <div className="loader-reel" />
        <h2>Preparing your video</h2>
        <p>Your video is being optimized for playback.</p>
      </div>
      <section className="card info-card"><h1 className="info-title">{video?.title}</h1><p className="hint">This page will start playing automatically when it’s ready.</p></section>
    </div>
  );

  const remaining = Math.max(0, deadline - now);
  return (
    <div className="watch-wrap">
      <Suspense fallback={<div className="skeleton" style={{ aspectRatio: '16 / 9' }} />}>
        <VideoPlayer fetchUrl={fetchUrl} title={video.title} poster={video.posterUrl} durationHint={video.durationSec} onDownload={download} downloading={dlBusy} />
      </Suspense>

      <section className="card info-card" aria-label="Video details">
        <h1 className="info-title">{video.title}</h1>
        <dl className="info-stats">
          <div className="stat"><dt>File size</dt><dd>{formatBytes(video.size)}</dd></div>
          <div className="stat"><dt>Duration</dt><dd>{formatDuration(video.durationSec)}</dd></div>
          <div className="stat"><dt>Status</dt><dd><Badge status="READY" /></dd></div>
          <div className="stat"><dt>Expires in</dt><dd>{formatRemaining(remaining)}</dd></div>
          <div className="stat"><dt>Viewers</dt><dd>{viewers.count} / {viewers.max} viewers</dd></div>
        </dl>
        {dlError && (
          <div className="notice bad" role="alert"><AlertTriangle aria-hidden="true" /><div><strong>Download interrupted</strong><p>Your link is still valid — just try again.</p></div>
            <button className="btn btn-sm" onClick={download}>Retry Download</button></div>
        )}
        <div className="info-actions">
          <button className="btn btn-primary" onClick={download} disabled={dlBusy}>{dlBusy ? <Loader2 className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />} {dlBusy ? 'Preparing…' : 'Download'}</button>
          <button className="btn" onClick={copyLink}><Copy aria-hidden="true" /> Copy Link</button>
          <button className="btn" onClick={share}><Share2 aria-hidden="true" /> Share</button>
        </div>
      </section>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Clock, Copy, ExternalLink, Film, HardDrive, Loader2, RotateCw, Trash2, UploadCloud, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { copyText, formatBytes, formatDuration, formatRemaining, shareUrl } from '../lib/format.js';
import { useToast } from '../components/Toasts.jsx';
import Badge from '../components/Badge.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';

const LIVE = ['UPLOADING', 'PROCESSING', 'DELETING'];

function VideoCard({ v, now, onCopy, onDelete, onRetry, busy }) {
  const remaining = new Date(v.expiresAt).getTime() - now;
  const ready = v.status === 'READY';
  const inactive = ['EXPIRED', 'DELETING', 'FAILED'].includes(v.status);
  return (
    <article className="vcard" aria-label={v.title}>
      <div className="vthumb">
        {v.posterUrl ? <img src={v.posterUrl} alt="" loading="lazy" decoding="async" /> : <Film aria-hidden="true" />}
        <Badge status={v.status} />
        {v.durationSec > 0 && <span className="vdur">{formatDuration(v.durationSec)}</span>}
      </div>
      <div className="vbody">
        <h2 className="vtitle" title={v.title}>{v.title}</h2>
        <div className="vmeta">
          <span><HardDrive aria-hidden="true" />{formatBytes(v.size)}</span>
          <span><Clock aria-hidden="true" />{v.status === 'EXPIRED' || remaining <= 0 ? 'Expired' : `Expires in ${formatRemaining(remaining)}`}</span>
          <span><Users aria-hidden="true" />{v.viewers} / {v.maxViewers} viewers</span>
        </div>
        {v.status === 'FAILED' && <p className="vnote bad">We couldn’t prepare this video. {v.canRetry ? 'You can retry.' : 'Please upload it again.'}</p>}
        {v.status === 'PROCESSING' && <p className="vnote">Preparing your video for playback…</p>}
        {v.status === 'UPLOADING' && <p className="vnote">Upload not finished.</p>}
        {v.status === 'DELETING' && <p className="vnote">Deleting… this will finish automatically.</p>}
        {v.status === 'EXPIRED' && <p className="vnote">This link is no longer active.</p>}
      </div>
      <div className="vactions">
        {v.status === 'FAILED' && v.canRetry && <button className="btn btn-sm" onClick={() => onRetry(v)} disabled={busy}><RotateCw aria-hidden="true" /> Retry</button>}
        <button className="btn btn-sm" onClick={() => onCopy(v)} disabled={!ready}><Copy aria-hidden="true" /> Copy Link</button>
        {ready ? <Link className="btn btn-sm" to={`/v/${v.shareId}`}><ExternalLink aria-hidden="true" /> Open</Link> : <button className="btn btn-sm" disabled><ExternalLink aria-hidden="true" /> Open</button>}
        <button className="btn btn-sm btn-danger btn-icon" aria-label={`Delete ${v.title}`} onClick={() => onDelete(v)} disabled={busy || v.status === 'DELETING'}>
          {busy ? <Loader2 className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
        </button>
      </div>
      {inactive && <span className="sr-only">Status: {v.status}</span>}
    </article>
  );
}

export default function Dashboard() {
  const toast = useToast();
  const [videos, setVideos] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [confirm, setConfirm] = useState(null);
  const [busyId, setBusyId] = useState('');
  const alive = useRef(true);

  const load = useCallback(async (silent = false) => {
    try {
      const { videos: list } = await api.listVideos();
      if (!alive.current) return;
      setVideos(list);
      setError('');
    } catch (err) {
      if (!alive.current || silent) return;
      setError(err.message);
    }
  }, []);

  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);

  // Clock for countdowns (cheap, once a minute) and gentle polling only when something is in flight.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const needsPoll = videos?.some((v) => LIVE.includes(v.status));
  useEffect(() => {
    if (!needsPoll) return undefined;
    const id = setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) load(true); }, 6000);
    return () => clearInterval(id);
  }, [needsPoll, load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') load(true); };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); };
  }, [load]);

  async function copy(v) {
    const ok = await copyText(shareUrl(v.shareId));
    if (ok) toast.success('Link copied.'); else toast.error('Could not copy the link. Please copy it manually.');
  }

  async function doDelete() {
    const v = confirm;
    setBusyId(v.id);
    try {
      const res = await api.deleteVideo(v.id);
      setVideos((list) => (res.status === 'DELETED' ? list.filter((x) => x.id !== v.id) : list.map((x) => (x.id === v.id ? { ...x, status: 'DELETING' } : x))));
      toast.success(res.status === 'DELETED' ? 'Video deleted.' : 'Video removed. Cleanup will finish shortly.');
      setConfirm(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId('');
    }
  }

  async function retry(v) {
    setBusyId(v.id);
    try {
      const { video } = await api.retryVideo(v.id);
      setVideos((list) => list.map((x) => (x.id === v.id ? video : x)));
      toast.info('Retrying — preparing your video.');
    } catch (err) { toast.error(err.message); } finally { setBusyId(''); }
  }

  return (
    <>
      <div className="dash-head">
        <div>
          <p className="eyebrow-sm">REELVAULT</p>
          <h1 className="page-title">My Videos</h1>
        </div>
        <Link to="/upload" className="btn btn-primary"><UploadCloud aria-hidden="true" /> Upload Video</Link>
      </div>

      {videos === null && !error && (
        <div className="vgrid" aria-busy="true" role="status">
          <span className="sr-only">Loading your videos…</span>
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 300, borderRadius: 22 }} />)}
        </div>
      )}

      {error && videos === null && (
        <div className="center-state" role="alert">
          <div className="state-icon"><AlertTriangle aria-hidden="true" /></div>
          <h2>Couldn’t load your videos</h2>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => { setError(''); load(); }}><RotateCw aria-hidden="true" /> Retry</button>
        </div>
      )}

      {videos && videos.length === 0 && (
        <div className="center-state empty">
          <div className="state-icon"><Film aria-hidden="true" /></div>
          <h2>No videos yet</h2>
          <p>Upload your first video and share it privately with your friends.</p>
          <Link to="/upload" className="btn btn-primary btn-lg"><UploadCloud aria-hidden="true" /> Upload Video</Link>
        </div>
      )}

      {videos && videos.length > 0 && (
        <div className="vgrid">
          {videos.map((v) => <VideoCard key={v.id} v={v} now={now} busy={busyId === v.id} onCopy={copy} onDelete={setConfirm} onRetry={retry} />)}
        </div>
      )}

      {confirm && (
        <ConfirmModal danger title="Delete this video?" body={`“${confirm.title}” and its share link will be permanently removed. This can’t be undone.`}
          confirmLabel="Delete" busy={busyId === confirm.id} onConfirm={doDelete} onCancel={() => setConfirm(null)} />
      )}
    </>
  );
}

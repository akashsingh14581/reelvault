import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Copy, Film, Loader2, Pause, Play, RotateCw, UploadCloud, WifiOff, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { Uploader, fingerprintFile, saved } from '../lib/uploader.js';
import { copyText, formatBytes, formatEta, shareUrl } from '../lib/format.js';
import { useToast } from '../components/Toasts.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';

const MAX_BYTES = 20 * 1024 ** 3;
const EXTS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wmv', 'flv', 'mpeg', 'mpg', '3gp', 'ts', 'mts', 'm2ts', 'ogv'];
const EXPIRY = [
  { label: '1 hour', hours: 1 }, { label: '6 hours', hours: 6 }, { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 }, { label: '7 days', hours: 168 }, { label: '30 days', hours: 720 },
];

function checkFile(file) {
  if (!file) return 'Please choose a video file.';
  if (file.size === 0) return 'This file looks empty.';
  if (file.size > MAX_BYTES) return `File is too large. Maximum allowed size is ${formatBytes(MAX_BYTES)}.`;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!EXTS.includes(ext) && !file.type.startsWith('video/')) return 'This file type is not supported. Please choose a video file.';
  return '';
}

export default function Upload() {
  const toast = useToast();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const uploaderRef = useRef(null);

  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [hours, setHours] = useState(168);
  const [fileError, setFileError] = useState('');
  const [drag, setDrag] = useState(false);

  // idle | starting | uploading | paused | waiting | retrying | finalizing | processing | ready | error
  const [phase, setPhase] = useState('idle');
  const [prog, setProg] = useState({ loaded: 0, total: 0, percent: 0, speed: 0, eta: Infinity });
  const [message, setMessage] = useState('');
  const [video, setVideo] = useState(null);
  const [duplicate, setDuplicate] = useState(null);
  const [resumable, setResumable] = useState(() => saved.read());
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [copied, setCopied] = useState(false);

  const active = ['starting', 'uploading', 'paused', 'waiting', 'retrying', 'finalizing'].includes(phase);

  // Warn before leaving mid-upload.
  useEffect(() => {
    if (!active) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);

  // Keep the screen awake while uploading (where supported) so the phone doesn't lock mid-upload.
  useEffect(() => {
    if (!active || phase === 'paused' || !('wakeLock' in navigator)) return undefined;
    let lock = null;
    let cancelled = false;
    const acquire = async () => {
      try { const l = await navigator.wakeLock.request('screen'); if (cancelled) l.release().catch(() => {}); else lock = l; } catch { /* denied or unsupported */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible' && (!lock || lock.released)) acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); lock?.release().catch(() => {}); };
  }, [active, phase === 'paused']);

  // Stop timers/listeners if the page unmounts. (The upload itself stays resumable via saved state.)
  useEffect(() => () => { uploaderRef.current?.pause?.(); }, []);

  const pick = useCallback((f) => {
    if (!f) return;
    const problem = checkFile(f);
    setFileError(problem);
    if (problem) { setFile(null); return; }
    setFile(f);
    setTitle((t) => t || f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '));
    setDuplicate(null);
  }, []);

  function bindUploader(up, videoId) {
    uploaderRef.current = up;
    up.addEventListener('change', (e) => {
      const { state, progress, message: msg, video: done } = e.detail;
      setProg(progress);
      if (msg) setMessage(msg);
      if (state === 'done') { setVideo(done); setPhase(done.status === 'READY' ? 'ready' : done.status === 'FAILED' ? 'error' : 'processing'); if (done.status === 'FAILED') setMessage('We couldn’t prepare this video for playback.'); }
      else if (state === 'cancelled') { setPhase('idle'); }
      else setPhase(state);
    });
    up.start();
    setVideo((v) => v || { id: videoId });
  }

  async function begin(allowDuplicate = false) {
    const problem = checkFile(file);
    if (problem) { setFileError(problem); return; }
    setPhase('starting');
    setMessage('Getting ready…');
    try {
      const fingerprint = await fingerprintFile(file);
      const res = await api.initUpload({
        fileName: file.name, size: file.size, mimeType: file.type, fingerprint,
        title: title.trim() || undefined, expiresInHours: hours, allowDuplicate,
      });
      setVideo(res.video);
      setProg({ loaded: 0, total: file.size, percent: 0, speed: 0, eta: Infinity });
      bindUploader(new Uploader({ file, session: { ...res.upload } }), res.video.id);
      saved.write({ videoId: res.upload.videoId, uploadId: res.upload.uploadId, fileName: file.name, size: file.size, confirmed: 0, chunkSize: res.upload.chunkSize, fingerprint, at: Date.now() });
    } catch (err) {
      if (err.code === 'DUPLICATE') { setDuplicate(err.data.existing); setPhase('idle'); return; }
      setPhase('idle');
      toast.error(err.message);
    }
  }

  // Resume after refresh: user re-selects the same file; we verify it before continuing.
  async function resumeSaved(f) {
    const prev = resumable;
    if (!prev || !f) return;
    if (f.size !== prev.size || f.name !== prev.fileName) {
      toast.error('That is not the file you were uploading. Please choose the same file to continue.');
      return;
    }
    setFile(f);
    setPhase('starting');
    setMessage('Resuming your upload…');
    try {
      const { upload } = await api.signUpload(prev.videoId);
      setVideo({ id: prev.videoId });
      setProg({ loaded: prev.confirmed, total: f.size, percent: (prev.confirmed / f.size) * 100, speed: 0, eta: Infinity });
      bindUploader(new Uploader({ file: f, session: { ...upload, chunkSize: prev.chunkSize || upload.chunkSize }, startOffset: prev.confirmed }), prev.videoId);
      setResumable(null);
    } catch (err) {
      saved.clear();
      setResumable(null);
      setPhase('idle');
      toast.error(err.status === 409 || err.status === 404 ? 'That upload can no longer be resumed. Please start again.' : err.message);
    }
  }

  async function discardSaved() {
    const prev = resumable;
    saved.clear();
    setResumable(null);
    if (prev) api.abortUpload(prev.videoId).catch(() => {});
  }

  // Poll until processing finishes (gentle: every 4s, and only while visible).
  useEffect(() => {
    if (phase !== 'processing' || !video?.id) return undefined;
    let stop = false;
    const tick = async () => {
      if (stop || document.visibilityState === 'hidden') return;
      try {
        const { videos } = await api.listVideos();
        const v = videos.find((x) => x.id === video.id);
        if (!v || stop) return;
        setVideo(v);
        if (v.status === 'READY') setPhase('ready');
        else if (v.status === 'FAILED') { setPhase('error'); setMessage('We couldn’t prepare this video for playback.'); }
      } catch { /* try again on next tick */ }
    };
    const id = setInterval(tick, 4000);
    tick();
    return () => { stop = true; clearInterval(id); };
  }, [phase, video?.id]);

  async function retryProcessing() {
    try {
      const { video: v } = await api.retryVideo(video.id);
      setVideo(v); setPhase('processing'); setMessage('');
    } catch (err) { toast.error(err.message); }
  }

  async function doCancel() {
    setConfirmCancel(false);
    await uploaderRef.current?.cancel();
    setPhase('idle');
    setProg({ loaded: 0, total: 0, percent: 0, speed: 0, eta: Infinity });
    toast.info('Upload cancelled.');
  }

  function askCancel() {
    if (prog.percent > 2) setConfirmCancel(true); else doCancel();
  }

  async function onCopy() {
    const ok = await copyText(shareUrl(video.shareId));
    if (ok) { setCopied(true); toast.success('Link copied.'); setTimeout(() => setCopied(false), 2200); }
    else toast.error('Could not copy automatically. Please copy the link manually.');
  }

  function reset() {
    setFile(null); setTitle(''); setVideo(null); setPhase('idle'); setMessage(''); setDuplicate(null); setCopied(false);
  }

  /* ───────────── Render ───────────── */
  const ResumeBanner = resumable && phase === 'idle' && (
    <div className="notice" role="status">
      <RotateCw aria-hidden="true" />
      <div className="stack" style={{ flex: 1 }}>
        <div><strong>Unfinished upload found</strong><p>“{resumable.fileName}” ({formatBytes(resumable.size)}) was interrupted at {Math.round((resumable.confirmed / resumable.size) * 100)}%. Choose the same file to continue where you left off.</p></div>
        <div className="row">
          <label className="btn btn-primary btn-sm">
            Choose file to resume
            <input type="file" accept="video/*,.mkv,.avi,.ts,.mts,.m2ts,.wmv,.flv" hidden onChange={(e) => resumeSaved(e.target.files?.[0])} />
          </label>
          <button className="btn btn-ghost btn-sm" onClick={discardSaved}>Discard</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="upload-wrap">
      <div>
        <h1 className="page-title">Upload a video</h1>
        <p className="page-sub">Pick a file, choose how long the link should live, and share.</p>
      </div>

      {ResumeBanner}

      {phase === 'idle' && (
        <>
          {!file ? (
            <>
              <button type="button" className={`dropzone ${drag ? 'drag' : ''}`}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}>
                <span className="state-icon"><UploadCloud aria-hidden="true" /></span>
                <strong>Drop your video here</strong>
                <span>or choose a video · up to {formatBytes(MAX_BYTES)}</span>
              </button>
              <input ref={inputRef} type="file" accept="video/*,.mkv,.avi,.ts,.mts,.m2ts,.wmv,.flv" hidden onChange={(e) => pick(e.target.files?.[0])} />
              {fileError && <p className="error-text" role="alert">{fileError}</p>}
            </>
          ) : (
            <form className="card stack" onSubmit={(e) => { e.preventDefault(); begin(false); }}>
              <div className="file-row">
                <span className="state-icon"><Film aria-hidden="true" /></span>
                <div className="file-meta"><strong>{file.name}</strong><span>{formatBytes(file.size)} · {(file.name.split('.').pop() || '').toUpperCase()}</span></div>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Remove file" onClick={reset}><X aria-hidden="true" /></button>
              </div>
              <div className="form-grid">
                <div className="field span-2">
                  <label className="label" htmlFor="title">Title</label>
                  <input id="title" className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="field span-2">
                  <label className="label" htmlFor="exp">Link expires after</label>
                  <select id="exp" className="select" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                    {EXPIRY.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
                  </select>
                  <span className="hint">After this, the link stops working and the video is deleted.</span>
                </div>
              </div>
              {duplicate && (
                <div className="notice" role="alert">
                  <AlertTriangle aria-hidden="true" />
                  <div className="stack" style={{ flex: 1 }}>
                    <div><strong>This looks like a video you already uploaded</strong><p>“{duplicate.title}” ({duplicate.status.toLowerCase()}) appears identical. Upload it again anyway?</p></div>
                    <div className="row">
                      <button type="button" className="btn btn-sm" onClick={() => begin(true)}>Upload anyway</button>
                      <Link to="/dashboard" className="btn btn-ghost btn-sm">View existing</Link>
                    </div>
                  </div>
                </div>
              )}
              <button className="btn btn-primary btn-lg" type="submit"><UploadCloud aria-hidden="true" /> Start upload</button>
            </form>
          )}
        </>
      )}

      {phase !== 'idle' && phase !== 'ready' && phase !== 'error' && (
        <div className="card stack" aria-live="polite">
          <div className="file-row">
            <span className="state-icon"><Film aria-hidden="true" /></span>
            <div className="file-meta"><strong>{file?.name}</strong><span>{file && formatBytes(file.size)}</span></div>
          </div>

          {(phase === 'starting' || phase === 'finalizing' || phase === 'processing') ? (
            <div className="stack">
              <div className="progress-head"><span>{phase === 'starting' ? message || 'Getting ready…' : phase === 'finalizing' ? '✓ Upload complete' : 'Preparing video…'}</span>{phase === 'processing' && <Loader2 className="spin" aria-hidden="true" />}</div>
              <div className={`progress ${phase === 'finalizing' ? '' : 'indeterminate'}`}><i style={phase === 'finalizing' ? { width: '100%' } : undefined} /></div>
              <p className="hint">{phase === 'processing' ? 'Your video is being optimized for playback. You can leave this page — it will show as ready on your dashboard.' : phase === 'finalizing' ? 'Almost ready…' : ''}</p>
            </div>
          ) : (
            <div className="stack">
              <div className="progress-head">
                <span>{phase === 'paused' ? 'Upload paused' : phase === 'waiting' ? 'Connection lost' : phase === 'retrying' ? 'Retrying…' : 'Uploading your video…'}</span>
                <span>{Math.floor(prog.percent)}%</span>
              </div>
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(prog.percent)} aria-label="Upload progress"><i style={{ width: `${prog.percent}%` }} /></div>
              <div className="progress-meta">
                <span>{formatBytes(prog.loaded)} of {formatBytes(prog.total)}</span>
                {phase === 'uploading' && <span>{prog.speed > 0 ? `${formatBytes(prog.speed)}/s` : '—'} · {formatEta(prog.eta)} left</span>}
              </div>
              {(phase === 'waiting' || phase === 'retrying') && (
                <div className="notice"><WifiOff aria-hidden="true" /><div><strong>{phase === 'waiting' ? 'Upload paused' : 'Connection lost'}</strong><p>Your upload is safe. We’ll continue when the connection is available.</p></div></div>
              )}
              {phase === 'paused' && <div className="notice"><Pause aria-hidden="true" /><div><strong>Upload paused</strong><p>Your progress is saved. Resume whenever you’re ready.</p></div></div>}
              <div className="row">
                {phase === 'paused'
                  ? <button className="btn btn-primary" onClick={() => uploaderRef.current?.resume()}><Play aria-hidden="true" /> Resume Upload</button>
                  : <button className="btn" onClick={() => uploaderRef.current?.pause()}><Pause aria-hidden="true" /> Pause</button>}
                <button className="btn btn-danger" onClick={askCancel}>Cancel</button>
              </div>
              <p className="hint">Keep this tab open. If your phone locks or your laptop sleeps, we’ll pick up where you left off when you’re back.</p>
            </div>
          )}
        </div>
      )}

      {phase === 'error' && (
        <div className="card stack" role="alert">
          <div className="notice bad"><AlertTriangle aria-hidden="true" /><div><strong>{video?.status === 'FAILED' || message.includes('prepare') ? 'We couldn’t prepare this video' : 'Something went wrong while uploading.'}</strong><p>{message || 'Your progress is saved. You can try again.'}</p></div></div>
          <div className="row">
            {video?.status === 'FAILED' ? (
              <button className="btn btn-primary" onClick={retryProcessing}><RotateCw aria-hidden="true" /> Retry</button>
            ) : (
              <button className="btn btn-primary" onClick={() => { setPhase('uploading'); setMessage(''); const up = uploaderRef.current; if (up) { up.userPaused = false; up.cancelled = false; up.start(); } }}><RotateCw aria-hidden="true" /> Retry</button>
            )}
            <button className="btn btn-danger" onClick={askCancel}>Cancel</button>
          </div>
        </div>
      )}

      {phase === 'ready' && video && (
        <div className="card stack">
          <div className="notice"><CheckCircle2 aria-hidden="true" style={{ color: 'var(--ok)' }} /><div><strong>✓ Ready to share</strong><p>Your video is ready. Anyone with this link can watch it until it expires.</p></div></div>
          <div className="share-box"><code>{shareUrl(video.shareId)}</code>
            <button className="btn btn-primary btn-sm" onClick={onCopy}><Copy aria-hidden="true" /> {copied ? 'Copied' : 'Copy Link'}</button></div>
          <div className="row">
            <Link className="btn" to={`/v/${video.shareId}`}>Open</Link>
            <button className="btn btn-ghost" onClick={reset}>Upload another</button>
            <button className="btn btn-ghost" onClick={() => navigate('/dashboard')}>My Videos</button>
          </div>
        </div>
      )}

      {confirmCancel && (
        <ConfirmModal danger title="Cancel this upload?" body="The part that has already uploaded will be discarded and you’ll need to start again."
          confirmLabel="Cancel upload" cancelLabel="Keep uploading" onConfirm={doCancel} onCancel={() => setConfirmCancel(false)} />
      )}
    </div>
  );
}

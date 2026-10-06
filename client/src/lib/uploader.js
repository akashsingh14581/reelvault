import { api } from './api.js';

/**
 * Chunked, resumable upload straight to Cloudinary.
 *
 * - Each chunk is retried with exponential backoff; a lost connection pauses (never resets) the upload.
 * - Confirmed progress is persisted so an accidental refresh can resume at the last confirmed chunk
 *   (the user re-selects the same file; we verify it is identical before continuing).
 * - If the OS suspends JavaScript (phone locked, laptop asleep) nothing runs; on return we detect the
 *   interruption and continue from the last confirmed chunk. We never claim to upload in the background.
 */

const STORE_KEY = 'reelvault.upload';
const MAX_ATTEMPTS = 6;
const SPEED_WINDOW_MS = 8000;

export const saved = {
  read() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; } },
  write(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  clear() { try { localStorage.removeItem(STORE_KEY); } catch { /* storage unavailable */ } },
};

/** Cheap, stable fingerprint: size + name + hash of the first and last 1 MB. Never reads the whole file. */
export async function fingerprintFile(file) {
  const edge = 1024 * 1024;
  const head = file.slice(0, Math.min(edge, file.size));
  const tail = file.slice(Math.max(0, file.size - edge));
  const buf = new Uint8Array(await new Blob([head, tail]).arrayBuffer());
  let hex = '';
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buf);
    hex = Array.from(new Uint8Array(digest)).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  } else {
    let h = 5381;
    for (let i = 0; i < buf.length; i += 97) h = ((h << 5) + h + buf[i]) | 0;
    hex = (h >>> 0).toString(16);
  }
  return `${file.size}-${hex}`;
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

class ChunkError extends Error {
  constructor(message, { retryable, network }) { super(message); this.retryable = retryable; this.network = network; }
}

export class Uploader extends EventTarget {
  constructor({ file, session, startOffset = 0 }) {
    super();
    this.file = file;
    this.session = session; // { videoId, uploadId, chunkSize, uploadUrl, apiKey, params, signature, refreshAfterMs }
    this.signedAt = Date.now();
    this.confirmed = startOffset; // bytes the server has confirmed
    this.inflight = 0;
    this.samples = [];
    this.state = 'idle';
    this.userPaused = false;
    this.cancelled = false;
    this.xhr = null;
    this.abort = null;
    this._onOnline = () => { if (this.state === 'waiting') this._wake?.(); };
    this._onVisible = () => { if (document.visibilityState === 'visible' && this.state === 'waiting') this._wake?.(); };
  }

  get progress() {
    const loaded = Math.min(this.file.size, this.confirmed + this.inflight);
    const now = Date.now();
    this.samples = this.samples.filter((s) => now - s.t < SPEED_WINDOW_MS);
    let speed = 0;
    if (this.samples.length > 1) {
      const a = this.samples[0];
      const b = this.samples[this.samples.length - 1];
      if (b.t > a.t) speed = ((b.loaded - a.loaded) / (b.t - a.t)) * 1000;
    }
    const remaining = this.file.size - loaded;
    return { loaded, total: this.file.size, percent: (loaded / this.file.size) * 100, speed, eta: speed > 0 ? remaining / speed : Infinity };
  }

  _emit(state, extra = {}) {
    this.state = state;
    this.dispatchEvent(new CustomEvent('change', { detail: { state, progress: this.progress, ...extra } }));
  }

  _persist() {
    saved.write({
      videoId: this.session.videoId,
      uploadId: this.session.uploadId,
      fileName: this.file.name,
      size: this.file.size,
      confirmed: this.confirmed,
      chunkSize: this.session.chunkSize,
      at: Date.now(),
    });
  }

  async start() {
    window.addEventListener('online', this._onOnline);
    document.addEventListener('visibilitychange', this._onVisible);
    this.abort = new AbortController();
    this._emit('uploading');
    try {
      while (this.confirmed < this.file.size) {
        if (this.cancelled) throw new DOMException('Cancelled', 'AbortError');
        await this._waitIfPaused();
        const end = Math.min(this.confirmed + this.session.chunkSize, this.file.size);
        await this._sendWithRetry(this.confirmed, end);
        this.confirmed = end;
        this.inflight = 0;
        this._persist();
        this._sample();
        this._emit('uploading');
      }
      this._emit('finalizing');
      const video = await this._complete();
      saved.clear();
      this._emit('done', { video });
    } catch (err) {
      if (this.cancelled || err?.name === 'AbortError') {
        this._emit('cancelled');
      } else {
        this._emit('error', { error: err, message: err.userMessage || 'Connection lost. Your progress is saved — you can retry.' });
      }
    } finally {
      window.removeEventListener('online', this._onOnline);
      document.removeEventListener('visibilitychange', this._onVisible);
    }
  }

  pause() { this.userPaused = true; this.xhr?.abort(); this._emit('paused'); }

  resume() {
    this.userPaused = false;
    this._wakePause?.();
  }

  async cancel() {
    this.cancelled = true;
    this.abort?.abort();
    this.xhr?.abort();
    this._wake?.();
    this._wakePause?.();
    saved.clear();
    try { await api.abortUpload(this.session.videoId); } catch { /* the server also cleans abandoned uploads */ }
  }

  _sample() {
    const p = this.progress;
    this.samples.push({ t: Date.now(), loaded: p.loaded });
  }

  _waitIfPaused() {
    if (!this.userPaused) return Promise.resolve();
    return new Promise((resolve) => { this._wakePause = () => { this._wakePause = null; this._emit('uploading'); resolve(); }; });
  }

  async _sendWithRetry(start, end) {
    let attempt = 0;
    for (;;) {
      if (this.cancelled) throw new DOMException('Cancelled', 'AbortError');
      await this._waitIfPaused();
      try {
        await this._refreshSignatureIfNeeded();
        await this._sendChunk(start, end);
        return;
      } catch (err) {
        if (this.cancelled || err?.name === 'AbortError') {
          if (this.userPaused && !this.cancelled) { continue; } // aborted by pause(): loop re-enters the pause wait
          throw err;
        }
        this.inflight = 0;
        attempt += 1;
        const offline = !navigator.onLine || err.network;
        if (err.retryable === false) { err.userMessage = err.message; throw err; }
        if (attempt >= MAX_ATTEMPTS && !offline) {
          err.userMessage = 'Connection lost. Your progress is saved — you can retry.';
          throw err;
        }
        if (offline) {
          // Never burn retries while offline: wait for the network (or the tab becoming visible) and try again.
          this._emit('waiting', { message: "Connection lost. We'll continue when the connection is available." });
          await this._waitForWake(30000);
          if (attempt > MAX_ATTEMPTS * 3) { err.userMessage = 'Connection lost. Your progress is saved — you can retry.'; throw err; }
        } else {
          const backoff = Math.min(30000, 1000 * 2 ** (attempt - 1)) + Math.random() * 500;
          this._emit('retrying', { attempt, message: 'Connection lost. We’ll retry automatically.' });
          await sleep(backoff, this.abort.signal);
        }
        this._emit('uploading');
      }
    }
  }

  _waitForWake(maxMs) {
    return new Promise((resolve) => {
      let t = null;
      const done = () => { clearTimeout(t); this._wake = null; resolve(); };
      t = setTimeout(done, maxMs);
      this._wake = done;
      this._emit('waiting', { message: "Connection lost. We'll continue when the connection is available." });
    });
  }

  async _refreshSignatureIfNeeded() {
    if (Date.now() - this.signedAt < this.session.refreshAfterMs) return;
    const { upload } = await api.signUpload(this.session.videoId);
    Object.assign(this.session, upload);
    this.signedAt = Date.now();
  }

  _sendChunk(start, end) {
    return new Promise((resolve, reject) => {
      const s = this.session;
      const form = new FormData();
      form.append('file', this.file.slice(start, end), this.file.name);
      form.append('api_key', s.apiKey);
      form.append('timestamp', String(s.params.timestamp));
      form.append('signature', s.signature);
      form.append('public_id', s.params.public_id);
      form.append('type', s.params.type);

      const xhr = new XMLHttpRequest();
      this.xhr = xhr;
      xhr.open('POST', s.uploadUrl);
      xhr.setRequestHeader('X-Unique-Upload-Id', s.uploadId);
      xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${this.file.size}`);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        this.inflight = Math.min(e.loaded, end - start);
        this._sample();
        this.dispatchEvent(new CustomEvent('change', { detail: { state: this.state, progress: this.progress } }));
      };
      xhr.onload = () => {
        this.xhr = null;
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        const retryable = xhr.status >= 500 || xhr.status === 408 || xhr.status === 429;
        const e = new ChunkError(`chunk rejected (${xhr.status})`, { retryable, network: false });
        if (!retryable) e.message = 'The upload was rejected. Please start again.';
        reject(e);
      };
      xhr.onerror = () => { this.xhr = null; reject(new ChunkError('network', { retryable: true, network: true })); };
      xhr.ontimeout = () => { this.xhr = null; reject(new ChunkError('timeout', { retryable: true, network: true })); };
      xhr.onabort = () => { this.xhr = null; reject(new DOMException('Aborted', 'AbortError')); };
      xhr.timeout = 10 * 60 * 1000;
      xhr.send(form);
    });
  }

  async _complete() {
    for (let attempt = 1; ; attempt++) {
      try {
        const { video } = await api.completeUpload(this.session.videoId);
        return video;
      } catch (err) {
        const retry = (err.network || err.status >= 500 || err.code === 'UPLOAD_INCOMPLETE') && attempt < 6;
        if (!retry) { err.userMessage = err.message; throw err; }
        await sleep(Math.min(8000, 1000 * 2 ** (attempt - 1)));
      }
    }
  }
}

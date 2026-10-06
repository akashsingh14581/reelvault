// Pure business rules (no database / network access) — easy to unit test.

export const TERMINAL_STATUSES = ['DELETING', 'DELETED', 'EXPIRED'];

/** The single source of truth for "is this link still alive?" */
export function isExpired(video, now = Date.now()) {
  return new Date(video.expiresAt).getTime() <= now;
}

/** Status shown to people. A video past its expiry is EXPIRED even before cleanup ran. */
export function effectiveStatus(video, now = Date.now()) {
  if (video.status === 'DELETED' || video.status === 'DELETING') return video.status;
  if (isExpired(video, now)) return 'EXPIRED';
  return video.status;
}

/** Remaining time in ms (never negative). */
export const remainingMs = (video, now = Date.now()) => Math.max(0, new Date(video.expiresAt).getTime() - now);

/** Viewers whose last heartbeat is recent enough to count as watching. */
export function activeViewers(viewers = [], timeoutMs, now = Date.now()) {
  return viewers.filter((v) => now - new Date(v.lastSeen).getTime() < timeoutMs);
}

/**
 * Decide whether the stored original can be played directly by browsers.
 * `resource` is Cloudinary's resource description.
 */
export function needsConversion(resource) {
  const format = String(resource?.format || '').toLowerCase();
  const vcodec = String(resource?.video?.codec || '').toLowerCase();
  const acodec = String(resource?.audio?.codec || '').toLowerCase();
  const containerOk = format === 'mp4' || format === 'm4v';
  if (!containerOk) return true;
  if (vcodec && vcodec !== 'h264') return true;
  if (acodec && !['aac', 'mp3'].includes(acodec)) return true;
  return false;
}

/** Exponential backoff with a ceiling: 1m, 2m, 4m ... max 1h. */
export function cleanupBackoffMs(attempts) {
  const base = 60 * 1000;
  return Math.min(60 * 60 * 1000, base * 2 ** Math.max(0, attempts - 1));
}

export function extensionOf(name = '') {
  const m = /\.([A-Za-z0-9]{1,6})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

export function titleFromFileName(name = '') {
  const t = name.replace(/\.[A-Za-z0-9]{1,6}$/, '').replace(/[_]+/g, ' ').trim();
  return (t || 'Untitled video').slice(0, 200);
}

/** Filename safe for a Content-Disposition style flag (no extension). */
export function safeDownloadName(title = '') {
  const s = title
    .normalize('NFKD')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return s || 'video';
}

/**
 * Validate an upload request. Returns an array of {code,message}; empty when OK.
 */
export function validateUploadRequest({ fileName, size, mimeType }, limits, allowedExtensions) {
  const problems = [];
  if (!fileName || typeof fileName !== 'string') problems.push({ code: 'NO_FILE', message: 'Please choose a video file.' });
  if (!Number.isFinite(size) || size <= 0) problems.push({ code: 'EMPTY_FILE', message: 'This file looks empty.' });
  if (Number.isFinite(size) && size > limits.maxUploadBytes) {
    problems.push({
      code: 'TOO_LARGE',
      message: `File is too large. Maximum allowed size is ${formatBytes(limits.maxUploadBytes)}.`,
    });
  }
  const ext = extensionOf(fileName || '');
  const looksVideo = typeof mimeType === 'string' && mimeType.startsWith('video/');
  if (!allowedExtensions.includes(ext) && !looksVideo) {
    problems.push({ code: 'UNSUPPORTED_TYPE', message: 'This file type is not supported. Please choose a video file.' });
  }
  return problems;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** Parse the expiry the owner picked into a Date, or return an error string. */
export function resolveExpiry({ expiresInHours }, maxDays, now = Date.now()) {
  const hours = Number(expiresInHours);
  if (!Number.isFinite(hours) || hours < 1) return { error: 'Please choose when the link should expire.' };
  if (hours > maxDays * 24) return { error: `Links can last at most ${maxDays} days.` };
  return { date: new Date(now + hours * 3600 * 1000) };
}

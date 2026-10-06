const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'reelvault.token';

export const auth = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } },
  set: (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } },
};

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'UNKNOWN', data = {}, network = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
    this.network = network;
  }
}

const FRIENDLY = {
  network: 'Connection lost. Please check your internet and try again.',
  server: 'Something went wrong on our side. Please try again.',
};

export async function request(path, { method = 'GET', body, token = true, signal, keepalive } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const t = token ? auth.get() : '';
  if (t) headers.Authorization = `Bearer ${t}`;

  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, { method, headers, signal, keepalive, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(FRIENDLY.network, { network: true, code: 'NETWORK' });
  }

  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }

  if (!res.ok) {
    const e = data?.error || {};
    if (res.status === 401 && token && path !== '/auth/login') {
      auth.clear();
      window.dispatchEvent(new Event('reelvault:signed-out'));
    }
    throw new ApiError(e.message || (res.status >= 500 ? FRIENDLY.server : 'That did not work. Please try again.'), {
      status: res.status, code: e.code || 'ERROR', data: e,
    });
  }
  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password }, token: false }),
  me: () => request('/auth/me'),
  listVideos: () => request('/videos'),
  deleteVideo: (id) => request(`/videos/${id}`, { method: 'DELETE' }),
  retryVideo: (id) => request(`/videos/${id}/retry`, { method: 'POST' }),
  initUpload: (body) => request('/uploads/init', { method: 'POST', body }),
  signUpload: (id) => request(`/uploads/${id}/sign`, { method: 'POST' }),
  completeUpload: (id) => request(`/uploads/${id}/complete`, { method: 'POST' }),
  abortUpload: (id) => request(`/uploads/${id}/abort`, { method: 'POST' }),

  watchInfo: (shareId) => request(`/watch/${shareId}`, { token: false }),
  watchSession: (shareId, sessionId) => request(`/watch/${shareId}/session`, { method: 'POST', body: { sessionId }, token: false }),
  watchBeat: (shareId, sessionId) => request(`/watch/${shareId}/heartbeat`, { method: 'POST', body: { sessionId }, token: false }),
  watchPlayback: (shareId, sessionId) => request(`/watch/${shareId}/playback?sessionId=${encodeURIComponent(sessionId)}`, { token: false }),
  watchDownload: (shareId, sessionId) => request(`/watch/${shareId}/download?sessionId=${encodeURIComponent(sessionId)}`, { token: false }),
  leaveBeacon: (shareId, sessionId) => {
    try {
      navigator.sendBeacon?.(`${BASE}/api/watch/${shareId}/leave`, new Blob([JSON.stringify({ sessionId })], { type: 'text/plain' }));
    } catch { /* best effort */ }
  },
};

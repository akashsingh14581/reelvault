import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config.js';

/**
 * Storage provider: Cloudinary.
 *
 * All assets are uploaded with type "authenticated", so nothing is reachable
 * without a signed URL that only this server can generate. The browser uploads
 * straight to Cloudinary (signed, chunked) and streams/downloads straight from
 * Cloudinary's CDN — multi-GB traffic never flows through this server.
 */

let configured = false;
export function initStorage() {
  if (configured) return;
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
    secure: true,
  });
  configured = true;
}

const BASE = { resource_type: 'video', type: 'authenticated', sign_url: true, secure: true };

// The one browser-friendly rendition we generate for unsupported sources.
const CONVERT = { format: 'mp4', video_codec: 'h264', audio_codec: 'aac', quality: 'auto' };

export const publicIdFor = (videoId) => `reelvault/${videoId}`;

/** Signed parameters the browser needs to upload (chunked) directly to Cloudinary. */
export function signUpload(publicId) {
  initStorage();
  const timestamp = Math.round(Date.now() / 1000);
  const params = { public_id: publicId, type: 'authenticated', timestamp };
  const signature = cloudinary.utils.api_sign_request(params, config.cloudinary.apiSecret);
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudinary.cloudName}/video/upload`,
    apiKey: config.cloudinary.apiKey,
    params,
    signature,
    // Cloudinary accepts a signature for about an hour; refresh a little earlier.
    refreshAfterMs: 40 * 60 * 1000,
  };
}

function isNotFound(err) {
  const code = err?.http_code ?? err?.error?.http_code;
  return code === 404 || /not found/i.test(err?.message || err?.error?.message || '');
}

/** Fetch the stored original's metadata, or null if it does not exist. */
export async function getResource(publicId) {
  initStorage();
  try {
    return await cloudinary.api.resource(publicId, {
      resource_type: 'video',
      type: 'authenticated',
      media_metadata: true,
    });
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Ask Cloudinary to build the browser-friendly mp4 rendition in the background. */
export async function startConversion(publicId) {
  initStorage();
  await cloudinary.uploader.explicit(publicId, {
    resource_type: 'video',
    type: 'authenticated',
    eager: [CONVERT],
    eager_async: true,
  });
}

export function derivedUrl(publicId) {
  initStorage();
  return cloudinary.url(publicId, { ...BASE, ...CONVERT });
}

export function originalUrl(publicId, format) {
  initStorage();
  return cloudinary.url(publicId, { ...BASE, ...(format ? { format } : {}) });
}

export function posterUrl(publicId) {
  initStorage();
  return cloudinary.url(publicId, { ...BASE, format: 'jpg', start_offset: 'auto', width: 640, crop: 'limit' });
}

export function playbackUrlFor(video) {
  const { publicId, playbackMode, sourceFormat } = video.storage;
  return playbackMode === 'derived' ? derivedUrl(publicId) : originalUrl(publicId, sourceFormat || undefined);
}

export function downloadUrlFor(video, safeName) {
  initStorage();
  const { publicId, playbackMode, sourceFormat } = video.storage;
  const flags = `attachment:${safeName}`;
  const opts = { ...BASE, flags };
  if (playbackMode === 'derived') Object.assign(opts, CONVERT);
  else if (sourceFormat) opts.format = sourceFormat;
  return cloudinary.url(publicId, opts);
}

/**
 * Probe whether a URL is actually deliverable.
 * Returns "ready" | "pending" | "failed".
 */
export async function probe(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: ctrl.signal });
    // Don't download the body.
    res.body?.cancel?.().catch(() => {});
    if (res.status === 200 || res.status === 206) return 'ready';
    if (res.status === 423 || res.status === 202) return 'pending';
    return 'failed';
  } catch {
    return 'pending'; // transient network trouble: try again on the next tick
  } finally {
    clearTimeout(timer);
  }
}

/** Idempotent: a missing asset counts as successfully deleted. */
export async function destroyAsset(publicId) {
  initStorage();
  try {
    const res = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'video',
      type: 'authenticated',
      invalidate: true,
    });
    if (res?.result === 'ok' || res?.result === 'not found') return { deleted: res.result === 'ok' };
    throw new Error(`unexpected destroy result: ${res?.result}`);
  } catch (err) {
    if (isNotFound(err)) return { deleted: false };
    throw err;
  }
}

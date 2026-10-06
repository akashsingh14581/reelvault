import crypto from 'node:crypto';

/** URL-safe random token, e.g. for share links (128 bits of entropy by default). */
export function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('base64url');
}

const SESSION_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const isValidSessionId = (value) => typeof value === 'string' && SESSION_RE.test(value);

const SHARE_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const isValidShareId = (value) => typeof value === 'string' && SHARE_RE.test(value);

export function safeEqual(a, b) {
  const ba = crypto.createHash('sha256').update(String(a)).digest();
  const bb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ba, bb);
}

import crypto from 'node:crypto';

// scrypt (built into Node) — no extra dependency. Format: scrypt$N$salt$hash
const N = 16384;
const KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N }).toString('base64url');
  return `scrypt$${N}$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, n, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64url');
    const actual = crypto.scryptSync(password, salt, expected.length, { N: Number(n) });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Used so a wrong email takes as long as a wrong password (no account enumeration by timing).
export const DUMMY_HASH = hashPassword('reelvault-dummy-password');

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeViewers,
  cleanupBackoffMs,
  effectiveStatus,
  formatBytes,
  isExpired,
  needsConversion,
  resolveExpiry,
  safeDownloadName,
  titleFromFileName,
  validateUploadRequest,
} from '../src/services/rules.js';

const limits = { maxUploadBytes: 20 * 1024 ** 3 };
const exts = ['mp4', 'mkv'];

test('expiry is decided by expiresAt, not by status', () => {
  const v = { status: 'READY', expiresAt: new Date(1000) };
  assert.equal(isExpired(v, 999), false);
  assert.equal(isExpired(v, 1000), true);
  assert.equal(effectiveStatus(v, 5000), 'EXPIRED');
  assert.equal(effectiveStatus({ ...v, status: 'DELETING' }, 5000), 'DELETING');
});

test('stale viewers do not count', () => {
  const now = 100000;
  const viewers = [
    { sessionId: 'a', lastSeen: new Date(now - 10000) },
    { sessionId: 'b', lastSeen: new Date(now - 60000) },
  ];
  assert.equal(activeViewers(viewers, 45000, now).length, 1);
});

test('conversion is needed for non-mp4 or non-h264 sources', () => {
  assert.equal(needsConversion({ format: 'mp4', video: { codec: 'h264' }, audio: { codec: 'aac' } }), false);
  assert.equal(needsConversion({ format: 'mkv' }), true);
  assert.equal(needsConversion({ format: 'mp4', video: { codec: 'hevc' } }), true);
  assert.equal(needsConversion({ format: 'mp4', video: { codec: 'h264' }, audio: { codec: 'ac3' } }), true);
});

test('upload validation rejects oversize, empty and non-video files', () => {
  assert.equal(validateUploadRequest({ fileName: 'a.mp4', size: 100, mimeType: 'video/mp4' }, limits, exts).length, 0);
  assert.equal(validateUploadRequest({ fileName: 'a.mp4', size: 21 * 1024 ** 3 }, limits, exts)[0].code, 'TOO_LARGE');
  assert.equal(validateUploadRequest({ fileName: 'a.mp4', size: 0 }, limits, exts)[0].code, 'EMPTY_FILE');
  assert.equal(validateUploadRequest({ fileName: 'a.exe', size: 5, mimeType: 'application/x-msdownload' }, limits, exts)[0].code, 'UNSUPPORTED_TYPE');
});

test('expiry resolution enforces bounds', () => {
  assert.ok(resolveExpiry({ expiresInHours: 24 }, 30, 0).date instanceof Date);
  assert.ok(resolveExpiry({ expiresInHours: 0 }, 30).error);
  assert.ok(resolveExpiry({ expiresInHours: 24 * 31 }, 30).error);
});

test('cleanup backoff grows and is capped', () => {
  assert.equal(cleanupBackoffMs(1), 60000);
  assert.equal(cleanupBackoffMs(3), 240000);
  assert.equal(cleanupBackoffMs(30), 3600000);
});

test('names and sizes are formatted safely', () => {
  assert.equal(titleFromFileName('my_movie.final.mkv'), 'my movie.final');
  assert.equal(safeDownloadName('Café: "Night" / Cut!'), 'Cafe_Night_Cut');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(20 * 1024 ** 3), '20 GB');
});

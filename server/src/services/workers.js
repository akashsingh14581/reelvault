import { Video, STATUS } from '../models/Video.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import * as storage from './storage.js';
import { attemptDeletion, staleUploadCutoff } from './videos.js';

const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const FAIL_GRACE_MS = 3 * 60 * 1000; // a freshly requested rendition may 404 briefly

/* ───────────── Cleanup: expiry detection + retryable deletion ───────────── */

export async function cleanupTick(now = Date.now()) {
  const at = new Date(now);

  // 1) Anything past its expiry becomes EXPIRED immediately (links are already dead; this makes it durable).
  const due = await Video.find(
    { expiresAt: { $lte: at }, status: { $in: [STATUS.UPLOADING, STATUS.PROCESSING, STATUS.READY, STATUS.FAILED] } },
    { _id: 1 },
  ).limit(100);
  for (const { _id } of due) {
    const res = await Video.updateOne(
      { _id, status: { $in: [STATUS.UPLOADING, STATUS.PROCESSING, STATUS.READY, STATUS.FAILED] } },
      { $set: { status: STATUS.EXPIRED, nextCleanupAt: at, viewers: [] } },
    );
    if (res.modifiedCount) log.info('expiry.detected', { videoId: String(_id) });
  }

  // 2) Abandoned uploads (never completed) are cleaned up too.
  const stale = await Video.find({ status: STATUS.UPLOADING, updatedAt: { $lte: staleUploadCutoff(now) } }, { _id: 1 }).limit(50);
  for (const { _id } of stale) {
    await Video.updateOne(
      { _id, status: STATUS.UPLOADING },
      { $set: { status: STATUS.DELETING, deleteRequestedAt: at, nextCleanupAt: at, errorCode: 'UPLOAD_ABANDONED' } },
    );
    log.info('upload.abandoned', { videoId: String(_id) });
  }

  // 3) Delete stored files (first attempt and retries with backoff).
  const pending = await Video.find(
    {
      status: { $in: [STATUS.EXPIRED, STATUS.DELETING] },
      deletedAt: null,
      $or: [{ nextCleanupAt: null }, { nextCleanupAt: { $lte: at } }],
    },
    { _id: 1 },
  ).limit(50);
  for (const { _id } of pending) await attemptDeletion(_id);

  // 4) Forget very old finished records.
  await Video.deleteMany({ deletedAt: { $ne: null, $lte: new Date(now - PURGE_AFTER_MS) } });

  return { expired: due.length, abandoned: stale.length, cleaned: pending.length };
}

/* ───────────── Processing: verify renditions and mark READY ───────────── */

export async function processingTick(now = Date.now()) {
  const videos = await Video.find({ status: STATUS.PROCESSING }).limit(25);
  let ready = 0;
  let failed = 0;

  for (const video of videos) {
    const id = String(video._id);
    const age = now - new Date(video.processingStartedAt || video.updatedAt).getTime();
    const publicId = video.storage?.publicId;
    if (!publicId) {
      await markFailed(video, 'ORIGINAL_MISSING', 'no storage reference');
      failed++;
      continue;
    }

    const derived = video.storage.playbackMode === 'derived';
    const url = derived ? storage.derivedUrl(publicId) : storage.originalUrl(publicId, video.storage.sourceFormat || undefined);
    const state = await storage.probe(url);

    if (state === 'ready') {
      let bytes = video.storage.playbackBytes;
      if (derived) {
        try {
          const resource = await storage.getResource(publicId);
          const rendition = resource?.derived?.find((d) => /mp4/i.test(d.format || d.transformation || ''));
          if (rendition?.bytes) bytes = rendition.bytes;
        } catch {
          /* metadata is best-effort; the verified URL is what matters */
        }
      }
      // The source is kept: Cloudinary renditions are derived from it, so it is the anchor
      // for playback until the video expires or is deleted.
      const res = await Video.updateOne(
        { _id: video._id, status: STATUS.PROCESSING },
        { $set: { status: STATUS.READY, 'storage.playbackBytes': bytes || 0, errorCode: '', errorDetail: '' } },
      );
      if (res.modifiedCount) {
        ready++;
        log.info('conversion.completed', { videoId: id, derived, ms: age });
      }
      continue;
    }

    if (age > config.workers.processingTimeoutMs) {
      await markFailed(video, 'CONVERSION_TIMEOUT', `processing exceeded ${Math.round(age / 60000)} min`);
      failed++;
    } else if (state === 'failed' && age > FAIL_GRACE_MS) {
      await markFailed(video, 'CONVERSION_FAILED', 'rendition not deliverable');
      failed++;
    }
    // "pending": keep waiting
  }
  return { checked: videos.length, ready, failed };
}

async function markFailed(video, code, detail) {
  // The original is intentionally left untouched so conversion can be retried.
  await Video.updateOne(
    { _id: video._id, status: STATUS.PROCESSING },
    { $set: { status: STATUS.FAILED, errorCode: code, errorDetail: detail } },
  );
  log.error('conversion.failed', { videoId: String(video._id), code, detail });
}

/* ───────────── Scheduler ───────────── */

let timer = null;
let running = false;

export async function runAllTicks() {
  if (running) return { skipped: true };
  running = true;
  try {
    const processing = await processingTick();
    const cleanup = await cleanupTick();
    return { processing, cleanup };
  } catch (err) {
    log.error('worker.tick_failed', { error: err });
    return { error: true };
  } finally {
    running = false;
  }
}

export function startWorkers() {
  if (timer) return;
  const every = Math.min(config.workers.cleanupIntervalMs, 30 * 1000);
  runAllTicks();
  timer = setInterval(runAllTicks, every);
  timer.unref?.();
}

export function stopWorkers() {
  if (timer) clearInterval(timer);
  timer = null;
}

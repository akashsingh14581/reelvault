import { Video, STATUS } from '../models/Video.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { AppError } from '../utils/http.js';
import * as storage from './storage.js';
import { currentCount } from './viewers.js';
import { cleanupBackoffMs, effectiveStatus, isExpired, needsConversion } from './rules.js';

/* ───────────── DTOs: the only shapes that ever leave the server ───────────── */

export function toOwnerDto(video, now = Date.now()) {
  const status = effectiveStatus(video, now);
  const showPoster = status === STATUS.READY && video.storage?.publicId;
  return {
    id: String(video._id),
    shareId: video.shareId,
    title: video.title,
    originalName: video.originalName,
    size: video.size,
    status,
    errorCode: video.errorCode || '',
    expiresAt: video.expiresAt,
    createdAt: video.createdAt,
    durationSec: video.durationSec,
    viewers: currentCount(video, now),
    maxViewers: video.maxViewers,
    posterUrl: showPoster ? storage.posterUrl(video.storage.publicId) : '',
    canRetry: status === STATUS.FAILED && Boolean(video.storage?.publicId) && video.processingAttempts < 5,
    cleanupPending: (status === 'EXPIRED' || status === 'DELETING') && !video.deletedAt,
  };
}

export function toPublicDto(video, now = Date.now()) {
  const status = effectiveStatus(video, now);
  const live = status === STATUS.READY && video.storage?.publicId;
  return {
    shareId: video.shareId,
    title: video.title,
    size: video.size,
    durationSec: video.durationSec,
    status,
    errorCode: status === STATUS.FAILED ? video.errorCode || 'FAILED' : '',
    expiresAt: video.expiresAt,
    viewers: currentCount(video, now),
    maxViewers: video.maxViewers,
    posterUrl: live ? storage.posterUrl(video.storage.publicId) : '',
  };
}

/* ───────────── Upload completion ───────────── */

export async function completeUpload(video) {
  if (video.status !== STATUS.UPLOADING) return video; // idempotent: already completed
  if (isExpired(video)) throw new AppError(410, 'EXPIRED', 'This link has already expired.');

  const publicId = video.storage.publicId;
  const resource = await storage.getResource(publicId);
  if (!resource) {
    throw new AppError(409, 'UPLOAD_INCOMPLETE', 'The upload has not finished yet. Please try again in a moment.');
  }

  if (Number.isFinite(resource.bytes) && resource.bytes !== video.size) {
    log.warn('upload.size_mismatch', { videoId: String(video._id), expected: video.size, stored: resource.bytes });
  }

  const convert = needsConversion(resource);
  const update = {
    durationSec: Number(resource.duration) || 0,
    width: Number(resource.width) || 0,
    height: Number(resource.height) || 0,
    'storage.sourceFormat': resource.format || '',
    'storage.playbackMode': convert ? 'derived' : 'original',
    'storage.playbackBytes': convert ? 0 : Number(resource.bytes) || 0,
    status: STATUS.PROCESSING,
    processingStartedAt: new Date(),
    errorCode: '',
    errorDetail: '',
  };

  if (convert) {
    try {
      await storage.startConversion(publicId);
      log.info('conversion.started', { videoId: String(video._id), format: resource.format, vcodec: resource.video?.codec });
    } catch (err) {
      // Keep the original; the owner can retry the conversion.
      log.error('conversion.start_failed', { videoId: String(video._id), error: err });
      update.status = STATUS.FAILED;
      update.errorCode = 'CONVERSION_START_FAILED';
      update.errorDetail = String(err?.message || err).slice(0, 500);
    }
  }

  const saved = await Video.findOneAndUpdate(
    { _id: video._id, status: STATUS.UPLOADING },
    { $set: update },
    { new: true },
  );
  log.info('upload.completed', { videoId: String(video._id), size: video.size, convert, status: saved?.status });
  return saved || (await Video.findById(video._id));
}

export async function retryConversion(video) {
  if (video.status !== STATUS.FAILED || !video.storage?.publicId) {
    throw new AppError(409, 'NOT_RETRYABLE', 'This video cannot be retried.');
  }
  if (isExpired(video)) throw new AppError(410, 'EXPIRED', 'This link has already expired.');
  if (video.processingAttempts >= 5) throw new AppError(409, 'TOO_MANY_RETRIES', 'We could not prepare this video. Please upload it again.');

  const resource = await storage.getResource(video.storage.publicId);
  if (!resource) throw new AppError(409, 'ORIGINAL_MISSING', 'The original file is no longer available. Please upload it again.');

  const convert = needsConversion(resource);
  if (convert) await storage.startConversion(video.storage.publicId);

  const saved = await Video.findOneAndUpdate(
    { _id: video._id, status: STATUS.FAILED },
    {
      $set: {
        status: STATUS.PROCESSING,
        processingStartedAt: new Date(),
        errorCode: '',
        errorDetail: '',
        'storage.playbackMode': convert ? 'derived' : 'original',
      },
      $inc: { processingAttempts: 1 },
    },
    { new: true },
  );
  log.info('conversion.retry', { videoId: String(video._id), attempt: saved?.processingAttempts });
  return saved || video;
}

/* ───────────── Deletion (idempotent, retryable) ───────────── */

/** Owner-initiated deletion. Safe to call repeatedly. */
export async function requestDeletion(video) {
  if (video.status === STATUS.DELETED) return video;
  if (video.status !== STATUS.DELETING) {
    await Video.updateOne(
      { _id: video._id, status: { $nin: [STATUS.DELETING, STATUS.DELETED] } },
      { $set: { status: STATUS.DELETING, deleteRequestedAt: new Date(), nextCleanupAt: new Date(), viewers: [] } },
    );
  }
  return attemptDeletion(video._id);
}

/**
 * Remove the stored asset for a video that is DELETING or EXPIRED.
 * Never throws for storage trouble: the failure is recorded and retried with backoff.
 * The link is already dead (status check happens before anything is served).
 */
export async function attemptDeletion(videoId) {
  const video = await Video.findById(videoId);
  if (!video) return null;
  if (video.status === STATUS.DELETED || (video.status === STATUS.EXPIRED && video.deletedAt)) return video;
  if (video.status !== STATUS.DELETING && video.status !== STATUS.EXPIRED) return video;

  const publicId = video.storage?.publicId;
  try {
    if (publicId) {
      const res = await storage.destroyAsset(publicId);
      log.info('storage.deleted', { videoId: String(video._id), existed: res.deleted });
    }
    const set = {
      deletedAt: new Date(),
      nextCleanupAt: null,
      deleteLastError: '',
      viewers: [],
      'storage.publicId': '',
      'storage.playbackBytes': 0,
    };
    if (video.status === STATUS.DELETING) set.status = STATUS.DELETED;
    return await Video.findByIdAndUpdate(video._id, { $set: set }, { new: true });
  } catch (err) {
    const attempts = (video.deleteAttempts || 0) + 1;
    const wait = cleanupBackoffMs(attempts);
    log.error('storage.delete_failed', { videoId: String(video._id), attempts, retryInMs: wait, error: err });
    return await Video.findByIdAndUpdate(
      video._id,
      {
        $set: {
          deleteAttempts: attempts,
          deleteLastError: String(err?.message || err).slice(0, 300),
          nextCleanupAt: new Date(Date.now() + wait),
        },
      },
      { new: true },
    );
  }
}

export const staleUploadCutoff = (now = Date.now()) => new Date(now - config.workers.staleUploadMs);

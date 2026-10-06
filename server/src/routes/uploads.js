import { Router } from 'express';
import mongoose from 'mongoose';
import { Video, STATUS } from '../models/Video.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { AppError, asyncHandler } from '../utils/http.js';
import { randomToken } from '../utils/ids.js';
import { requireOwner } from '../middleware/auth.js';
import * as storage from '../services/storage.js';
import { completeUpload, requestDeletion, toOwnerDto } from '../services/videos.js';
import { resolveExpiry, titleFromFileName, validateUploadRequest } from '../services/rules.js';

const router = Router();
router.use(requireOwner);

async function loadOwned(req) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw new AppError(404, 'NOT_FOUND', 'That video no longer exists.');
  const video = await Video.findById(id);
  if (!video || video.status === STATUS.DELETED) throw new AppError(404, 'NOT_FOUND', 'That video no longer exists.');
  return video;
}

const uploadPayload = (video) => ({
  videoId: String(video._id),
  uploadId: video.uploadId,
  chunkSize: config.limits.chunkSize,
  ...storage.signUpload(video.storage.publicId),
});

router.post(
  '/init',
  asyncHandler(async (req, res) => {
    const { fileName, size, mimeType, fingerprint, title, expiresInHours, allowDuplicate } = req.body || {};

    const problems = validateUploadRequest({ fileName, size: Number(size), mimeType }, config.limits, config.allowedExtensions);
    if (problems.length) throw new AppError(400, problems[0].code, problems[0].message);

    const expiry = resolveExpiry({ expiresInHours }, config.limits.maxExpiryDays);
    if (expiry.error) throw new AppError(400, 'BAD_EXPIRY', expiry.error);

    const fp = typeof fingerprint === 'string' ? fingerprint.slice(0, 128) : '';
    if (fp && !allowDuplicate) {
      const existing = await Video.findOne({
        fingerprint: fp,
        status: { $in: [STATUS.UPLOADING, STATUS.PROCESSING, STATUS.READY] },
        expiresAt: { $gt: new Date() },
      }).sort({ createdAt: -1 });
      if (existing) {
        throw new AppError(409, 'DUPLICATE', 'You already uploaded a video that looks identical to this one.', {
          existing: { id: String(existing._id), title: existing.title, status: existing.status, shareId: existing.shareId },
        });
      }
    }

    const _id = new mongoose.Types.ObjectId();
    const video = await Video.create({
      _id,
      shareId: randomToken(16),
      title: (typeof title === 'string' && title.trim() ? title.trim() : titleFromFileName(fileName)).slice(0, 200),
      originalName: String(fileName).slice(0, 500),
      size: Number(size),
      mimeType: typeof mimeType === 'string' ? mimeType.slice(0, 100) : '',
      fingerprint: fp,
      status: STATUS.UPLOADING,
      uploadId: randomToken(18),
      expiresAt: expiry.date,
      maxViewers: config.limits.maxViewers,
      storage: { publicId: storage.publicIdFor(_id) },
    });

    log.info('upload.initialized', { videoId: String(video._id), size: video.size });
    res.status(201).json({ video: toOwnerDto(video), upload: uploadPayload(video) });
  }),
);

// Fresh signature for a long-running upload (signatures are only valid for about an hour).
router.post(
  '/:id/sign',
  asyncHandler(async (req, res) => {
    const video = await loadOwned(req);
    if (video.status !== STATUS.UPLOADING) throw new AppError(409, 'NOT_UPLOADING', 'This upload is no longer active.');
    res.json({ upload: uploadPayload(video) });
  }),
);

router.post(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const video = await loadOwned(req);
    const updated = await completeUpload(video);
    res.json({ video: toOwnerDto(updated) });
  }),
);

// Cancel an upload; the partial file (if any) is cleaned up.
router.post(
  '/:id/abort',
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!mongoose.isValidObjectId(id)) return res.json({ ok: true });
    const video = await Video.findById(id);
    if (video && video.status === STATUS.UPLOADING) {
      await requestDeletion(video);
      log.info('upload.aborted', { videoId: String(video._id) });
    }
    res.json({ ok: true });
  }),
);

export default router;

import { Router } from 'express';
import mongoose from 'mongoose';
import { Video, STATUS } from '../models/Video.js';
import { log } from '../logger.js';
import { AppError, asyncHandler } from '../utils/http.js';
import { requireOwner } from '../middleware/auth.js';
import { requestDeletion, retryConversion, toOwnerDto } from '../services/videos.js';

const router = Router();
router.use(requireOwner);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const videos = await Video.find({ status: { $ne: STATUS.DELETED } }).sort({ createdAt: -1 }).limit(200);
    const now = Date.now();
    res.json({ videos: videos.map((v) => toOwnerDto(v, now)) });
  }),
);

// Idempotent: deleting something already deleted (or being deleted) succeeds quietly.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.json({ ok: true, status: STATUS.DELETED });
    const video = await Video.findById(id);
    if (!video) return res.json({ ok: true, status: STATUS.DELETED });
    const after = await requestDeletion(video);
    log.info('video.delete_requested', { videoId: id, status: after?.status });
    res.json({ ok: true, status: after?.status || STATUS.DELETED, cleanupPending: after?.status === STATUS.DELETING });
  }),
);

router.post(
  '/:id/retry',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) throw new AppError(404, 'NOT_FOUND', 'That video no longer exists.');
    const video = await Video.findById(id);
    if (!video) throw new AppError(404, 'NOT_FOUND', 'That video no longer exists.');
    const updated = await retryConversion(video);
    res.json({ video: toOwnerDto(updated) });
  }),
);

export default router;

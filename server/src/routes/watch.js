import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Video, STATUS } from '../models/Video.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { AppError, asyncHandler } from '../utils/http.js';
import { isValidSessionId, isValidShareId } from '../utils/ids.js';
import { effectiveStatus, remainingMs, safeDownloadName } from '../services/rules.js';
import { toPublicDto } from '../services/videos.js';
import * as storage from '../services/storage.js';
import * as viewers from '../services/viewers.js';

const router = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please slow down for a moment.')),
});
router.use(limiter);

/** Load by share link. Unknown, deleted and expired links all fail closed. */
async function loadShared(req, { requireReady = false } = {}) {
  const { shareId } = req.params;
  if (!isValidShareId(shareId)) throw new AppError(404, 'NOT_FOUND', 'This video is no longer available.');
  const video = await Video.findOne({ shareId });
  if (!video) throw new AppError(404, 'NOT_FOUND', 'This video is no longer available.');

  const status = effectiveStatus(video);
  if (status === STATUS.EXPIRED) {
    log.info('expiry.blocked_access', { videoId: String(video._id) });
    throw new AppError(410, 'EXPIRED', 'This video link has expired.');
  }
  if (status === STATUS.DELETING || status === STATUS.DELETED) {
    throw new AppError(410, 'DELETED', 'This video is no longer available.');
  }
  if (requireReady && status !== STATUS.READY) {
    throw new AppError(409, 'NOT_READY', 'This video is still being prepared.');
  }
  return video;
}

function sessionIdFrom(req) {
  const id = req.body?.sessionId || req.query?.sessionId || req.get('x-viewer-session');
  if (!isValidSessionId(id)) throw new AppError(400, 'BAD_SESSION', 'Please reload the page and try again.');
  return id;
}

// Public info (never claims a viewer slot, never returns media URLs).
router.get(
  '/:shareId',
  asyncHandler(async (req, res) => {
    const video = await loadShared(req);
    res.json({ video: toPublicDto(video), remainingMs: remainingMs(video) });
  }),
);

// Claim (or refresh) a viewer slot. The 4th simultaneous viewer gets a clear 403.
router.post(
  '/:shareId/session',
  asyncHandler(async (req, res) => {
    const sessionId = sessionIdFrom(req);
    const video = await loadShared(req, { requireReady: true });
    const slot = await viewers.claimSlot(video, sessionId);
    if (!slot.ok) {
      throw new AppError(403, 'VIEWER_LIMIT', `This video is already being watched by ${slot.max} people. Please try again in a little while.`, {
        viewers: slot.count,
        maxViewers: slot.max,
      });
    }
    log.info('video.accessed', { videoId: String(video._id), viewers: slot.count });
    res.json({
      viewers: slot.count,
      maxViewers: slot.max,
      heartbeatMs: Math.max(5000, Math.floor(config.limits.viewerTimeoutMs / 3)),
      remainingMs: remainingMs(video),
    });
  }),
);

router.post(
  '/:shareId/heartbeat',
  asyncHandler(async (req, res) => {
    const sessionId = sessionIdFrom(req);
    const video = await loadShared(req);
    const slot = await viewers.heartbeat(video, sessionId);
    if (!slot) throw new AppError(409, 'SESSION_LOST', 'Your viewing session ended. Reconnecting…');
    res.json({ viewers: slot.count, maxViewers: slot.max, remainingMs: remainingMs(video) });
  }),
);

// Called with navigator.sendBeacon when the tab closes (best effort — timeout is the safety net).
router.post(
  '/:shareId/leave',
  asyncHandler(async (req, res) => {
    const { shareId } = req.params;
    const sessionId = req.body?.sessionId;
    if (isValidShareId(shareId) && isValidSessionId(sessionId)) {
      const video = await Video.findOne({ shareId }, { _id: 1 });
      if (video) await viewers.leave(video, sessionId);
    }
    res.status(204).end();
  }),
);

// Short-lived, per-request playback URL. Re-requested by the player when playback fails or time passes.
router.get(
  '/:shareId/playback',
  asyncHandler(async (req, res) => {
    const sessionId = sessionIdFrom(req);
    const video = await loadShared(req, { requireReady: true });
    if (!(await viewers.hasActiveSession(video, sessionId))) {
      throw new AppError(409, 'SESSION_LOST', 'Your viewing session ended. Reconnecting…');
    }
    res.set('Cache-Control', 'no-store');
    res.json({ url: storage.playbackUrlFor(video), remainingMs: remainingMs(video) });
  }),
);

// Direct-from-CDN download link; multi-GB traffic does not pass through this server.
router.get(
  '/:shareId/download',
  asyncHandler(async (req, res) => {
    const sessionId = sessionIdFrom(req);
    const video = await loadShared(req, { requireReady: true });
    if (!(await viewers.hasActiveSession(video, sessionId))) {
      throw new AppError(409, 'SESSION_LOST', 'Your viewing session ended. Reconnecting…');
    }
    log.info('download.requested', { videoId: String(video._id) });
    res.set('Cache-Control', 'no-store');
    res.json({ url: storage.downloadUrlFor(video, safeDownloadName(video.title)), size: video.storage.playbackBytes || video.size });
  }),
);

export default router;

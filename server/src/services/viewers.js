import { Video } from '../models/Video.js';
import { config } from '../config.js';
import { activeViewers } from './rules.js';

const timeout = () => config.limits.viewerTimeoutMs;

/** Drop viewers that stopped sending heartbeats (closed tab, crashed phone, offline...). */
export async function pruneStale(videoId, now = Date.now()) {
  const cutoff = new Date(now - timeout());
  await Video.updateOne({ _id: videoId }, { $pull: { viewers: { lastSeen: { $lte: cutoff } } } });
}

/**
 * Claim (or refresh) a viewer slot atomically.
 * Returns { ok: true, count, max } or { ok: false, count, max }.
 */
export async function claimSlot(video, sessionId, now = Date.now()) {
  const id = video._id;
  const at = new Date(now);
  await pruneStale(id, now);

  // 1) Already holding a slot? Just refresh it.
  const refreshed = await Video.findOneAndUpdate(
    { _id: id, 'viewers.sessionId': sessionId },
    { $set: { 'viewers.$.lastSeen': at } },
    { new: true, projection: { viewers: 1, maxViewers: 1 } },
  );
  if (refreshed) return summarize(refreshed, true, now);

  // 2) Take a new slot only if there is room — the size check and the push are one atomic operation.
  const claimed = await Video.findOneAndUpdate(
    {
      _id: id,
      'viewers.sessionId': { $ne: sessionId },
      $expr: { $lt: [{ $size: '$viewers' }, '$maxViewers'] },
    },
    { $push: { viewers: { sessionId, startedAt: at, lastSeen: at } } },
    { new: true, projection: { viewers: 1, maxViewers: 1 } },
  );
  if (claimed) return summarize(claimed, true, now);

  const current = await Video.findById(id, { viewers: 1, maxViewers: 1 });
  return summarize(current, false, now);
}

/** Heartbeat for an existing session. `ok:false` means the slot was lost and must be re-claimed. */
export async function heartbeat(video, sessionId, now = Date.now()) {
  const updated = await Video.findOneAndUpdate(
    { _id: video._id, 'viewers.sessionId': sessionId },
    { $set: { 'viewers.$.lastSeen': new Date(now) } },
    { new: true, projection: { viewers: 1, maxViewers: 1 } },
  );
  if (!updated) return null;
  return summarize(updated, true, now);
}

export async function leave(video, sessionId) {
  await Video.updateOne({ _id: video._id }, { $pull: { viewers: { sessionId } } });
}

export async function hasActiveSession(video, sessionId, now = Date.now()) {
  const doc = await Video.findOne(
    { _id: video._id, viewers: { $elemMatch: { sessionId, lastSeen: { $gt: new Date(now - timeout()) } } } },
    { _id: 1 },
  );
  return Boolean(doc);
}

export function summarize(doc, ok, now = Date.now()) {
  const active = activeViewers(doc?.viewers || [], timeout(), now);
  return { ok, count: active.length, max: doc?.maxViewers ?? config.limits.maxViewers };
}

export function currentCount(video, now = Date.now()) {
  return activeViewers(video.viewers || [], timeout(), now).length;
}

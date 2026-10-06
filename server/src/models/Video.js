import mongoose from 'mongoose';

export const STATUS = Object.freeze({
  UPLOADING: 'UPLOADING',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  DELETING: 'DELETING',
  DELETED: 'DELETED',
});

const viewerSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true },
    startedAt: { type: Date, required: true },
    lastSeen: { type: Date, required: true },
  },
  { _id: false },
);

const videoSchema = new mongoose.Schema(
  {
    shareId: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    originalName: { type: String, required: true, maxlength: 500 },
    size: { type: Number, required: true }, // bytes of the uploaded original
    mimeType: { type: String, default: '' },
    fingerprint: { type: String, default: '', index: true },

    status: { type: String, enum: Object.values(STATUS), default: STATUS.UPLOADING, index: true },
    errorCode: { type: String, default: '' }, // short machine code, never shown raw to users
    errorDetail: { type: String, default: '' }, // technical detail, server-side only

    uploadId: { type: String, default: '' }, // X-Unique-Upload-Id used for chunked upload
    expiresAt: { type: Date, required: true, index: true },
    maxViewers: { type: Number, default: 3 },
    viewers: { type: [viewerSchema], default: [] },

    durationSec: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },

    storage: {
      publicId: { type: String, default: '' },
      sourceFormat: { type: String, default: '' },
      playbackMode: { type: String, enum: ['original', 'derived', ''], default: '' },
      playbackBytes: { type: Number, default: 0 },
    },

    // Processing bookkeeping
    processingStartedAt: { type: Date, default: null },
    processingAttempts: { type: Number, default: 0 },

    // Cleanup bookkeeping (kept so a failed deletion can always be retried)
    deleteRequestedAt: { type: Date, default: null },
    deleteAttempts: { type: Number, default: 0 },
    deleteLastError: { type: String, default: '' },
    nextCleanupAt: { type: Date, default: null, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

videoSchema.index({ status: 1, nextCleanupAt: 1 });

export const Video = mongoose.models.Video || mongoose.model('Video', videoSchema);

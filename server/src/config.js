const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const env = process.env;

export const config = {
  nodeEnv: env.NODE_ENV || 'development',
  isProd: env.NODE_ENV === 'production',
  port: num(env.PORT, 4000),
  mongoUri: env.MONGODB_URI || '',
  jwtSecret: env.JWT_SECRET || '',
  clientOrigin: env.CLIENT_ORIGIN || '',
  publicBaseUrl: env.PUBLIC_BASE_URL || '',
  cronSecret: env.CRON_SECRET || '',
  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: env.CLOUDINARY_API_KEY || '',
    apiSecret: env.CLOUDINARY_API_SECRET || '',
  },
  limits: {
    maxUploadBytes: num(env.MAX_UPLOAD_BYTES, 20 * 1024 ** 3),
    maxExpiryDays: num(env.MAX_EXPIRY_DAYS, 30),
    maxViewers: num(env.MAX_VIEWERS, 3),
    viewerTimeoutMs: num(env.VIEWER_TIMEOUT_SECONDS, 45) * 1000,
    chunkSize: 10 * 1024 * 1024, // Cloudinary requires >= 5 MB per chunk (except the last)
  },
  workers: {
    cleanupIntervalMs: num(env.CLEANUP_INTERVAL_SECONDS, 60) * 1000,
    processingTimeoutMs: num(env.PROCESSING_TIMEOUT_MINUTES, 45) * 60 * 1000,
    staleUploadMs: num(env.STALE_UPLOAD_HOURS, 24) * 60 * 60 * 1000,
  },
  allowedExtensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wmv', 'flv', 'mpeg', 'mpg', '3gp', 'ts', 'mts', 'm2ts', 'ogv'],
};

/** Returns a list of human-readable problems with the current configuration. */
export function validateConfig() {
  const problems = [];
  if (!config.mongoUri) problems.push('MONGODB_URI is not set');
  if (!config.jwtSecret || config.jwtSecret.length < 16) problems.push('JWT_SECRET must be set (16+ characters)');
  const c = config.cloudinary;
  if (!c.cloudName || !c.apiKey || !c.apiSecret) problems.push('Cloudinary credentials are not fully set');
  return problems;
}

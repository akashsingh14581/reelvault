import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import mongoose from 'mongoose';
import { config } from './config.js';
import { AppError, asyncHandler } from './utils/http.js';
import { safeEqual } from './utils/ids.js';
import { errorHandler, notFoundApi } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import uploadRoutes from './routes/uploads.js';
import videoRoutes from './routes/videos.js';
import watchRoutes from './routes/watch.js';
import { runAllTicks } from './services/workers.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // Render sits behind a proxy

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'media-src': ["'self'", 'blob:', 'https://res.cloudinary.com'],
          'img-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
          'connect-src': ["'self'", 'https://api.cloudinary.com', 'https://res.cloudinary.com'],
          'font-src': ["'self'", 'data:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  if (config.clientOrigin) {
    app.use('/api', cors({ origin: config.clientOrigin.split(',').map((s) => s.trim()), maxAge: 600 }));
  }

  // sendBeacon posts JSON as text/plain, so accept both.
  app.use('/api', express.json({ limit: '100kb', type: ['application/json', 'text/plain'] }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, db: mongoose.connection.readyState === 1 });
  });

  // Lets an external pinger drive the workers even if the free-tier host was asleep.
  app.post(
    '/api/cron/tick',
    asyncHandler(async (req, res) => {
      const given = req.get('x-cron-secret') || '';
      if (!config.cronSecret || !safeEqual(given, config.cronSecret)) throw new AppError(401, 'AUTH_REQUIRED', 'Not allowed.');
      res.json(await runAllTicks());
    }),
  );

  app.use('/api/auth', authRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/videos', videoRoutes);
  app.use('/api/watch', watchRoutes);
  app.use('/api', notFoundApi);

  // Serve the built client (single-service deployment).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(here, '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(dist, { maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}

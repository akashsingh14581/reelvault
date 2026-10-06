import { AppError } from '../utils/http.js';
import { log } from '../logger.js';

export function notFoundApi(_req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', 'That page or action does not exist.'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'That request could not be understood.' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'BAD_REQUEST', message: 'That request was too large.' } });
  }
  // Technical details stay on the server.
  log.error('request.failed', { method: req.method, path: req.path, error: err });
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong on our side. Please try again.' } });
}

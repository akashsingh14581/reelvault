import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError } from '../utils/http.js';

const TOKEN_TTL = '7d';

export function signOwnerToken(user) {
  return jwt.sign({ role: 'owner', sub: String(user._id) }, config.jwtSecret, { expiresIn: TOKEN_TTL });
}

export function requireOwner(req, _res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return next(new AppError(401, 'AUTH_REQUIRED', 'Please sign in to continue.'));
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.role !== 'owner') throw new Error('bad role');
    next();
  } catch {
    next(new AppError(401, 'AUTH_REQUIRED', 'Your session has expired. Please sign in again.'));
  }
}

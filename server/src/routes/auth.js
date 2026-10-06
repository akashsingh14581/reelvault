import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { log } from '../logger.js';
import { AppError, asyncHandler } from '../utils/http.js';
import { DUMMY_HASH, verifyPassword } from '../utils/password.js';
import { requireOwner, signOwnerToken } from '../middleware/auth.js';
import { User } from '../models/User.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Please wait a few minutes and try again.')),
});

// Accounts are created only by `npm run seed` — there is no sign-up and no OTP.
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) throw new AppError(400, 'BAD_CREDENTIALS', 'Please enter your email and password.');

    const user = await User.findOne({ email });
    const ok = verifyPassword(password, user ? user.passwordHash : DUMMY_HASH) && Boolean(user);
    if (!ok) {
      log.warn('auth.login_failed', { ip: req.ip });
      throw new AppError(401, 'BAD_CREDENTIALS', 'That email or password is not correct.');
    }
    log.info('auth.login', { userId: String(user._id) });
    res.json({ token: signOwnerToken(user), name: user.name });
  }),
);

router.get('/me', requireOwner, (_req, res) => res.json({ ok: true }));

export default router;

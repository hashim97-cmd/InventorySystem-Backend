import rateLimit from 'express-rate-limit';

export const backupLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minutes
  max: 3,
  message: { message: 'Too many backup attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const restoreLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1,
  message: { message: 'Too many restore attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
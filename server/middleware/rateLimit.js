const rateLimit = require('express-rate-limit');

/**
 * Escape hatch for the test suite.
 *
 * Checked per-request (not once at load) so an individual test can switch it
 * off and assert that throttling really engages, while every other test runs
 * without limits leaking across cases.
 */
const isDisabled = () => process.env.DISABLE_RATE_LIMIT === 'true';

/** Consistent 429 body so the client can render it like any other API error. */
const tooManyRequests = (message) => (req, res) =>
  res.status(429).json({ status: 'fail', message });

/**
 * Broad limiter for the whole API.
 *
 * Deliberately loose: a user dragging cards around the board fires a lot of
 * small PATCHes, and throttling normal use would be worse than the abuse it
 * prevents.
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Limits would otherwise leak across test cases and make them order-dependent.
  skip: isDisabled,
  handler: tooManyRequests('Too many requests. Please slow down and try again shortly.'),
});

/**
 * Strict limiter for credential endpoints (login + register).
 *
 * 10 attempts per 15 minutes per IP is far above what a human needs and far
 * below what credential stuffing requires.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Don't count successful logins against the budget — only failures.
  skipSuccessfulRequests: true,
  skip: isDisabled,
  handler: tooManyRequests(
    'Too many login attempts from this device. Please try again in 15 minutes.'
  ),
});

module.exports = { apiLimiter, authLimiter };

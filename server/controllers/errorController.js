const AppError = require('../utils/AppError');

/**
 * Resolve the current environment defensively.
 *
 * `process.env.NODE_ENV` is frequently undefined (plain `node server.js`,
 * some PaaS shells, test runners). The previous implementation called
 * `.trim()` on it unconditionally, which made the *error handler itself*
 * throw a TypeError — turning every handled error into an unhandled crash.
 */
const getEnv = () => String(process.env.NODE_ENV || 'development').trim().toLowerCase();

const isProduction = () => getEnv() === 'production';

/** Mongo duplicate-key error -> 409 with a per-field message. */
const handleDuplicateKeyError = (err) => {
  const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
  const error = new AppError(`${field} already exists.`, 409);
  error.errors = { [field]: `This ${field} is already registered.` };
  return error;
};

/** Mongoose ValidationError -> 400 with a per-field message map. */
const handleValidationError = (err) => {
  const errors = {};
  Object.keys(err.errors || {}).forEach((key) => {
    errors[key] = err.errors[key].message;
  });

  const error = new AppError('Some of the values you entered are not valid.', 400);
  error.errors = errors;
  return error;
};

/**
 * Mongoose CastError -> 400.
 *
 * A malformed ObjectId (`/tasks/not-an-object-id`) is a bad request, not a
 * server fault. Returning 400 keeps the response honest and — critically —
 * keeps this path inside the operational branch so no stack ever leaks.
 */
const handleCastError = (err) =>
  new AppError(`Invalid value for ${err.path}.`, 400);

const handleJwtError = () =>
  new AppError('Your session is invalid. Please log in again.', 401);

const handleJwtExpiredError = () =>
  new AppError('Your session has expired. Please log in again.', 401);

/** Body-parser rejection for malformed JSON. */
const handleJsonSyntaxError = () =>
  new AppError('Request body is not valid JSON.', 400);

/** express.json({ limit }) rejection. */
const handlePayloadTooLargeError = () =>
  new AppError('Request body is too large.', 413);

/**
 * Normalise any thrown value into an AppError-shaped object.
 * Never throws: every branch is total.
 */
const normaliseError = (err) => {
  if (err && err.code === 11000) return handleDuplicateKeyError(err);
  if (err && err.name === 'ValidationError') return handleValidationError(err);
  if (err && err.name === 'CastError') return handleCastError(err);
  if (err && err.name === 'JsonWebTokenError') return handleJwtError();
  if (err && err.name === 'TokenExpiredError') return handleJwtExpiredError();
  if (err && err.name === 'NotBeforeError') return handleJwtError();
  if (err && err.type === 'entity.parse.failed') return handleJsonSyntaxError();
  if (err && err.type === 'entity.too.large') return handlePayloadTooLargeError();
  return err;
};

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity (4 args).
module.exports = (err, req, res, next) => {
  // If headers already went out, delegate to Express' default handler so we
  // don't attempt a second write on a closed response.
  if (res.headersSent) return next(err);

  let error = normaliseError(err) || new AppError('Something went wrong.', 500);

  const statusCode = Number(error.statusCode) || 500;
  const status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';

  const body = {
    status,
    message: error.isOperational
      ? error.message
      : 'Something went wrong. Please try again.',
  };

  if (error.errors) body.errors = error.errors;

  if (isProduction()) {
    // Unexpected (non-operational) failures are logged server-side only —
    // the client never sees the stack, the file paths, or the driver message.
    if (!error.isOperational) {
      console.error('Unhandled error:', err && err.stack ? err.stack : err);
    }
    return res.status(statusCode).json(body);
  }

  // Development: keep the real message and stack for debugging, but keep the
  // envelope identical so the frontend behaves the same in both environments.
  body.message = error.message || body.message;
  body.stack = err && err.stack;
  return res.status(statusCode).json(body);
};

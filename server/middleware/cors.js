const AppError = require('../utils/AppError');

/**
 * Origins that may call this API from a browser.
 *
 * `CLIENT_URL` is a comma-separated list so a deployment can allow, say, the
 * production domain plus a preview domain without a code change.
 */
const parseAllowedOrigins = () => {
  const configured = (process.env.CLIENT_URL || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const env = String(process.env.NODE_ENV || 'development').trim().toLowerCase();

  if (env === 'production') return configured;

  // Local dev servers are always allowed outside production so a fresh clone
  // works without configuration.
  return [
    ...configured,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://localhost:3000',
  ];
};

module.exports = function buildCorsOptions() {
  const allowed = parseAllowedOrigins();

  return {
    origin(origin, callback) {
      // No Origin header: same-origin navigations, curl, server-to-server and
      // health checks. These are not cross-origin browser requests, so CORS
      // has nothing to protect against here.
      if (!origin) return callback(null, true);

      if (allowed.includes(origin.replace(/\/$/, ''))) {
        return callback(null, true);
      }

      return callback(new AppError('This origin is not allowed to access the API.', 403));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  };
};

module.exports.parseAllowedOrigins = parseAllowedOrigins;

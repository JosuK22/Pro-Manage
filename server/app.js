const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const morgan = require('morgan');

const globalErrorHandler = require('./controllers/errorController');
const AppError = require('./utils/AppError');
const { apiLimiter, authLimiter } = require('./middleware/rateLimit');
const buildCorsOptions = require('./middleware/cors');

const authRouter = require('./routes/authRoute');
const taskRouter = require('./routes/taskRoute');
const userRouter = require('./routes/userRoute');
const assigneeRouter = require('./routes/assigneeRoute');

const app = express();

const env = String(process.env.NODE_ENV || 'development').trim().toLowerCase();

// Render/Vercel and most PaaS put the app behind a proxy. Without this the
// rate limiter sees every request as coming from the proxy's IP and would
// throttle all users as one.
app.set('trust proxy', 1);

// --- Security headers -------------------------------------------------------
// This is a JSON API, not an HTML app, so the restrictive defaults are fine.
// `crossOriginResourcePolicy` is relaxed to same-site so the separately hosted
// SPA can read responses.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// --- CORS -------------------------------------------------------------------
// Explicit allowlist driven by CLIENT_URL. Bare `cors()` reflected every
// origin, which let any site on the internet call the API with a user's token.
app.use(cors(buildCorsOptions()));

// --- Body parsing -----------------------------------------------------------
// A bounded body size stops a single request from exhausting memory. Tasks are
// small documents; 100kb is generous for a title plus a checklist.
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// --- Injection hardening ----------------------------------------------------
// Strips `$`-prefixed and dotted keys so a body like
// `{ "email": { "$gt": "" } }` cannot turn a lookup into an operator query.
app.use(mongoSanitize());

if (env === 'development') {
  app.use(morgan('dev'));
}

// --- Rate limiting ----------------------------------------------------------
app.use('/api', apiLimiter);

app.get('/', (req, res) => res.status(200).json({ status: 'success', message: 'Pro-Manage API' }));

app.get('/api/v1/health', (req, res) =>
  res.status(200).json({ status: 'success', data: { uptime: process.uptime() } })
);

// The stricter limiter is mounted ahead of the auth router so credential
// stuffing is throttled before it reaches bcrypt.
app.use('/api/v1/auth', authLimiter, authRouter);
app.use('/api/v1/tasks', taskRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/assignees', assigneeRouter);

app.all('*', (req, res, next) => {
  next(new AppError(`Cannot ${req.method} ${req.originalUrl}`, 404));
});

app.use(globalErrorHandler);

module.exports = app;

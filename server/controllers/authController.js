const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const User = require('../model/userModel');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

/**
 * A real bcrypt hash (of a value nobody can log in with) used purely to burn
 * the same CPU time as a genuine comparison when the account does not exist.
 * Generated once at module load with the same cost factor as stored passwords.
 */
const DUMMY_HASH = bcrypt.hashSync('pro-manage-nonexistent-account', 12);

const compareAgainstDummyHash = (password) =>
  bcrypt.compare(String(password ?? ''), DUMMY_HASH);

const signToken = (userId) => {
  if (!process.env.JWT_SECRET_KEY) {
    // Fail loudly at request time rather than signing with `undefined`,
    // which jsonwebtoken would reject anyway but with a confusing message.
    throw new AppError('Authentication is not configured on this server.', 500);
  }

  return jwt.sign({ id: userId }, process.env.JWT_SECRET_KEY, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

/**
 * Single place that shapes an authenticated response.
 * `toPublicJSON()` guarantees no password material can leak.
 */
const sendAuthResponse = (user, statusCode, res) => {
  const token = signToken(user._id);

  res.status(statusCode).json({
    status: 'success',
    data: {
      info: user.toPublicJSON(),
      token,
    },
  });
};

exports.register = catchAsync(async (req, res, next) => {
  const { email, name, password, confirmPassword } = req.body;

  // Explicit field picking — a client cannot smuggle extra fields into the
  // new document (e.g. a `role`, or someone else's `_id`).
  const user = await User.create({ email, name, password, confirmPassword });

  // Registering logs the user straight in: the client no longer has to make a
  // second login round-trip, and we never echo the stored document back.
  sendAuthResponse(user, 201, res);
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Email and password are required.', 400);
  }

  const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select(
    '+password'
  );

  // Identical response for "no such user" and "wrong password" so the endpoint
  // cannot be used to enumerate registered email addresses.
  //
  // The comparison also has to take a similar amount of time in both cases:
  // returning early for an unknown email answered in ~2ms while a real account
  // took ~230ms in bcrypt, and that gap alone reveals which emails exist. So
  // we always run one bcrypt comparison, against a dummy hash when needed.
  const passwordMatches = user
    ? await user.comparePasswords(password, user.password)
    : await compareAgainstDummyHash(password);

  if (!user || !passwordMatches) {
    throw new AppError('Email or password is incorrect.', 401);
  }

  sendAuthResponse(user, 200, res);
});

exports.protect = catchAsync(async (req, res, next) => {
  const { authorization } = req.headers;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    throw new AppError('Please log in to access this resource.', 401);
  }

  const token = authorization.slice('Bearer '.length).trim();

  if (!token) {
    throw new AppError('Please log in to access this resource.', 401);
  }

  // Malformed / expired tokens surface as JsonWebTokenError / TokenExpiredError
  // and are mapped to a clean 401 by the global error handler.
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET_KEY);

  const user = await User.findById(decoded.id);

  if (!user) {
    // The account was deleted after the token was issued.
    throw new AppError('This account no longer exists. Please log in again.', 401);
  }

  req.user = user;
  next();
});

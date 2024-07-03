const { promisify } = require('util');
const User = require('../model/userModel');
const catchAsync = require('../utils/catchAsync');
const jwt = require('jsonwebtoken');



const AppError = require('../utils/AppError');

exports.register = catchAsync(async (req, res, next) => {
  console.log('Received register request');
  const { email, name, password, confirmPassword } = req.body;

  const user = await User.create({ email, name, password, confirmPassword });

  res.status(200).json({
    status: 'success',
    data: user,
  });
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Email and Password are required!', 400);
  }

  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.comparePasswords(password, user.password))) {
    throw new AppError('Email or password mismatch', 400);
  }

  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET_KEY, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

  res.status(200).json({
    message: 'success',
    data: {
      info: { email: user.email, name: user.name, _id: user._id },
      token,
    },
  });
});

exports.protect = catchAsync(async (req, res, next) => {
  const { authorization } = req.headers;

  if (!authorization) {
    throw new AppError('Please login to access this route', 401);
  }

  const token = authorization.split(' ')[1];

  const decoded = await promisify(jwt.verify)(
    token,
    process.env.JWT_SECRET_KEY
  );

  const user = await User.findOne({ _id: decoded.id });
  if (!user) {
    throw new AppError('User does not exist!', 401);
  }

  req.user = user;

  next();
});

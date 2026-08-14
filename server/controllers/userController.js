const User = require('../model/userModel');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

exports.getUser = catchAsync(async (req, res) => {
  // `protect` already loaded and verified the user.
  res.status(200).json({
    status: 'success',
    data: { info: req.user.toPublicJSON() },
  });
});

exports.updateUser = catchAsync(async (req, res) => {
  const { name, email, newPassword, oldPassword } = req.body;

  // Always operate on the *session's* user. There is no user id in the route,
  // so one account can never be used to edit another.
  const user = await User.findById(req.user._id).select('+password');

  if (!user) {
    throw new AppError('This account no longer exists. Please log in again.', 401);
  }

  if (newPassword) {
    if (!oldPassword) {
      throw new AppError(
        'You must provide your current password to set a new one.',
        400
      );
    }

    if (!(await user.comparePasswords(oldPassword, user.password))) {
      throw new AppError('Your current password is incorrect.', 401);
    }

    if (oldPassword === newPassword) {
      throw new AppError('Your new password must be different from the current one.', 400);
    }

    // Assigning the plaintext lets the schema's pre-save hook hash it with the
    // single canonical cost factor, instead of this controller keeping its own
    // copy of that number.
    user.password = newPassword;
  }

  // Explicit allowlist — only these two profile fields are ever writable, and
  // only when actually supplied.
  if (typeof name === 'string' && name.trim()) user.name = name.trim();
  if (typeof email === 'string' && email.trim()) user.email = email.trim().toLowerCase();

  await user.save();

  res.status(200).json({
    status: 'success',
    data: { info: user.toPublicJSON() },
  });
});

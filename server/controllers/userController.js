const bcrypt = require('bcrypt');
const User = require('../model/userModel');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

const filterObject = (obj, arr) => {
  const updatedObj = {};

  Object.keys(obj).forEach((key) => {
    if (obj[key]) {
      updatedObj[key] = obj[key];
    }
  });

  return updatedObj;
};

exports.getUser = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.status(200).json({
    status: 'success',
    data: { info: { name: user.name, email: user.email, _id: user._id } },
  });
});

exports.updateUser = catchAsync(async (req, res) => {
  const { name, newPassword, oldPassword } = req.body;
  let hashPassword;

  if (newPassword) {
    if (!oldPassword) {
      throw new AppError(
        'You must provide your old password to update your password.',
        400
      );
    } else {
      const user = await User.findById(req.user._id).select('+password');

      if (!(await user.comparePasswords(oldPassword, user.password))) {
        throw new AppError('Old password is incorrect');
      }

      hashPassword = await bcrypt.hash(newPassword, 12);
    }
  }

  const updatedObj = filterObject({ name: name, password: hashPassword }, [
    'password',
    'name',
  ]);

  const updatedUser = await User.findByIdAndUpdate(req.user._id, updatedObj, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    status: 'success',
    data: { user: updatedUser },
  });
});

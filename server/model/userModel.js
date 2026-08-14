const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const EMAIL_REGEX = /^[\w-.]+@([\w-]+\.)+[\w-]{2,}$/;

const BCRYPT_COST = 12;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required.'],
      trim: true,
      maxLength: [80, 'Name cannot be longer than 80 characters.'],
    },
    email: {
      type: String,
      required: [true, 'Email is required.'],
      unique: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: (val) => EMAIL_REGEX.test(val),
        message: 'Please enter a valid email address.',
      },
    },
    password: {
      type: String,
      required: [true, 'Password is required.'],
      minLength: [8, 'Password must be at least 8 characters long.'],
      select: false,
    },
    confirmPassword: {
      type: String,
      // Required on registration only. It is never persisted (cleared in the
      // pre-save hook), so demanding it on later saves — e.g. a password
      // change via `user.save()` — would make every update fail validation.
      required: [
        function () {
          return this.isNew;
        },
        'Please confirm your password.',
      ],
      select: false,
      validate: {
        // Only runs on create/save — `this` is undefined on findOneAndUpdate,
        // which is why password changes go through `user.save()` (see
        // userController.updateUser) rather than a raw update.
        validator: function (val) {
          return this.password === val;
        },
        message: 'Passwords do not match.',
      },
    },
  },
  {
    timestamps: true,
    toJSON: {
      // Defence in depth: even if a caller forgets to project, serialising a
      // user can never emit credential material.
      transform: (_doc, ret) => {
        delete ret.password;
        delete ret.confirmPassword;
        delete ret.__v;
        return ret;
      },
    },
  }
);

userSchema.pre('save', async function (next) {
  // Re-hashing an already-hashed password on every save (e.g. a name change)
  // would silently invalidate the user's credentials.
  if (!this.isModified('password')) return next();

  this.password = await bcrypt.hash(this.password, BCRYPT_COST);
  // The confirmation is a transport-level check only; never persist it.
  this.confirmPassword = undefined;
  next();
});

userSchema.methods.comparePasswords = async function (userProvided, hashStored) {
  return bcrypt.compare(userProvided, hashStored);
};

/** The only user shape that may ever cross the API boundary. */
userSchema.methods.toPublicJSON = function () {
  return {
    _id: this._id,
    name: this.name,
    email: this.email,
  };
};

const User = mongoose.model('User', userSchema);

module.exports = User;
module.exports.userSchema = userSchema;
module.exports.EMAIL_REGEX = EMAIL_REGEX;

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    validate: {
      validator: function (val) {
        return /^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(val);
      },
      message: (props) => `${props.value} is not a valid email!`,
    },
  },
  password: {
    type: String,
    required: true,
    minLength: 6,
    select: false,
  },
  confirmPassword: {
    type: String,
    required: true,
    validate: {
      validator: function (val) {
        return this.password === val;
      },
      message: 'Passwords do no match',
    },
  },
});

userSchema.pre('save', async function () {
  this.password = await bcrypt.hash(this.password, 12);
  this.confirmPassword = undefined;
});

userSchema.methods.comparePasswords = async function (
  userProvided,
  hashStored
) {
  return await bcrypt.compare(userProvided, hashStored);
};

const User = mongoose.model('User', userSchema);
module.exports = User;

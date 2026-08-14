const mongoose = require('mongoose');

const { EMAIL_REGEX } = require('../middleware/validate');

const assigneeSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required.'],
      trim: true,
      lowercase: true,
      validate: {
        validator: (val) => EMAIL_REGEX.test(val),
        message: 'Please enter a valid email address.',
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
  },
  { timestamps: true }
);

// Board members are per-owner: the same email may appear on many boards, but
// only once on any given board. A unique compound index enforces that in the
// database, so two concurrent requests cannot both pass a "does it exist?"
// check and insert a duplicate. It also serves the `find({ createdBy })` that
// loads the assignee dropdown.
assigneeSchema.index({ createdBy: 1, email: 1 }, { unique: true });

const Assignee = mongoose.model('Assignee', assigneeSchema);

module.exports = Assignee;

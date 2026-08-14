const mongoose = require('mongoose');

const User = require('./userModel');
const {
  TASK_STATUSES,
  TASK_PRIORITIES,
  MAX_TITLE_LENGTH,
} = require('../constants');

const checkListSchema = new mongoose.Schema({
  checked: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: '',
    trim: true,
    maxLength: MAX_TITLE_LENGTH,
  },
});

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required.'],
      trim: true,
      maxLength: [MAX_TITLE_LENGTH, `Title cannot exceed ${MAX_TITLE_LENGTH} characters.`],
    },
    priority: {
      type: String,
      enum: {
        values: TASK_PRIORITIES,
        message: 'Priority must be high, moderate or low.',
      },
      required: [true, 'Priority is required.'],
    },

    // --- Assignment -------------------------------------------------------
    // `assignee` is the authoritative, user-facing value: an email address the
    // owner picked from their board members. Those members are not necessarily
    // registered users, so the email — not a User ref — has to be the input.
    //
    // `assignedTo` is *derived*: it is set only when that email belongs to a
    // registered account, and it is what makes the task visible on the other
    // person's board.
    //
    // The old schema also stored a third field, `shared`, which had to be kept
    // in sync by hand and drifted (updateTask computed it but never persisted
    // it). It is now a virtual derived from `assignedTo`, so the three values
    // can no longer disagree.
    assignee: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    checklists: {
      type: [checkListSchema],
      required: true,
      validate: {
        validator: (val) => Array.isArray(val) && val.length > 0,
        message: 'Please add at least one checklist item.',
      },
    },
    status: {
      type: String,
      enum: {
        values: TASK_STATUSES,
        message: 'Unknown task status.',
      },
      default: 'todo',
    },
    dueDate: {
      type: Date,
      default: null,
    },
    // Server-generated only. `createdAt` used to be accepted from the request
    // body, which let a client back-date a task and move it in or out of the
    // board's date filter at will.
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// --- Indexes ---------------------------------------------------------------
// Every board read is "tasks I own OR tasks assigned to me", which Mongo
// executes as two index lookups unioned by $or — so both sides need an index.
// `createdAt: -1` is part of each key because the board sorts newest-first and
// filters completed work by date; a compound index lets one scan satisfy the
// match and the sort together.
taskSchema.index({ createdBy: 1, createdAt: -1 });
taskSchema.index({ assignedTo: 1, createdAt: -1 });

// Analytics groups by status and by priority within a single owner, and the
// board's "Done" column filters by status. Ordering the key owner-first keeps
// each user's documents contiguous.
taskSchema.index({ createdBy: 1, status: 1 });

/** True when the task is visible to somebody other than its creator. */
taskSchema.virtual('shared').get(function () {
  return Boolean(this.assignedTo);
});

taskSchema.virtual('isExpired').get(function () {
  if (!this.dueDate) return false;
  // A finished task is never "overdue" — it was delivered, late or not.
  if (this.status === 'done') return false;
  return new Date() > this.dueDate;
});

/**
 * Keep the derived assignment fields consistent with `assignee`.
 * Runs on every save, so create and update share one code path.
 */
taskSchema.pre('save', async function (next) {
  if (this.isModified('assignee')) {
    if (this.assignee) {
      const user = await User.findOne({ email: this.assignee }).select('_id');
      // Unregistered board members are allowed: the email is kept for display,
      // but there is no account to share the task with.
      this.assignedTo = user ? user._id : null;
    } else {
      this.assignedTo = null;
    }
  }

  // Stamp completion the moment a task first reaches "done", and clear it if
  // the task is reopened. Analytics reads this instead of recomputing.
  if (this.isModified('status')) {
    if (this.status === 'done' && !this.completedAt) {
      this.completedAt = new Date();
    } else if (this.status !== 'done') {
      this.completedAt = null;
    }
  }

  next();
});

const Task = mongoose.model('Task', taskSchema);

module.exports = Task;

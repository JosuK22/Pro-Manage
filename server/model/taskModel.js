const mongoose = require('mongoose');
const { userSchema } = require('./userModel');

const checkListSchema = new mongoose.Schema({
  checked: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: '',
  },
});

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    priority: {
      type: String,
      enum: ['high', 'moderate', 'low'],
      required: true,
    },
    assignee: {
      type: String,
      default: null,
    },
    shared: {
      type: Boolean,
      default: false,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    checklists: {
      type: [checkListSchema],
      required: true,
      validate: {
        validator: function (val) {
          return val.length > 0;
        },
        message: 'Please add at least one checklist',
      },
    },
    status: {
      type: String,
      enum: ['backlog', 'inProgress', 'todo', 'done'],
      default: 'todo',
    },
    dueDate: {
      type: Date,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

taskSchema.virtual('isExpired').get(function () {
  if (!this.dueDate) {
    return false;
  }
  return new Date() > this.dueDate;
});

taskSchema.pre('save', async function (next) {
  if (this.isModified('assignee')) {
    if (this.assignee) {
      const user = await mongoose.model('User', userSchema).findOne({
        email: this.assignee,
      });
      if (user) {
        this.shared = true;
        this.assignedTo = user._id; 
      } else {
        this.shared = false;
        
      }
    } else {
      this.shared = false;
      this.assignedTo = null; 
    }
  }
  next();
});

const Task = mongoose.model('Task', taskSchema);
module.exports = Task;

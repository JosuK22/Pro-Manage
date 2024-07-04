const Task = require('../model/taskModel');
const User = require('../model/userModel');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const moment = require('moment');

exports.getTasks = catchAsync(async (req, res, next) => {
  const query = req.query;
  let dbQuery = Task.find({
    $or: [
      { createdBy: req.user._id },
      { assignedTo: req.user._id }, 
    ],
  });

  const today = moment.utc().endOf('day');
  let range = 7;

  if (query.range) {
    range = query.range;
  }

  dbQuery = dbQuery.find({
    createdAt: {
      $lte: today.toDate(),
      $gt: today.clone().subtract(range, 'days').toDate(),
    },
  });

  const tasks = await dbQuery;

  res.status(200).json({
    status: 'success',
    results: tasks.length,
    data: { tasks },
  });
});

exports.getTask = catchAsync(async (req, res, next) => {
  const { taskId } = req.params;
  const task = await Task.findOne({
    _id: taskId,
  });

  if (!task) {
    throw new AppError('Task not found', 404);
  }

  res.status(200).json({
    status: 'success',
    data: { task },
  });
});

exports.createTask = catchAsync(async (req, res, next) => {
  const { title, priority, checklists, dueDate, assignee, createdAt, status } = req.body;

  const newTask = await Task.create({
    title,
    status,
    priority,
    checklists,
    dueDate,
    assignee,
    createdAt,
    createdBy: req.user._id,
  });

  res.status(201).json({
    status: 'success',
    data: { task: newTask },
  });
});

exports.updateTask = catchAsync(async (req, res, next) => {
  const { taskId } = req.params;
  const { title, priority, checklists, assignee, dueDate, status } = req.body;

  let shared = false;
  let assignedTo = null;
  if (assignee) {
    const user = await User.findOne({ email: assignee });
    if (user) {
      shared = true;
      assignedTo = user._id;
    }
  }
  // if (assignee) {
  //   const user = await User.findOne({ email: assignee });
  //   if (user) {
  //     assignedTo = user._id; 
  //   }
  // }


  const updatedTask = await Task.findOneAndUpdate(
    { _id: taskId, $or: [{ createdBy: req.user._id }, { assignedTo: req.user._id }] },
    {
    title,
    status,
    priority,
    checklists,
    dueDate,
    assignee,
    assignedTo, 
    },
    { new: true, runValidators: true }
  );

  if (!updatedTask) {
    throw new AppError('Task not found', 404);
  }

  res.status(200).json({
    status: 'success',
    data: { task: updatedTask },
  });
});

exports.deleteTask = catchAsync(async (req, res, next) => {
  const { taskId } = req.params;

  if (!taskId) {
    throw new AppError('Please provide a taskId', 400);
  }

  const deletedTask = await Task.findOneAndDelete({
    _id: taskId,
    $or: [{ createdBy: req.user._id }, { assignedTo: req.user._id }],
  });

  if (!deletedTask) {
    throw new AppError('Task not found', 404);
  }

  res.status(204).json({
    status: 'success',
  });
});

exports.analytics = catchAsync(async (req, res, next) => {
  const tasksCreated = await Task.find({ createdBy: req.user._id });
  const tasksAssigned = await Task.find({ assignedTo: req.user._id });

  const status = {
    backlog: 0,
    todo: 0,
    inProgress: 0,
    done: 0,
  };

  const priorities = {
    low: 0,
    high: 0,
    moderate: 0,
    due: 0,
  };

  tasksCreated.forEach((task) => {
    status[task.status]++;
    priorities[task.priority]++;
    if (task.isExpired) {
      priorities.due++;
    }
  });

  tasksAssigned.forEach((task) => {
    status[task.status]++;
    priorities[task.priority]++;
    if (task.isExpired) {
      priorities.due++;
    }
  });

  res.status(200).json({
    status: 'success',
    data: { status, priorities },
  });
});


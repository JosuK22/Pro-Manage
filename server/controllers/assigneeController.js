const Assignee = require('../model/assigneeModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');


exports.getAssignees = catchAsync(async (req, res, next) => {
  const assignees = await Assignee.find({ createdBy: req.user._id });

  res.status(200).json({
    status: 'success',
    results: assignees.length,
    data: assignees,
  });
});


exports.createAssignee = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  const createdBy = req.user._id;

  const existingAssignee = await Assignee.findOne({ email });

  if (existingAssignee) {
    
    const assigneeForUser = await Assignee.findOne({ email, createdBy });

    if (assigneeForUser) {
      throw new AppError('* This member is already in the board', 400);
    }
  }

  
  const newAssignee = new Assignee({ email, createdBy });
  const savedAssignee = await newAssignee.save();

  res.status(201).json({
    status: 'success',
    data: savedAssignee,
  });
});


exports.getAssignee = catchAsync(async (req, res, next) => {
  const { assigneeId } = req.params;
  const assignee = await Assignee.findOne({ _id: assigneeId, createdBy: req.user._id });

  if (!assignee) {
    throw new AppError('Assignee not found', 404);
  }

  res.status(200).json({
    status: 'success',
    data: assignee,
  });
});


exports.updateAssignee = catchAsync(async (req, res, next) => {
  const { assigneeId } = req.params;
  const { email } = req.body;

  const existingAssignee = await Assignee.findOne({ email, createdBy: req.user._id });
  if (existingAssignee) {
    throw new AppError('* You have already added this assignee', 400);
  }

  
  const updatedAssignee = await Assignee.findOneAndUpdate(
    { _id: assigneeId, createdBy: req.user._id },
    { email },
    { new: true, runValidators: true }
  );

  if (!updatedAssignee) {
    throw new AppError('Assignee not found', 404);
  }

  res.status(200).json({
    status: 'success',
    data: updatedAssignee,
  });
});


exports.deleteAssignee = catchAsync(async (req, res, next) => {
  const { assigneeId } = req.params;

  const deletedAssignee = await Assignee.findOneAndDelete({
    _id: assigneeId,
    createdBy: req.user._id,
  });

  if (!deletedAssignee) {
    throw new AppError('Assignee not found', 404);
  }

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

const Assignee = require('../model/assigneeModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

exports.getAssignees = catchAsync(async (req, res, next) => {
  const assignees = await Assignee.find({ createdBy: req.user._id }).sort({ email: 1 });

  res.status(200).json({
    status: 'success',
    results: assignees.length,
    data: { assignees },
  });
});

exports.createAssignee = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  // The old implementation first looked the email up globally, which meant an
  // email already used on *someone else's* board took a pointless extra query.
  // Uniqueness is now enforced by a compound index, so a duplicate surfaces as
  // a 409 from the global error handler rather than a check that two
  // concurrent requests could both pass.
  const existing = await Assignee.findOne({ email, createdBy: req.user._id });

  if (existing) {
    throw new AppError('This member is already on your board.', 409);
  }

  const assignee = await Assignee.create({ email, createdBy: req.user._id });

  res.status(201).json({
    status: 'success',
    data: { assignee },
  });
});

exports.getAssignee = catchAsync(async (req, res, next) => {
  const assignee = await Assignee.findOne({
    _id: req.params.assigneeId,
    createdBy: req.user._id,
  });

  if (!assignee) {
    throw new AppError('Assignee not found', 404);
  }

  res.status(200).json({
    status: 'success',
    data: { assignee },
  });
});

exports.updateAssignee = catchAsync(async (req, res, next) => {
  const { assigneeId } = req.params;
  const { email } = req.body;

  const updatedAssignee = await Assignee.findOneAndUpdate(
    { _id: assigneeId, createdBy: req.user._id },
    // Explicit single field — `createdBy` is immutable and the body is never
    // spread into the update.
    { email },
    { new: true, runValidators: true }
  );

  if (!updatedAssignee) {
    throw new AppError('Assignee not found', 404);
  }

  res.status(200).json({
    status: 'success',
    data: { assignee: updatedAssignee },
  });
});

exports.deleteAssignee = catchAsync(async (req, res, next) => {
  const deletedAssignee = await Assignee.findOneAndDelete({
    _id: req.params.assigneeId,
    createdBy: req.user._id,
  });

  if (!deletedAssignee) {
    throw new AppError('Assignee not found', 404);
  }

  res.status(204).send();
});

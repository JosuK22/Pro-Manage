const mongoose = require('mongoose');

const Task = require('../model/taskModel');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const {
  RANGE_TO_DAYS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} = require('../constants');

/** Tasks the requesting user may see: their own, plus ones assigned to them. */
const visibleToUser = (userId) => ({
  $or: [{ createdBy: userId }, { assignedTo: userId }],
});

/**
 * Start of the window for a named range, or null for "all".
 * Computed from "now" in UTC so the boundary does not depend on server locale.
 */
const rangeStart = (range) => {
  const days = RANGE_TO_DAYS[range];
  if (!days) return null;

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
};

exports.getTasks = catchAsync(async (req, res, next) => {
  const { range = 'week', status, priority } = req.query;

  const filter = { ...visibleToUser(req.user._id) };

  if (status) filter.status = status;
  if (priority) filter.priority = priority;

  const since = rangeStart(range);

  if (since) {
    /**
     * The date filter narrows *completed* work only.
     *
     * The old behaviour filtered every task by `createdAt`, so switching the
     * board to "Today" made last week's unfinished tasks vanish — they looked
     * deleted. Unfinished work is, by definition, still outstanding no matter
     * when it was created, so it always stays on the board; only the Done
     * column respects the range.
     */
    filter.$and = [
      {
        $or: [
          { status: { $ne: 'done' } },
          { completedAt: { $gte: since } },
          // Tasks completed before `completedAt` existed have no stamp; fall
          // back to creation date so historic data still filters sensibly.
          { completedAt: null, createdAt: { $gte: since } },
        ],
      },
    ];
  }

  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE
  );
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  const [tasks, total] = await Promise.all([
    Task.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Task.countDocuments(filter),
  ]);

  res.status(200).json({
    status: 'success',
    results: tasks.length,
    data: {
      tasks,
      pagination: {
        page,
        limit,
        total,
        hasMore: page * limit < total,
      },
    },
  });
});

/**
 * Public, unauthenticated read of a single task (the "share link" target).
 *
 * This is the only endpoint reachable without a token, so it returns an
 * explicit projection rather than the raw document: `createdBy`, `assignedTo`
 * and internal flags must not be exposed to anyone holding a share URL.
 */
exports.getTask = catchAsync(async (req, res, next) => {
  const { taskId } = req.params;

  const task = await Task.findById(taskId);

  if (!task) {
    throw new AppError('Task not found', 404);
  }

  res.status(200).json({
    status: 'success',
    data: {
      task: {
        _id: task._id,
        title: task.title,
        priority: task.priority,
        status: task.status,
        // `null` — never an empty string — so the client has one unambiguous
        // "unassigned" case to render.
        assignee: task.assignee || null,
        checklists: task.checklists.map((list) => ({
          _id: list._id,
          title: list.title,
          checked: list.checked,
        })),
        dueDate: task.dueDate || null,
        isExpired: task.isExpired,
        createdAt: task.createdAt,
      },
    },
  });
});

exports.createTask = catchAsync(async (req, res, next) => {
  // `req.validated` is produced by an allowlist in middleware/validate.js.
  // The raw body is never used here, so a client cannot set `createdBy`,
  // `assignedTo`, `shared`, `_id`, or a back-dated `createdAt`.
  const newTask = await Task.create({
    ...req.validated,
    // Ownership is always taken from the authenticated session, never the body.
    createdBy: req.user._id,
  });

  res.status(201).json({
    status: 'success',
    data: { task: newTask },
  });
});

exports.updateTask = catchAsync(async (req, res, next) => {
  const { taskId } = req.params;

  // Load-then-save (rather than findOneAndUpdate) so the schema's pre-save
  // hook runs and keeps `assignedTo`/`completedAt` consistent with the new
  // values in one place. The ownership filter is part of the query, so a user
  // can never reach a task that is not theirs.
  const task = await Task.findOne({
    _id: taskId,
    ...visibleToUser(req.user._id),
  });

  if (!task) {
    // 404 rather than 403: confirming that someone else's task exists is
    // itself an information leak.
    throw new AppError('Task not found', 404);
  }

  // Only allowlisted, already-validated fields are assigned. Anything else in
  // the body (createdBy, shared, assignedTo, _id) is ignored outright.
  Object.entries(req.validated).forEach(([key, value]) => {
    task[key] = value;
  });

  await task.save();

  res.status(200).json({
    status: 'success',
    data: { task },
  });
});

exports.deleteTask = catchAsync(async (req, res, next) => {
  const { taskId } = req.params;

  const deletedTask = await Task.findOneAndDelete({
    _id: taskId,
    ...visibleToUser(req.user._id),
  });

  if (!deletedTask) {
    throw new AppError('Task not found', 404);
  }

  res.status(204).send();
});

/**
 * Board analytics.
 *
 * Previously this loaded every task the user could see into Node — twice, via
 * two separate `find()` calls — and counted them in JavaScript. That meant:
 *   - unbounded memory use as the collection grows,
 *   - a self-assigned task counted twice (it matches both queries), and
 *   - "due" counted completed-but-late tasks as still overdue.
 *
 * One aggregation with `$facet` now does all the counting in the database, over
 * a single de-duplicated match, and returns a stable shape whether or not the
 * user has any tasks.
 */
exports.analytics = catchAsync(async (req, res, next) => {
  const userId = new mongoose.Types.ObjectId(req.user._id);

  const [result] = await Task.aggregate([
    // A single $or match — a task the user created *and* is assigned to
    // appears exactly once, which is what fixed the double counting.
    { $match: { $or: [{ createdBy: userId }, { assignedTo: userId }] } },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        byPriority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }],
        overdue: [
          {
            $match: {
              dueDate: { $ne: null, $lt: new Date() },
              // A finished task is not overdue, however late it was.
              status: { $ne: 'done' },
            },
          },
          { $count: 'count' },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ]);

  const toMap = (rows) =>
    rows.reduce((acc, row) => {
      acc[row._id] = row.count;
      return acc;
    }, {});

  const statusCounts = toMap(result.byStatus);
  const priorityCounts = toMap(result.byPriority);

  // Always emit every key, so the client never has to guard for `undefined`
  // and a zero renders as "0" rather than disappearing.
  res.status(200).json({
    status: 'success',
    data: {
      status: {
        backlog: statusCounts.backlog || 0,
        todo: statusCounts.todo || 0,
        inProgress: statusCounts.inProgress || 0,
        done: statusCounts.done || 0,
      },
      priorities: {
        low: priorityCounts.low || 0,
        moderate: priorityCounts.moderate || 0,
        high: priorityCounts.high || 0,
        due: result.overdue[0]?.count || 0,
      },
      total: result.total[0]?.count || 0,
    },
  });
});

const express = require('express');

const {
  createTask,
  deleteTask,
  updateTask,
  getTasks,
  getTask,
  analytics,
} = require('../controllers/taskController');
const { protect } = require('../controllers/authController');
const {
  validateObjectIdParam,
  validateTaskCreate,
  validateTaskUpdate,
  validateTaskQuery,
} = require('../middleware/validate');

const router = express.Router();

// `/analytics` is declared before `/:taskId` so it is not swallowed by the
// parameterised route and treated as a task id.
router.get('/analytics', protect, analytics);

router.get('/', protect, validateTaskQuery, getTasks);
router.post('/', protect, validateTaskCreate, createTask);

// Public share link — intentionally unauthenticated, and served by a
// controller that returns an explicit public projection.
router.get('/:taskId', validateObjectIdParam('taskId'), getTask);

router.patch(
  '/:taskId',
  protect,
  validateObjectIdParam('taskId'),
  validateTaskUpdate,
  updateTask
);
router.delete('/:taskId', protect, validateObjectIdParam('taskId'), deleteTask);

module.exports = router;

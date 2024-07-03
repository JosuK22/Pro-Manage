const express = require('express');
const {createTask, deleteTask, updateTask, getTasks, getTask, analytics} = require('../controllers/taskController');
const { protect } = require('../controllers/authController');

const router = express.Router();

router.get('/', protect, getTasks);
router.post('/', protect, createTask);
router.get('/analytics', protect, analytics);
router.get('/:taskId', getTask);
router.patch('/:taskId', protect, updateTask);
router.delete('/:taskId', protect, deleteTask);

module.exports = router;

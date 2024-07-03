const express = require('express');
const { protect } = require('../controllers/authController');
const {
  getAssignees,
  createAssignee,
  getAssignee,
  updateAssignee,
  deleteAssignee,
} = require('../controllers/assigneeController');

const router = express.Router();
router.use(protect);

router.get('/', getAssignees);
router.post('/', validateEmail, createAssignee); 
router.get('/:assigneeId', getAssignee);
router.patch('/:assigneeId', updateAssignee);
router.delete('/:assigneeId', deleteAssignee);

function validateEmail(req, res, next) {
  const { email } = req.body;
  if (!isValidEmail(email)) {
    return res.status(400).json({
      status: 'error',
      message: '* Invalid email format',
    });
  }
  next();
}

function isValidEmail(email) {
  return /^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(email);
}
module.exports = router;

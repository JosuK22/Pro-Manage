const express = require('express');

const { protect } = require('../controllers/authController');
const {
  getAssignees,
  createAssignee,
  getAssignee,
  updateAssignee,
  deleteAssignee,
} = require('../controllers/assigneeController');
const { validateObjectIdParam, validateAssignee } = require('../middleware/validate');

const router = express.Router();

router.use(protect);

router.get('/', getAssignees);
router.post('/', validateAssignee, createAssignee);

router.get('/:assigneeId', validateObjectIdParam('assigneeId'), getAssignee);
router.patch(
  '/:assigneeId',
  validateObjectIdParam('assigneeId'),
  validateAssignee,
  updateAssignee
);
router.delete('/:assigneeId', validateObjectIdParam('assigneeId'), deleteAssignee);

module.exports = router;

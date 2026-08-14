const express = require('express');

const { updateUser, getUser } = require('../controllers/userController');
const { protect } = require('../controllers/authController');
const { validateUserUpdate } = require('../middleware/validate');

const router = express.Router();

router.use(protect);

router.get('/', getUser);
router.patch('/', validateUserUpdate, updateUser);

module.exports = router;

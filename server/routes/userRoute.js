const express = require('express');
const { updateUser, getUser } = require('../controllers/userController');
const { protect } = require('../controllers/authController');

const router = express.Router();

router.patch('/', protect, updateUser);
router.get('/', protect, getUser);

module.exports = router;

const express = require('express');

const { login, register } = require('../controllers/authController');
const { validateRegister } = require('../middleware/validate');

const router = express.Router();

router.post('/login', login);
router.post('/register', validateRegister, register);

module.exports = router;

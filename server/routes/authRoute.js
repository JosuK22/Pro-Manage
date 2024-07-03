const express = require('express');
const {login, register} = require('../controllers/authController');

const router = express.Router();

router.use((req, res, next) => {
    console.log("From authRoute");
    next();
  });
router.post('/login', login);
router.post('/register', register);
module.exports = router;

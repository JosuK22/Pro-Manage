const handleDuplicateError = (err, req, res) => {
  const field = Object.keys(err.keyPattern)[0];
  const errorObj = {};
  errorObj[field] = `${field} already exists!`;

  res.status(err.statusCode).json({
    status: err.status,
    error: err,
    errors: errorObj,
    message: 'Duplicate field value in database.',
  });
};

const handleValidationError = (err, res) => {
  const errorObj = {};
  const errArray = Object.keys(err.errors);

  errArray.forEach((el) => {
    errorObj[el] = err.errors[el].message;
  });

  res.status(err.statusCode).json({
    status: err.status,
    errors: errorObj,
    message: `Validation error: ${err.message}`,
  });
};

const sendProdError = (err, req, res) => {
  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  } else {
    res.status(500).json({
      status: 'error',
      message: 'Something went wrong',
    });
  }
};

module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = `${err.statusCode}`.startsWith('4') ? 'fail' : 'error';

  if (process.env.NODE_ENV.trim() === 'production') {
    let error = Object.create(
      Object.getPrototypeOf(err),
      Object.getOwnPropertyDescriptors(err)
    );

    if (error.code === 11000) {
      return handleDuplicateError(error, req, res);
    }

    if (error.name === 'ValidationError') {
      return handleValidationError(err, res);
    }

    if (error.name === 'CastError') {
      error = new AppError('Not found', 404);
    }

    if (error.name === 'TokenExpiredError') {
      error = new AppError(
        'Token is not valid, or has expired. Login to get the token.',
        401
      );
    }

    return sendProdError(error, req, res);
  }

  
  res.status(err.statusCode).json({
    status: err.status,
    message: err.message,
    err: err,
  });
};

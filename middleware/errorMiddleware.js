// middleware/errorMiddleware.js

const errorHandler = (err, req, res, next) => {
  let customError = {
    statusCode: err.statusCode || 500,
    message: err.message || "Internal Server Error",
  };

  // Mongoose Bad ObjectId
  if (err.name === "CastError") {
    customError.message = `Resource not found with id of ${err.value}`;
    customError.statusCode = 404;
  }

  // Mongoose Duplicate Key (e.g., registering with an existing email)
  if (err.code === 11000) {
    customError.message = `Duplicate field value entered: ${Object.keys(err.keyValue)} already exists.`;
    customError.statusCode = 400;
  }

  // Mongoose Validation Error
  if (err.name === "ValidationError") {
    customError.message = Object.values(err.errors)
      .map((val) => val.message)
      .join(", ");
    customError.statusCode = 400;
  }

  // JWT Errors
  if (err.name === "JsonWebTokenError") {
    customError.message = "Invalid token. Please log in again.";
    customError.statusCode = 401;
  }

  if (err.name === "TokenExpiredError") {
    customError.message = "Your token has expired. Please log in again.";
    customError.statusCode = 401;
  }

  // Log the full error stack in development for debugging, hide it in production
  if (process.env.NODE_ENV !== "production") {
    console.error("🚨 [Global Error]:", err);
  } else if (customError.statusCode === 500) {
    // In production, only log critical 500 server crashes to your console/logs
    console.error("💥 [CRITICAL SERVER CRASH]:", err.message);
    customError.message = "Something went wrong on our end. Our team has been notified.";
  }

  res.status(customError.statusCode).json({
    success: false,
    error: customError.message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
};

module.exports = errorHandler;
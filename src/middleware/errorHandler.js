'use strict';

const logger = require('../utils/logger');

// =============================================================================
// Global Error Handler
// =============================================================================
// Express calls this when any route handler calls next(err) or throws.
// Must have exactly 4 parameters (err, req, res, next) for Express to
// recognize it as an error handler.
//
// Usage in route handlers:
//   try {
//     ...
//   } catch (err) {
//     next(err);   // passes error here
//   }
// =============================================================================

const errorHandler = (err, req, res, next) => {
  // Log the full error server-side
  logger.error(`${req.method} ${req.originalUrl} — ${err.message}`, {
    stack: err.stack,
    status: err.status || 500,
  });

  // Send a clean response to the client
  // Never expose stack traces in production
  return res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : err.message,
  });
};

// =============================================================================
// Not Found Handler
// =============================================================================
// Catches any request that didn't match a route.
// Register this AFTER all routes in server.js.
// =============================================================================

const notFound = (req, res) => {
  return res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
};

module.exports = { errorHandler, notFound };
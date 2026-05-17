'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const logger = require('./utils/logger');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;

// =============================================================================
// Security Middleware
// =============================================================================
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));

// =============================================================================
// Body Parsing
// =============================================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// =============================================================================
// Request Logging (dev only)
// =============================================================================
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.originalUrl}`);
    next();
  });
}

// =============================================================================
// Health Check
// =============================================================================
// Simple endpoint to confirm the server is alive.
// Hit http://localhost:5000/health to test.
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

// =============================================================================
// Routes
// =============================================================================
app.use('/api/v1/auth',     require('./routes/auth.routes'));
app.use('/api/v1/accounts', require('./routes/account.routes'));
app.use('/api/v1/import',    require('./routes/import.routes'));
app.use('/api/v1/prices', require('./routes/price.routes'));
app.use('/api/v1/positions', require('./routes/position.routes'));
app.use('/api/v1/dashboard', require('./routes/dashboard.routes'));

// Start the nightly price refresh cron
const { startScheduler } = require('./services/scheduler');
startScheduler();

// =============================================================================
// Error Handling
// =============================================================================
// notFound must come AFTER all routes
// errorHandler must come LAST
app.use(notFound);
app.use(errorHandler);

// =============================================================================
// Start Server
// =============================================================================
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
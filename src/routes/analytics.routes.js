'use strict';

const express = require('express');
const { body, query } = require('express-validator');
const router = express.Router();

const analyticsController = require('../controllers/analytics.controller');
const { requireAuth } = require('../middleware/auth');

// =============================================================================
// Analytics Routes — /api/v1/analytics
// =============================================================================

// GET /api/v1/analytics/history?days=365
router.get('/history',
  requireAuth,
  [
    query('days')
      .optional()
      .isInt({ min: 1, max: 730 })
      .withMessage('days must be between 1 and 730'),
  ],
  analyticsController.getHistory
);

// POST /api/v1/analytics/backfill
// Body: { lookbackDays: 30 | 90 | 180 | 365 | 730 }
router.post('/backfill',
  requireAuth,
  [
    body('lookbackDays')
      .isIn([30, 90, 180, 365, 730])
      .withMessage('lookbackDays must be one of: 30, 90, 180, 365, 730'),
  ],
  analyticsController.runBackfill
);

module.exports = router;

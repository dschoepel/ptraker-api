'use strict';

const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const { requireAuth } = require('../middleware/auth');

// =============================================================================
// Dashboard Routes — /api/v1/dashboard
// =============================================================================

// GET /api/v1/dashboard
router.get('/', requireAuth, dashboardController.getDashboard);

module.exports = router;
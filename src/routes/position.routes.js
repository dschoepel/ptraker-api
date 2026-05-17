'use strict';

const express = require('express');
const router = express.Router();
const positionController = require('../controllers/position.controller');
const { requireAuth } = require('../middleware/auth');

// =============================================================================
// Position Routes — /api/v1/positions
// =============================================================================

// GET /api/v1/positions
// GET /api/v1/positions?accountId=uuid
// GET /api/v1/positions?ticker=AAPL
router.get('/', requireAuth, positionController.getAll);

// GET /api/v1/positions/:id
router.get('/:id', requireAuth, positionController.getOne);

// DELETE /api/v1/positions/:id
router.delete('/:id', requireAuth, positionController.remove);

module.exports = router;
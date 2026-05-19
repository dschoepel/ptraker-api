'use strict';

const express = require('express');
const router  = express.Router();
const sharesController = require('../controllers/shares.controller');
const { requireAuth }   = require('../middleware/auth');

router.use(requireAuth);

// GET  /api/v1/shares
router.get('/', sharesController.getShares);

// POST /api/v1/shares
router.post('/', sharesController.createShare);

// DELETE /api/v1/shares/:id
router.delete('/:id', sharesController.deleteShare);

// GET /api/v1/shares/:ownerId/dashboard
router.get('/:ownerId/dashboard', sharesController.getSharedDashboard);

module.exports = router;

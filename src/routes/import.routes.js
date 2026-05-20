'use strict';

const express = require('express');
const router  = express.Router();

const importController = require('../controllers/import.controller');
const { requireAuth }  = require('../middleware/auth');

// GET /api/v1/import/importers
router.get('/importers', requireAuth, importController.getImporters);

// GET /api/v1/import/history
router.get('/history', requireAuth, importController.getHistory);

// POST /api/v1/import/upload — multer is handled inside the controller array
router.post('/upload', requireAuth, ...importController.uploadFile);

// POST /api/v1/import/manual — manual balance/position entry
router.post('/manual', requireAuth, importController.importManual);

module.exports = router;
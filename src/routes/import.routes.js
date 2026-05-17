'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();

const importController = require('../controllers/import.controller');
const { requireAuth } = require('../middleware/auth');

// =============================================================================
// Multer configuration for CSV/QFX file uploads
// =============================================================================
// storage: memoryStorage() keeps the file in memory as a Buffer
// This means req.file.buffer contains the raw file bytes
// We don't write files to disk — parse them in memory and discard
// =============================================================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,   // 10MB max
  },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'text/csv',
      'application/vnd.ms-excel',
      'text/plain',
      'application/x-ofx',
      'application/ofx',
    ];
    // Also allow by extension for browsers that send wrong MIME types
    const ext = file.originalname.split('.').pop().toLowerCase();
    const allowedExts = ['csv', 'qfx', 'ofx'];

    if (allowed.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed. Accepted: ${allowedExts.join(', ')}`));
    }
  },
});

// =============================================================================
// Import Routes — /api/v1/import
// =============================================================================

// GET /api/v1/import/importers
// List all available import plugins
router.get('/importers',
  requireAuth,
  importController.getImporters
);

// GET /api/v1/import/history
// Get import history for the logged-in user
router.get('/history',
  requireAuth,
  importController.getHistory
);

// POST /api/v1/import/upload
// Upload and parse a CSV/QFX file
// Form fields: file (required), importerId (required), accountId (optional)
router.post('/upload',
  requireAuth,
  upload.single('file'),
  importController.uploadAndImport
);

module.exports = router;
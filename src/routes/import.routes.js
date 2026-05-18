'use strict';

const express = require('express');
const multer  = require('multer');
const router  = express.Router();

const importController = require('../controllers/import.controller');
const { requireAuth }  = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.split('.').pop().toLowerCase();
    const allowedExts = ['csv', 'qfx', 'ofx'];
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed. Accepted: ${allowedExts.join(', ')}`));
    }
  },
});

// GET /api/v1/import/importers
router.get('/importers', requireAuth, importController.getImporters);

// GET /api/v1/import/history
router.get('/history', requireAuth, importController.getHistory);

// POST /api/v1/import/upload — file upload
router.post('/upload', requireAuth, upload.single('file'), importController.uploadAndImport);

// POST /api/v1/import/manual — manual balance entry (no file)
router.post('/manual', requireAuth, importController.manualImport);

module.exports = router;

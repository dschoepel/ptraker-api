'use strict';

const express = require('express');
const router  = express.Router();
const userController = require('../controllers/user.controller');
const { requireAuth }  = require('../middleware/auth');

router.use(requireAuth);

// POST /api/v1/user/request-upgrade
router.post('/request-upgrade', userController.requestUpgrade);

// GET /api/v1/user/upgrade-request
router.get('/upgrade-request', userController.getUpgradeRequest);

// DELETE /api/v1/user/account
router.delete('/account', userController.deleteOwnAccount);

// GET /api/v1/user/export
router.get('/export', userController.exportData);

// GET /api/v1/user/importer-preferences
router.get('/importer-preferences', userController.getImporterPreferences);

// PATCH /api/v1/user/importer-preferences
router.patch('/importer-preferences', userController.updateImporterPreferences);

// POST /api/v1/user/purge-import-history
router.post('/purge-import-history', userController.purgeImportHistory);

module.exports = router;

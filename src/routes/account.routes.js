'use strict';

const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const accountController = require('../controllers/account.controller');
const { requireAuth } = require('../middleware/auth');

// =============================================================================
// Account Routes — /api/v1/accounts
// All routes require authentication
// =============================================================================

// Valid values matching the DB check constraint
const VALID_TYPES = ['brokerage', 'retirement', 'checking', 'savings', 'other'];
const VALID_INSTITUTIONS = ['lpl', 'merrill', 'chase', 'bank', 'manual', 'other'];

// GET /api/v1/accounts
router.get('/',
  requireAuth,
  accountController.getAll
);

// GET /api/v1/accounts/:id
router.get('/:id',
  requireAuth,
  accountController.getOne
);

// POST /api/v1/accounts
router.post('/',
  requireAuth,
  [
    body('name')
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Account name is required (max 100 characters)'),
    body('institution')
      .trim()
      .toLowerCase()
      .isLength({ min: 1 })
      .withMessage('Institution is required'),
    body('type')
      .isIn(VALID_TYPES)
      .withMessage(`Type must be one of: ${VALID_TYPES.join(', ')}`),
    body('accountNumberLast4')
      .optional()
      .matches(/^\d{4}$/)
      .withMessage('Account number must be exactly 4 digits'),
    body('notes')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Notes max 500 characters'),
  ],
  accountController.create
);

// PATCH /api/v1/accounts/:id
router.patch('/:id',
  requireAuth,
  [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Account name max 100 characters'),
    body('institution')
      .optional()
      .trim()
      .toLowerCase(),
    body('type')
      .optional()
      .isIn(VALID_TYPES)
      .withMessage(`Type must be one of: ${VALID_TYPES.join(', ')}`),
    body('accountNumberLast4')
      .optional()
      .matches(/^\d{4}$/)
      .withMessage('Account number must be exactly 4 digits'),
    body('notes')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Notes max 500 characters'),
    body('isActive')
      .optional()
      .isBoolean()
      .withMessage('isActive must be true or false'),
    body('includeInSnapshot')
      .optional()
      .isBoolean()
      .withMessage('includeInSnapshot must be true or false'),
  ],
  accountController.update
);

// DELETE /api/v1/accounts/:id
router.delete('/:id',
  requireAuth,
  accountController.remove
);

module.exports = router;
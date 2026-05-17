'use strict';

const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');

// =============================================================================
// Auth Routes — /api/v1/auth
// =============================================================================

// POST /api/v1/auth/login
router.post('/login',
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
  ],
  authController.login
);

// POST /api/v1/auth/logout
router.post('/logout',
  requireAuth,
  authController.logout
);

// POST /api/v1/auth/refresh
router.post('/refresh',
  authController.refresh
);

// GET /api/v1/auth/profile
router.get('/profile',
  requireAuth,
  authController.getProfile
);

// PATCH /api/v1/auth/profile
router.patch('/profile',
  requireAuth,
  [
    body('displayName')
      .optional()
      .isLength({ min: 1, max: 100 })
      .trim()
      .withMessage('Display name must be 1-100 characters'),
    body('avatarUrl')
      .optional()
      .isURL()
      .withMessage('Avatar URL must be a valid URL'),
  ],
  authController.updateProfile
);

// POST /api/v1/auth/forgot-password
router.post('/forgot-password',
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email required'),
  ],
  authController.forgotPassword
);

module.exports = router;
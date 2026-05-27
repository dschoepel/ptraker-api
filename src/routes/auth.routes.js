'use strict';

const express = require('express');
const multer  = require('multer');
const { body } = require('express-validator');
const router = express.Router();

const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only image files are allowed')),
});

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

// POST /api/v1/auth/profile/avatar
router.post('/profile/avatar', requireAuth, avatarUpload.single('avatar'), authController.uploadAvatar);

// DELETE /api/v1/auth/profile/avatar
router.delete('/profile/avatar', requireAuth, authController.removeAvatar);

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

// POST /api/v1/auth/reset-password
router.post('/reset-password',
  [
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
    body('accessToken')
      .notEmpty()
      .withMessage('Access token is required'),
  ],
  authController.resetPassword
);

module.exports = router;
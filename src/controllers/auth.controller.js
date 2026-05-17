'use strict';

const { getAnonClient, getAdminClient } = require('../lib/supabase');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

// =============================================================================
// Auth Controller
// =============================================================================
// Handles login, logout, and profile operations.
// Supabase handles the actual auth mechanics — these are thin wrappers.
// =============================================================================

// -----------------------------------------------------------------------------
// POST /api/v1/auth/login
// Body: { email, password }
// -----------------------------------------------------------------------------
const login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { email, password } = req.body;

    const supabase = getAnonClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Don't reveal whether email exists or password is wrong
      logger.debug('Login failed', { email, error: error.message });
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const { user, session } = data;

    // Fetch the user's profile (display name, role, avatar)
    const adminClient = getAdminClient();
    const { data: profile } = await adminClient
      .from('profiles')
      .select('display_name, role, avatar_url')
      .eq('id', user.id)
      .single();

    logger.info('User logged in', { userId: user.id, email: user.email });

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: profile?.display_name || '',
        role: profile?.role || 'user',
        avatarUrl: profile?.avatar_url || '',
      },
      session: {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresAt: session.expires_at,
      },
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// POST /api/v1/auth/logout
// Headers: Authorization: Bearer <token>
// -----------------------------------------------------------------------------
const logout = async (req, res, next) => {
  try {
    // req.user is set by requireAuth middleware
    logger.info('User logged out', { userId: req.user.id });

    // Supabase handles token invalidation server-side
    const supabase = getAnonClient();
    await supabase.auth.signOut();

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// POST /api/v1/auth/refresh
// Body: { refreshToken }
// -----------------------------------------------------------------------------
const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token required',
      });
    }

    const supabase = getAnonClient();
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token',
      });
    }

    return res.status(200).json({
      success: true,
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      },
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// GET /api/v1/auth/profile
// Headers: Authorization: Bearer <token>
// -----------------------------------------------------------------------------
const getProfile = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, display_name, role, avatar_url, created_at, updated_at')
      .eq('id', req.user.id)
      .single();

    if (error || !profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found',
      });
    }

    return res.status(200).json({
      success: true,
      profile: {
        id: profile.id,
        email: req.user.email,
        displayName: profile.display_name,
        role: profile.role,
        avatarUrl: profile.avatar_url,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at,
      },
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// PATCH /api/v1/auth/profile
// Headers: Authorization: Bearer <token>
// Body: { displayName?, avatarUrl? }
// -----------------------------------------------------------------------------
const updateProfile = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { displayName, avatarUrl } = req.body;

    // Build update object with only provided fields
    const updates = {};
    if (displayName !== undefined) updates.display_name = displayName;
    if (avatarUrl !== undefined) updates.avatar_url = avatarUrl;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update',
      });
    }

    const supabase = getAdminClient();
    const { data: profile, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', req.user.id)
      .select('id, display_name, role, avatar_url, updated_at')
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: 'Failed to update profile',
      });
    }

    logger.info('Profile updated', { userId: req.user.id });

    return res.status(200).json({
      success: true,
      profile: {
        id: profile.id,
        email: req.user.email,
        displayName: profile.display_name,
        role: profile.role,
        avatarUrl: profile.avatar_url,
        updatedAt: profile.updated_at,
      },
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// POST /api/v1/auth/forgot-password
// Body: { email }
// -----------------------------------------------------------------------------
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email required',
      });
    }

    const supabase = getAnonClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.CLIENT_URL}/reset-password`,
    });

    // Always return success — don't reveal whether email exists
    if (error) {
      logger.debug('Password reset error', { email, error: error.message });
    }

    return res.status(200).json({
      success: true,
      message: 'If that email exists, a reset link has been sent',
    });

  } catch (err) {
    next(err);
  }
};

module.exports = {
  login,
  logout,
  refresh,
  getProfile,
  updateProfile,
  forgotPassword,
};
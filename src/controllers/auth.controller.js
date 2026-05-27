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
      .select('id, display_name, role, avatar_url, discoverable, import_history_limit, created_at, updated_at')
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
        id:                 profile.id,
        email:              req.user.email,
        displayName:        profile.display_name,
        role:               profile.role,
        avatarUrl:          profile.avatar_url,
        discoverable:       profile.discoverable,
        importHistoryLimit: profile.import_history_limit,
        createdAt:          profile.created_at,
        updatedAt:          profile.updated_at,
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

    const { displayName, avatarUrl, discoverable, importHistoryLimit } = req.body;
    const supabase = getAdminClient();

    // Build update object with only provided fields
    const updates = {};
    if (displayName        !== undefined) updates.display_name          = displayName;
    if (avatarUrl          !== undefined) updates.avatar_url            = avatarUrl;
    if (discoverable       !== undefined) updates.discoverable          = discoverable;
    if (importHistoryLimit !== undefined) {
      updates.import_history_limit = importHistoryLimit === null
        ? null
        : parseInt(importHistoryLimit, 10);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', req.user.id)
      .select('id, display_name, role, avatar_url, discoverable, import_history_limit, updated_at')
      .single();

    if (error) return next(error);

    logger.info('Profile updated', { userId: req.user.id });

    return res.status(200).json({
      success: true,
      profile: {
        id:                 profile.id,
        email:              req.user.email,
        displayName:        profile.display_name,
        role:               profile.role,
        avatarUrl:          profile.avatar_url,
        discoverable:       profile.discoverable,
        importHistoryLimit: profile.import_history_limit,
        updatedAt:          profile.updated_at,
      },
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// POST /api/v1/auth/profile/avatar
// Headers: Authorization: Bearer <token>
// Body: multipart/form-data — field "avatar" (image file, max 2 MB)
// -----------------------------------------------------------------------------
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

const uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image provided' });
    const admin = getAdminClient();
    const ext   = MIME_EXT[req.file.mimetype] || 'jpg';
    const path  = `avatars/${req.user.id}/avatar.${ext}`;

    // Remove any previously stored avatar (may have a different extension)
    await admin.storage.from('profile-avatars').remove([
      `avatars/${req.user.id}/avatar.jpg`,
      `avatars/${req.user.id}/avatar.png`,
      `avatars/${req.user.id}/avatar.webp`,
      `avatars/${req.user.id}/avatar.gif`,
    ]);

    const { error: upErr } = await admin.storage
      .from('profile-avatars')
      .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (upErr) throw upErr;

    // Use SUPABASE_PUBLIC_URL so the stored URL is the externally-reachable address,
    // not the internal Docker hostname that SUPABASE_URL may point to.
    const supabasePublicUrl = process.env.SUPABASE_PUBLIC_URL || process.env.SUPABASE_URL;
    const publicUrl = `${supabasePublicUrl}/storage/v1/object/public/profile-avatars/${path}`;

    await admin.from('profiles').update({ avatar_url: publicUrl }).eq('id', req.user.id);
    logger.info('Avatar uploaded', { userId: req.user.id });
    return res.json({ avatarUrl: publicUrl });
  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// DELETE /api/v1/auth/profile/avatar
// Headers: Authorization: Bearer <token>
// -----------------------------------------------------------------------------
const removeAvatar = async (req, res, next) => {
  try {
    const admin = getAdminClient();
    await admin.storage.from('profile-avatars').remove([
      `avatars/${req.user.id}/avatar.jpg`,
      `avatars/${req.user.id}/avatar.png`,
      `avatars/${req.user.id}/avatar.webp`,
      `avatars/${req.user.id}/avatar.gif`,
    ]);
    await admin.from('profiles').update({ avatar_url: null }).eq('id', req.user.id);
    logger.info('Avatar removed', { userId: req.user.id });
    return res.json({ avatarUrl: null });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/auth/forgot-password
// Body: { email }
// -----------------------------------------------------------------------------
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const supabase = getAdminClient();

    // Generate recovery link + OTP via Supabase
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${process.env.CLIENT_URL}/reset-password`,
      },
    });

    if (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    // Fix dev URL
    const resetLink = data.properties.action_link
      .replace(/^https:\/\/10\.0\.10\.60\//, 'http://10.0.10.60:8100/');

    const otp = data.properties.email_otp;

    // Send branded email ourselves
    const { sendEmail } = require('../services/notifications');
    await sendEmail(
      { enabled: true, recipient: email },
      {
        subject: 'portfolioTraker — Reset Your Password',
        html: `
          <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #1a1d23; border-radius: 12px; overflow: hidden;">
            <div style="background: #22262e; padding: 24px; text-align: center; border-bottom: 1px solid #2e3340;">
              <span style="font-size: 18px; font-weight: 600; color: #fff;">
                portfolio<span style="color: #f5a623;">Traker</span>
              </span>
            </div>
            <div style="padding: 32px 24px;">
              <h2 style="color: #ffffff; font-size: 20px; margin: 0 0 12px;">Reset your password</h2>
              <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
                We received a request to reset your portfolioTraker password.
                Click the button below or enter the code on the sign-in page.
              </p>
              <div style="text-align: center; margin: 24px 0;">
                <a href="${resetLink}"
                   style="display: inline-block; background: #f5a623; color: #000000; font-weight: 700; font-size: 15px; padding: 14px 32px; border-radius: 8px; text-decoration: none;">
                  Reset Password
                </a>
              </div>
              <div style="background: #22262e; border: 1px solid #2e3340; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
                <p style="color: #a0a0a0; font-size: 12px; margin: 0 0 8px;">
                  Or enter this code on the sign-in page:
                </p>
                <p style="color: #f5a623; font-size: 32px; font-weight: 700; letter-spacing: 8px; margin: 0; font-family: monospace;">
                  ${otp}
                </p>
              </div>
              <p style="color: #6b7280; font-size: 12px; line-height: 1.6; margin: 0;">
                This link and code expire in 1 hour. If you did not request a reset,
                you can safely ignore this email.
              </p>
            </div>
            <div style="background: #22262e; padding: 16px 24px; border-top: 1px solid #2e3340; text-align: center;">
              <p style="color: #6b7280; font-size: 11px; margin: 0;">
                portfolioTraker — private family access only
              </p>
            </div>
          </div>
        `,
        text: `Reset your portfolioTraker password.\n\nClick this link: ${resetLink}\n\nOr enter this code: ${otp}\n\nExpires in 1 hour.`,
      }
    );

    logger.info('Password reset email sent', { email });
    return res.status(200).json({ success: true, message: 'Reset email sent' });

  } catch (err) {
    next(err);
  }
};

// POST /api/v1/auth/reset-password
// Body: { accessToken, password }
const resetPassword = async (req, res, next) => {
  try {
    const { accessToken, password } = req.body;

    if (!accessToken || !password) {
      return res.status(400).json({
        success: false,
        message: 'Access token and password are required',
      });
    }

    if (password.length < 8) {
      return res.status(422).json({
        success: false,
        message: 'Password must be at least 8 characters',
      });
    }

    // Use the recovery token to authenticate and update the password
    const anonClient = getAnonClient();
    const { error: sessionError } = await anonClient.auth.setSession({
      access_token: accessToken,
      refresh_token: '', // not needed for password reset
    });

    if (sessionError) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired reset link',
      });
    }

    // Update the password using admin client
    const adminClient = getAdminClient();
    const { data: { user }, error: userError } = await anonClient.auth.getUser(accessToken);

    if (userError || !user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired reset link',
      });
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(
      user.id,
      { password }
    );

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: 'Failed to update password',
      });
    }

    logger.info('Password reset successful', { userId: user.id });

    return res.status(200).json({
      success: true,
      message: 'Password updated successfully',
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
  uploadAvatar,
  removeAvatar,
  forgotPassword,
  resetPassword,
};
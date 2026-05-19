'use strict';

const { getAdminClient } = require('../lib/supabase');
const { notifyAdmins } = require('../services/notifications');
const logger = require('../utils/logger');

// =============================================================================
// User Controller — non-admin user actions
// =============================================================================

// -----------------------------------------------------------------------------
// POST /api/v1/user/request-upgrade
// Body: { message? }
// Viewer requests upgrade to full user — notifies admins
// -----------------------------------------------------------------------------
const requestUpgrade = async (req, res, next) => {
  try {
    const { message } = req.body;
    const supabase = getAdminClient();

    // Check current role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, display_name')
      .eq('id', req.user.id)
      .single();

    if (profile?.role !== 'viewer') {
      return res.status(400).json({
        success: false,
        message: 'Only viewers can request a role upgrade',
      });
    }

    // Upsert request (one per user)
    const { error } = await supabase
      .from('role_requests')
      .upsert({
        user_id:        req.user.id,
        requested_role: 'user',
        message:        message || null,
        status:         'pending',
        created_at:     new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) return next(error);

    // Get user email for notification
    const { data: { user: authUser } } = await supabase.auth.admin.getUserById(req.user.id);

    // Notify all admins
    const displayName = profile?.display_name || authUser?.email || 'A user';
    await notifyAdmins(supabase, {
      title:    'portfolioTraker — Role Upgrade Request',
      message:  `${displayName} (${authUser?.email}) has requested to be upgraded from viewer to user.${message ? `\n\nMessage: ${message}` : ''}`,
      subject:  'portfolioTraker — Role Upgrade Request',
      html:     `
        <div style="font-family: sans-serif; max-width: 480px;">
          <h2 style="color: #f5a623;">Role Upgrade Request</h2>
          <p><strong>${displayName}</strong> (${authUser?.email}) has requested to be upgraded from <strong>viewer</strong> to <strong>user</strong>.</p>
          ${message ? `<p><em>"${message}"</em></p>` : ''}
          <p>Log in to portfolioTraker to review this request.</p>
        </div>
      `,
      priority: 4,
      tags:     ['raising_hand'],
    });

    logger.info('Role upgrade requested', { userId: req.user.id });

    return res.status(201).json({
      success: true,
      message: 'Upgrade request submitted. An admin will review it shortly.',
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// GET /api/v1/user/upgrade-request
// Check if current user has a pending upgrade request
// -----------------------------------------------------------------------------
const getUpgradeRequest = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const { data: request } = await supabase
      .from('role_requests')
      .select('*')
      .eq('user_id', req.user.id)
      .single();

    return res.status(200).json({
      success: true,
      request: request || null,
    });

  } catch (err) {
    next(err);
  }
};

// DELETE /api/v1/user/account
const deleteOwnAccount = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    // Check not the last admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (profile?.role === 'admin') {
      const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'admin')
        .neq('id', req.user.id);

      if (count === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete the only admin account. Promote another user to admin first.',
        });
      }
    }

    const { error } = await supabase.auth.admin.deleteUser(req.user.id);
    if (error) return next(error);

    logger.info('User deleted own account', { userId: req.user.id });
    return res.status(200).json({ success: true, message: 'Account deleted' });

  } catch (err) {
    next(err);
  }
};

module.exports = { requestUpgrade, getUpgradeRequest, deleteOwnAccount };

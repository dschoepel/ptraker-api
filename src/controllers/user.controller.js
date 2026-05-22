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

// GET /api/v1/user/export
const exportData = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const [accounts, positions, importHistory, watchlist, importerPrefs] = await Promise.all([
      supabase.from('accounts').select('*').eq('user_id', req.user.id),
      supabase.from('positions').select('*').eq('user_id', req.user.id),
      supabase.from('import_history').select('*').eq('user_id', req.user.id),
      supabase.from('watchlist').select('*').eq('user_id', req.user.id),
      supabase.from('user_importer_preferences').select('importer_id, is_enabled').eq('user_id', req.user.id),
    ]);

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, role, created_at')
      .eq('id', req.user.id)
      .single();

    return res.status(200).json({
      success: true,
      export: {
        exportedAt:         new Date().toISOString(),
        user: {
          id:               req.user.id,
          email:            req.user.email,
          displayName:      profile?.display_name,
          role:             profile?.role,
          createdAt:        profile?.created_at,
        },
        accounts:           accounts.data       || [],
        positions:          positions.data      || [],
        importHistory:      importHistory.data  || [],
        watchlist:          watchlist.data      || [],
        importerPreferences: importerPrefs.data || [],
      },
    });
  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// GET /api/v1/user/importer-preferences
// Returns all active non-default importers with the user's enabled state
// -----------------------------------------------------------------------------
const getImporterPreferences = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const { data: importers, error } = await supabase
      .from('importers')
      .select('id, name, description, instructions, file_types, institutions, is_default, display_order')
      .eq('is_active', true)
      .eq('is_default', false)
      .order('display_order', { ascending: true });

    if (error) return next(error);

    const { data: prefs } = await supabase
      .from('user_importer_preferences')
      .select('importer_id, is_enabled')
      .eq('user_id', req.user.id);

    const prefMap = {};
    (prefs || []).forEach(p => { prefMap[p.importer_id] = p.is_enabled; });

    const result = (importers || []).map(imp => ({
      id:           imp.id,
      name:         imp.name,
      description:  imp.description,
      instructions: imp.instructions,
      fileTypes:    imp.file_types || [],
      institutions: imp.institutions || [],
      isEnabled:    prefMap[imp.id] ?? false,
    }));

    return res.status(200).json({ success: true, preferences: result });
  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// PATCH /api/v1/user/importer-preferences
// Body: { preferences: [{ importer_id, is_enabled }] }
// -----------------------------------------------------------------------------
const updateImporterPreferences = async (req, res, next) => {
  try {
    const { preferences } = req.body;

    if (!Array.isArray(preferences)) {
      return res.status(400).json({ success: false, message: 'preferences must be an array' });
    }

    const supabase = getAdminClient();

    const rows = preferences.map(p => ({
      user_id:    req.user.id,
      importer_id: p.importer_id,
      is_enabled: p.is_enabled,
    }));

    const { error } = await supabase
      .from('user_importer_preferences')
      .upsert(rows, { onConflict: 'user_id,importer_id' });

    if (error) return next(error);

    return res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  requestUpgrade,
  getUpgradeRequest,
  deleteOwnAccount,
  exportData,
  getImporterPreferences,
  updateImporterPreferences,
};
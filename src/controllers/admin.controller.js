'use strict';

const { getAdminClient } = require('../lib/supabase');
const { notifyAdmins, testNotification } = require('../services/notifications');
const logger = require('../utils/logger');

// =============================================================================
// Admin Controller
// =============================================================================

// Middleware — require admin role
const requireAdmin = async (req, res, next) => {
  try {
    const supabase = getAdminClient();
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    next();
  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// GET /api/v1/admin/users
// Returns all users with their profiles
// -----------------------------------------------------------------------------
const getUsers = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, display_name, role, created_at')
      .order('created_at', { ascending: true });

    if (error) return next(error);

    // Get emails from auth.users via admin API
    const { data: { users: authUsers } } = await supabase.auth.admin.listUsers();
    const emailMap = {};
    authUsers.forEach(u => { emailMap[u.id] = u.email; });

    const users = profiles.map(p => ({
      ...p,
      email: emailMap[p.id] || null,
    }));

    // Get pending role request count
    const { count: pendingRequests } = await supabase
      .from('role_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    return res.status(200).json({
      success: true,
      users,
      pendingRequests: pendingRequests || 0,
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// POST /api/v1/admin/invite
// Body: { email, role }
// Sends Supabase invite email and logs the invite
// -----------------------------------------------------------------------------
const inviteUser = async (req, res, next) => {
  try {
    const { email, role = 'user' } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }
    if (!['user', 'viewer'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Role must be user or viewer' });
    }

    const supabase = getAdminClient();

    // Generate invite link directly — bypasses GoTrue's broken email send
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo: `${process.env.CLIENT_URL}/dashboard`,
        data: { intended_role: role },
      },
    });

    if (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    // Fix URL in dev — GoTrue builds from request host header instead of API_EXTERNAL_URL
    const inviteLink = data.properties.action_link
      .replace(/^https:\/\/10\.0\.10\.60\//, 'http://10.0.10.60:8100/');

    // Set role in user metadata
    await supabase.auth.admin.updateUserById(data.user.id, {
      user_metadata: { intended_role: role },
    });

    // Log the invite
    await supabase.from('user_invites').upsert({
      invited_by: req.user.id,
      email,
      role,
      status: 'pending',
    }, { onConflict: 'email' });

    // Send invite email ourselves via nodemailer
    const { sendEmail } = require('../services/notifications');
    await sendEmail(
      { enabled: true, recipient: email },
      {
        subject: 'You have been invited to portfolioTraker',
        html: `
          <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #1a1d23; border-radius: 12px; overflow: hidden;">
            <div style="background: #22262e; padding: 24px; text-align: center; border-bottom: 1px solid #2e3340;">
              <span style="font-size: 18px; font-weight: 600; color: #fff;">
                portfolio<span style="color: #f5a623;">Traker</span>
              </span>
            </div>
            <div style="padding: 32px 24px;">
              <h2 style="color: #ffffff; font-size: 20px; margin: 0 0 12px;">You have been invited</h2>
              <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
                You have been invited to access portfolioTraker — a private family
                portfolio tracking dashboard. Click the button below to set up your account.
              </p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${inviteLink}"
                   style="display: inline-block; background: #f5a623; color: #000000; font-weight: 700; font-size: 15px; padding: 14px 32px; border-radius: 8px; text-decoration: none;">
                  Accept Invitation
                </a>
              </div>
              <p style="color: #6b7280; font-size: 12px; line-height: 1.6; margin: 24px 0 0;">
                This invitation expires in 24 hours. If you were not expecting this invitation,
                you can safely ignore this email.
              </p>
            </div>
            <div style="background: #22262e; padding: 16px 24px; border-top: 1px solid #2e3340; text-align: center;">
              <p style="color: #6b7280; font-size: 11px; margin: 0;">portfolioTraker — private family access only</p>
            </div>
          </div>
        `,
        text: `You have been invited to portfolioTraker. Accept your invitation: ${inviteLink}`,
      }
    );

    logger.info('User invited', { invitedBy: req.user.id, email, role });

    return res.status(201).json({
      success: true,
      message: `Invitation sent to ${email}`,
      userId: data.user.id,
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// PATCH /api/v1/admin/users/:id
// Body: { role }
// Change a user's role — cannot demote last admin
// -----------------------------------------------------------------------------
const updateUserRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['user', 'viewer', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    const supabase = getAdminClient();

    // Get current role
    const { data: current } = await supabase
      .from('profiles')
      .select('role, display_name')
      .eq('id', id)
      .single();

    // Prevent demoting the last admin
    if (current?.role === 'admin' && role !== 'admin') {
      const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'admin')
        .neq('id', id);

      if (count === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot demote the only admin. Promote another user to admin first.',
        });
      }
    }

    const { error } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', id);

    if (error) return next(error);

    logger.info('User role updated', { updatedBy: req.user.id, userId: id, role });

    return res.status(200).json({ success: true, message: `Role updated to ${role}` });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// GET /api/v1/admin/role-requests
// Returns pending role upgrade requests
// -----------------------------------------------------------------------------
const getRoleRequests = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const { data: requests, error } = await supabase
      .from('role_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return next(error);

    // Enrich with user info
    const userIds = requests.map(r => r.user_id);
    if (userIds.length === 0) {
      return res.status(200).json({ success: true, requests: [] });
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, role')
      .in('id', userIds);

    const { data: { users: authUsers } } = await supabase.auth.admin.listUsers();
    const emailMap = {};
    authUsers.forEach(u => { emailMap[u.id] = u.email; });

    const profileMap = {};
    profiles.forEach(p => { profileMap[p.id] = p; });

    const enriched = requests.map(r => ({
      ...r,
      display_name: profileMap[r.user_id]?.display_name || 'Unknown',
      current_role: profileMap[r.user_id]?.role || 'user',
      email: emailMap[r.user_id] || null,
    }));

    return res.status(200).json({ success: true, requests: enriched });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// PATCH /api/v1/admin/role-requests/:id
// Body: { action: 'approve' | 'deny' }
// -----------------------------------------------------------------------------
const reviewRoleRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    if (!['approve', 'deny'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be approve or deny' });
    }

    const supabase = getAdminClient();

    const { data: request } = await supabase
      .from('role_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    // Update request status
    await supabase
      .from('role_requests')
      .update({
        status: action === 'approve' ? 'approved' : 'denied',
        reviewed_at: new Date().toISOString(),
        reviewed_by: req.user.id,
      })
      .eq('id', id);

    // If approved — update the user's role
    if (action === 'approve') {
      await supabase
        .from('profiles')
        .update({ role: request.requested_role })
        .eq('id', request.user_id);

      logger.info('Role request approved', {
        reviewedBy: req.user.id,
        userId: request.user_id,
        newRole: request.requested_role,
      });
    }

    return res.status(200).json({
      success: true,
      message: action === 'approve' ? 'Request approved' : 'Request denied',
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// GET /api/v1/admin/notification-settings
// Returns current admin's notification settings
// -----------------------------------------------------------------------------
const getNotificationSettings = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('notification_settings')
      .eq('id', req.user.id)
      .single();

    return res.status(200).json({
      success: true,
      settings: profile?.notification_settings || {
        ntfy: { enabled: false, url: '', topic: '', token: '' },
        email: { enabled: false, recipient: '' },
      },
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// PATCH /api/v1/admin/notification-settings
// Body: { ntfy: {...}, email: {...} }
// -----------------------------------------------------------------------------
const updateNotificationSettings = async (req, res, next) => {
  try {
    const { ntfy, email } = req.body;
    const supabase = getAdminClient();

    const { data: current } = await supabase
      .from('profiles')
      .select('notification_settings')
      .eq('id', req.user.id)
      .single();

    const updated = {
      ...(current?.notification_settings || {}),
      ...(ntfy !== undefined ? { ntfy } : {}),
      ...(email !== undefined ? { email } : {}),
    };

    await supabase
      .from('profiles')
      .update({ notification_settings: updated })
      .eq('id', req.user.id);

    return res.status(200).json({ success: true, settings: updated });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// POST /api/v1/admin/notification-settings/test
// Body: { channel: 'ntfy' | 'email' }
// -----------------------------------------------------------------------------
const testNotificationSettings = async (req, res, next) => {
  try {
    const { channel } = req.body;
    const supabase = getAdminClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('notification_settings')
      .eq('id', req.user.id)
      .single();

    const settings = profile?.notification_settings?.[channel];
    if (!settings) {
      return res.status(400).json({ success: false, message: 'Channel settings not found' });
    }

    await testNotification(channel, settings);

    return res.status(200).json({ success: true, message: `Test ${channel} notification sent` });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// DELETE /api/v1/admin/users/:id
// Admin deletes a user — cannot delete self or last admin
// -----------------------------------------------------------------------------
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const supabase = getAdminClient();

    // Cannot delete yourself
    if (id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account from the admin panel. Use Profile > Delete Account.',
      });
    }

    // Get current role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, display_name')
      .eq('id', id)
      .single();

    // Cannot delete another admin unless there are others
    if (profile?.role === 'admin') {
      const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'admin')
        .neq('id', id);

      if (count === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete the only admin account.',
        });
      }
    }

    // Delete from auth.users — cascades to profiles and all user data
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) return next(error);

    logger.info('User deleted by admin', {
      deletedBy: req.user.id,
      deletedUserId: id,
      displayName: profile?.display_name,
    });

    return res.status(200).json({ success: true, message: 'User deleted' });

  } catch (err) {
    next(err);
  }
};


// -----------------------------------------------------------------------------
// GET /api/v1/admin/importers
// Returns all importers (active and inactive) for admin management
// -----------------------------------------------------------------------------
const getAdminImporters = async (req, res, next) => {
  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from('importers')
      .select('*')
      .order('display_order', { ascending: true });

    if (error) return next(error);

    // Tag each with whether a code module exists
    const IMPORTERS = require('../importers');
    const importers = (data || []).map(imp => ({
      ...imp,
      hasModule: !!IMPORTERS[imp.id],
    }));

    return res.status(200).json({ success: true, importers });
  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// POST /api/v1/admin/importers
// Register a new importer (code module must already be deployed)
// Body: { id, name, description, instructions, file_types, institutions,
//         is_default, is_active, is_manual, multi_account, display_order }
// -----------------------------------------------------------------------------
const registerImporter = async (req, res, next) => {
  try {
    const { id, name, description, instructions, file_types, institutions,
            is_default, is_active, is_manual, multi_account, display_order } = req.body;

    if (!id || !name) {
      return res.status(400).json({ success: false, message: 'id and name are required' });
    }

    const IMPORTERS = require('../importers');
    if (!IMPORTERS[id]) {
      return res.status(400).json({
        success: false,
        message: `No code module found for importer id '${id}'. Deploy the module first.`,
      });
    }

    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from('importers')
      .insert({
        id,
        name,
        description:  description  || '',
        instructions: instructions || '',
        file_types:   file_types   || [],
        institutions: institutions || [],
        is_default:   is_default   ?? false,
        is_active:    is_active    ?? true,
        is_manual:    is_manual    ?? false,
        multi_account: multi_account ?? false,
        display_order: display_order ?? 100,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ success: false, message: `Importer '${id}' is already registered` });
      }
      return next(error);
    }

    logger.info('Importer registered', { id, registeredBy: req.user.id });
    return res.status(201).json({ success: true, importer: data });
  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// PATCH /api/v1/admin/importers/:id
// Update importer metadata — name, description, instructions, is_default,
// is_active, display_order
// -----------------------------------------------------------------------------
const updateImporter = async (req, res, next) => {
  try {
    const { id } = req.params;
    const allowed = ['name', 'description', 'instructions', 'is_default', 'is_active', 'display_order'];
    const updates = {};
    for (const field of allowed) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No updatable fields provided' });
    }

    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from('importers')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return next(error);
    if (!data) return res.status(404).json({ success: false, message: 'Importer not found' });

    logger.info('Importer updated', { id, updates, updatedBy: req.user.id });
    return res.status(200).json({ success: true, importer: data });
  } catch (err) {
    next(err);
  }
};


module.exports = {
  requireAdmin,
  getUsers,
  inviteUser,
  updateUserRole,
  deleteUser,
  getRoleRequests,
  reviewRoleRequest,
  getNotificationSettings,
  updateNotificationSettings,
  testNotificationSettings,
  getAdminImporters,
  registerImporter,
  updateImporter,
};


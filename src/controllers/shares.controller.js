'use strict';

const { getAdminClient } = require('../lib/supabase');
const { sendEmail } = require('../services/notifications');
const logger = require('../utils/logger');

// =============================================================================
// Portfolio Shares Controller
// =============================================================================

// -----------------------------------------------------------------------------
// GET /api/v1/shares
// Returns shares you own and shares you can view
// -----------------------------------------------------------------------------
const getShares = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const { data: owned } = await supabase
      .from('portfolio_shares')
      .select('*')
      .eq('owner_user_id', req.user.id);

    const { data: viewing } = await supabase
      .from('portfolio_shares')
      .select('*')
      .eq('viewer_user_id', req.user.id);

    const allUserIds = [
      ...new Set([
        ...(owned || []).map(s => s.viewer_user_id),
        ...(viewing || []).map(s => s.owner_user_id),
      ])
    ];

    let profileMap = {};
    if (allUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', allUserIds);
      profiles?.forEach(p => { profileMap[p.id] = p.display_name; });
    }

    return res.status(200).json({
      success: true,
      owned: (owned || []).map(s => ({
        ...s,
        viewer_name: profileMap[s.viewer_user_id] || 'Unknown',
      })),
      viewing: (viewing || []).map(s => ({
        ...s,
        owner_name: profileMap[s.owner_user_id] || 'Unknown',
      })),
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// GET /api/v1/shares/discoverable-users
// Returns users who opted in to be discoverable (excluding self)
// -----------------------------------------------------------------------------
const getDiscoverableUsers = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, display_name')
      .eq('discoverable', true)
      .neq('id', req.user.id)
      .order('display_name');

    if (error) return next(error);

    return res.status(200).json({ success: true, users: profiles || [] });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// POST /api/v1/shares
// Body: { viewerId?, viewerEmail?, label }
//   viewerId    — share with existing user by ID (from discoverable list)
//   viewerEmail — share with new user (auto-invite as viewer)
// -----------------------------------------------------------------------------
const createShare = async (req, res, next) => {
  try {
    const { viewerId, viewerEmail, label } = req.body;

    if (!viewerId && !viewerEmail) {
      return res.status(400).json({
        success: false,
        message: 'Either viewerId or viewerEmail is required',
      });
    }

    const supabase = getAdminClient();
    let targetUserId = viewerId;
    let isNewUser = false;

    if (!targetUserId && viewerEmail) {
      // Check if user already exists
      const { data: { users } } = await supabase.auth.admin.listUsers();
      const existing = users.find(u => u.email?.toLowerCase() === viewerEmail.toLowerCase());

      if (existing) {
        targetUserId = existing.id;
      } else {
        // Auto-invite as viewer
        const { data, error: inviteError } = await supabase.auth.admin.generateLink({
          type: 'invite',
          email: viewerEmail,
          options: {
            redirectTo: `${process.env.CLIENT_URL}/dashboard`,
            data: { intended_role: 'viewer' },
          },
        });

        if (inviteError) {
          return res.status(400).json({ success: false, message: inviteError.message });
        }

        targetUserId = data.user.id;
        isNewUser = true;

        // Fix dev URL
        const inviteLink = data.properties.action_link
          .replace(/^https:\/\/10\.0\.10\.60\//, 'http://10.0.10.60:8100/');

        // Get owner's display name for the email
        const { data: ownerProfile } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', req.user.id)
          .single();

        const ownerName = ownerProfile?.display_name || 'Someone';

        // Send invite email
        await sendEmail(
          { enabled: true, recipient: viewerEmail },
          {
            subject: `${ownerName} shared their portfolio on portfolioTraker`,
            html: `
              <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #1a1d23; border-radius: 12px; overflow: hidden;">
                <div style="background: #22262e; padding: 24px; text-align: center; border-bottom: 1px solid #2e3340;">
                  <span style="font-size: 18px; font-weight: 600; color: #fff;">
                    portfolio<span style="color: #f5a623;">Traker</span>
                  </span>
                </div>
                <div style="padding: 32px 24px;">
                  <h2 style="color: #ffffff; font-size: 20px; margin: 0 0 12px;">You've been invited</h2>
                  <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
                    <strong style="color: #fff;">${ownerName}</strong> has shared their investment portfolio
                    with you on portfolioTraker. Create your account to view it.
                  </p>
                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${inviteLink}"
                       style="display: inline-block; background: #f5a623; color: #000000; font-weight: 700; font-size: 15px; padding: 14px 32px; border-radius: 8px; text-decoration: none;">
                      Accept &amp; View Portfolio
                    </a>
                  </div>
                  <p style="color: #6b7280; font-size: 12px; line-height: 1.6; margin: 0;">
                    This invitation expires in 24 hours.
                  </p>
                </div>
                <div style="background: #22262e; padding: 16px 24px; border-top: 1px solid #2e3340; text-align: center;">
                  <p style="color: #6b7280; font-size: 11px; margin: 0;">portfolioTraker — private family access only</p>
                </div>
              </div>
            `,
            text: `${ownerName} shared their portfolio with you on portfolioTraker. Accept: ${inviteLink}`,
          }
        );

        logger.info('New user invited via portfolio share', {
          ownerId: req.user.id,
          email: viewerEmail,
        });
      }
    }

    if (targetUserId === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot share with yourself' });
    }

    const { data: share, error } = await supabase
      .from('portfolio_shares')
      .insert({
        owner_user_id:  req.user.id,
        viewer_user_id: targetUserId,
        label:          label || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          success: false,
          message: 'You are already sharing your portfolio with this person',
        });
      }
      return next(error);
    }

    logger.info('Portfolio share created', {
      ownerId: req.user.id,
      viewerId: targetUserId,
      isNewUser,
    });

    return res.status(201).json({
      success: true,
      share,
      isNewUser,
      message: isNewUser
        ? 'Invitation sent — they will see your portfolio after accepting'
        : 'Portfolio shared successfully',
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// DELETE /api/v1/shares/:id
// -----------------------------------------------------------------------------
const deleteShare = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const { error } = await supabase
      .from('portfolio_shares')
      .delete()
      .eq('id', req.params.id)
      .eq('owner_user_id', req.user.id);

    if (error) return next(error);

    return res.status(200).json({ success: true, message: 'Share removed' });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// GET /api/v1/shares/:ownerId/dashboard
// Returns dashboard data for a shared portfolio
// -----------------------------------------------------------------------------
const getSharedDashboard = async (req, res, next) => {
  try {
    const { ownerId } = req.params;
    const supabase = getAdminClient();

    const { data: share } = await supabase
      .from('portfolio_shares')
      .select('id')
      .eq('owner_user_id', ownerId)
      .eq('viewer_user_id', req.user.id)
      .single();

    if (!share) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this portfolio',
      });
    }

    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', ownerId)
      .single();

    const { data: netWorth } = await supabase
      .from('net_worth_summary')
      .select('*')
      .eq('user_id', ownerId)
      .single();

    const { data: accounts } = await supabase
      .from('account_summary')
      .select('*')
      .eq('user_id', ownerId)
      .order('account_name');

    const { data: positions } = await supabase
      .from('portfolio_summary')
      .select('*')
      .eq('user_id', ownerId)
      .order('current_value', { ascending: false });

    const { data: priceInfo } = await supabase
      .from('price_cache')
      .select('last_fetched_at')
      .order('last_fetched_at', { ascending: false })
      .limit(1)
      .single();

    return res.status(200).json({
      success: true,
      ownerName: ownerProfile?.display_name || 'Unknown',
      dashboard: {
        netWorth:  netWorth  || {},
        accounts:  accounts  || [],
        positions: positions || [],
        priceInfo: { newestPriceAt: priceInfo?.last_fetched_at },
      },
    });

  } catch (err) {
    next(err);
  }
};

module.exports = { getShares, getDiscoverableUsers, createShare, deleteShare, getSharedDashboard };

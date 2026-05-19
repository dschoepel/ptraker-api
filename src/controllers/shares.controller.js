'use strict';

const { getAdminClient } = require('../lib/supabase');
const logger = require('../utils/logger');

// =============================================================================
// Portfolio Shares Controller
// =============================================================================

// -----------------------------------------------------------------------------
// GET /api/v1/shares
// Returns shares you own (shared with others) and shares you can view
// -----------------------------------------------------------------------------
const getShares = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    // Shares I created (portfolios I'm sharing with others)
    const { data: owned } = await supabase
      .from('portfolio_shares')
      .select('*')
      .eq('owner_user_id', req.user.id);

    // Shares I can view (portfolios shared with me)
    const { data: viewing } = await supabase
      .from('portfolio_shares')
      .select('*')
      .eq('viewer_user_id', req.user.id);

    // Enrich with display names
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
// POST /api/v1/shares
// Body: { viewerEmail, label }
// Share your portfolio with another user by email
// -----------------------------------------------------------------------------
const createShare = async (req, res, next) => {
  try {
    const { viewerEmail, label } = req.body;

    if (!viewerEmail) {
      return res.status(400).json({ success: false, message: 'viewerEmail is required' });
    }

    const supabase = getAdminClient();

    // Find the viewer by email
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const viewer = users.find(u => u.email?.toLowerCase() === viewerEmail.toLowerCase());

    if (!viewer) {
      return res.status(404).json({
        success: false,
        message: `No user found with email ${viewerEmail}. They must have an account first.`,
      });
    }

    if (viewer.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot share with yourself' });
    }

    const { data: share, error } = await supabase
      .from('portfolio_shares')
      .insert({
        owner_user_id:  req.user.id,
        viewer_user_id: viewer.id,
        label:          label || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          success: false,
          message: `You are already sharing your portfolio with ${viewerEmail}`,
        });
      }
      return next(error);
    }

    logger.info('Portfolio share created', {
      ownerId: req.user.id,
      viewerId: viewer.id,
    });

    return res.status(201).json({ success: true, share });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// DELETE /api/v1/shares/:id
// Remove a portfolio share (owner only)
// -----------------------------------------------------------------------------
const deleteShare = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const { error } = await supabase
      .from('portfolio_shares')
      .delete()
      .eq('id', req.params.id)
      .eq('owner_user_id', req.user.id); // ensure only owner can delete

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

    // Verify the share exists
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

    // Get owner's display name
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', ownerId)
      .single();

    // Fetch dashboard data using owner's user_id
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

module.exports = { getShares, createShare, deleteShare, getSharedDashboard };

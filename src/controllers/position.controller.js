'use strict';

const { getAdminClient } = require('../lib/supabase');
const logger = require('../utils/logger');

// =============================================================================
// Position Controller
// =============================================================================
// Read-only access to positions and portfolio summary data.
// Positions are written by the importer — not directly by the user.
// =============================================================================

// -----------------------------------------------------------------------------
// GET /api/v1/positions
// Returns all positions for the logged-in user with current prices
// Optional query params:
//   ?accountId=uuid  — filter by account
//   ?ticker=AAPL     — filter by ticker
// -----------------------------------------------------------------------------
const getAll = async (req, res, next) => {
  try {
    const supabase = getAdminClient();
    const { accountId, ticker } = req.query;

    let query = supabase
      .from('portfolio_summary')
      .select('*')
      .eq('user_id', req.user.id)
      .order('account_name', { ascending: true })
      .order('ticker', { ascending: true });

    if (accountId) query = query.eq('account_id', accountId);
    if (ticker)    query = query.eq('ticker', ticker.toUpperCase());

    const { data, error } = await query;
    if (error) return next(error);

    return res.status(200).json({
      success: true,
      count: data.length,
      positions: data,
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// GET /api/v1/positions/:id
// Returns a single position by id
// -----------------------------------------------------------------------------
const getOne = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const { data, error } = await supabase
      .from('portfolio_summary')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (error || !data) {
      return res.status(404).json({
        success: false,
        message: 'Position not found',
      });
    }

    return res.status(200).json({
      success: true,
      position: data,
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// DELETE /api/v1/positions/:id
// Removes a single position — used when a holding is sold
// -----------------------------------------------------------------------------
const remove = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    // Verify it belongs to this user first
    const { data: existing, error: findError } = await supabase
      .from('positions')
      .select('id, ticker, account_id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (findError || !existing) {
      return res.status(404).json({
        success: false,
        message: 'Position not found',
      });
    }

    const { error: deleteError } = await supabase
      .from('positions')
      .delete()
      .eq('id', req.params.id);

    if (deleteError) return next(deleteError);

    logger.info('Position deleted', {
      userId: req.user.id,
      positionId: req.params.id,
      ticker: existing.ticker,
    });

    return res.status(200).json({
      success: true,
      message: `Position ${existing.ticker} removed`,
    });

  } catch (err) {
    next(err);
  }
};

module.exports = { getAll, getOne, remove };
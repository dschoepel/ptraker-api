'use strict';

const { getAdminClient } = require('../lib/supabase');
const logger = require('../utils/logger');

// =============================================================================
// Dashboard Controller
// =============================================================================
// Returns everything the dashboard needs in a single API call:
//   - Net worth summary (grand totals)
//   - Account summaries (totals per account)
//   - All positions with current prices
//   - Last price refresh timestamp
//   - Import history (last 5)
//
// This avoids the N+1 problem from the old app where the dashboard
// made a separate API call for each account and each position.
// =============================================================================

// -----------------------------------------------------------------------------
// GET /api/v1/dashboard
// -----------------------------------------------------------------------------
const getDashboard = async (req, res, next) => {
  try {
    const supabase = getAdminClient();
    const userId = req.user.id;

    // Run all queries in parallel — Promise.all waits for all to complete
    // In RPG terms: submit all jobs at once, wait for all to finish
    const [
      netWorthResult,
      accountsResult,
      positionsResult,
      recentImportsResult,
    ] = await Promise.all([

      // 1. Net worth totals
      supabase
        .from('net_worth_summary')
        .select('*')
        .eq('user_id', userId)
        .single(),

      // 2. Account summaries
      supabase
        .from('account_summary')
        .select('*')
        .eq('user_id', userId)
        .order('institution', { ascending: true })
        .order('account_name', { ascending: true }),

      // 3. All positions with current prices
      supabase
        .from('portfolio_summary')
        .select('*')
        .eq('user_id', userId)
        .order('account_name', { ascending: true })
        .order('ticker', { ascending: true }),

      // 4. Recent import history
      supabase
        .from('import_history')
        .select('id, filename, institution, status, rows_imported, as_of_date, imported_at')
        .eq('user_id', userId)
        .order('imported_at', { ascending: false })
        .limit(5),
    ]);

    // Check for errors
    if (netWorthResult.error && netWorthResult.error.code !== 'PGRST116') {
      // PGRST116 = no rows found — that's ok for a new user with no positions
      return next(netWorthResult.error);
    }
    if (accountsResult.error)      return next(accountsResult.error);
    if (positionsResult.error)     return next(positionsResult.error);
    if (recentImportsResult.error) return next(recentImportsResult.error);

    // Find the oldest price timestamp — tells the user how stale prices are
    const positions = positionsResult.data || [];
    const priceTimestamps = positions
      .filter(p => p.price_as_of)
      .map(p => new Date(p.price_as_of).getTime());

    const oldestPriceAt = priceTimestamps.length > 0
      ? new Date(Math.min(...priceTimestamps)).toISOString()
      : null;

    const newestPriceAt = priceTimestamps.length > 0
      ? new Date(Math.max(...priceTimestamps)).toISOString()
      : null;

    logger.debug('Dashboard loaded', {
      userId,
      positionCount: positions.length,
      accountCount: accountsResult.data?.length || 0,
    });

    return res.status(200).json({
      success: true,
      dashboard: {
        netWorth:      netWorthResult.data || null,
        accounts:      accountsResult.data || [],
        positions:     positions,
        recentImports: recentImportsResult.data || [],
        priceInfo: {
          oldestPriceAt,
          newestPriceAt,
        },
      },
    });

  } catch (err) {
    next(err);
  }
};

module.exports = { getDashboard };
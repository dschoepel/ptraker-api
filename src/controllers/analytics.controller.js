'use strict';

const { getAdminClient } = require('../lib/supabase');
const { backfill } = require('../services/snapshotService');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

// Valid day ranges offered in the UI
const VALID_DAYS = [30, 90, 180, 365, 730];

// =============================================================================
// GET /api/v1/analytics/history?days=N
// =============================================================================
// Returns per-account daily snapshot rows for the requested date range, plus
// metadata for all opted-in accounts (for the account selector UI).
//
// Response shape:
//   { success, days, accounts: [...], history: [{ date, accountId, value, isBackfilled }] }
// =============================================================================
const getHistory = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ success: false, errors: errors.array() });
    }

    const requestedDays = parseInt(req.query.days, 10);
    const days = VALID_DAYS.includes(requestedDays) ? requestedDays : 365;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffDate = cutoff.toISOString().split('T')[0];

    const supabase = getAdminClient();

    // Fetch opted-in accounts for this user (for account selector metadata)
    const { data: accounts, error: acctError } = await supabase
      .from('accounts')
      .select('id, name, institution, type, account_number_last4')
      .eq('user_id', req.user.id)
      .eq('include_in_snapshot', true)
      .eq('is_active', true)
      .order('institution')
      .order('name');

    if (acctError) {
      logger.error('getHistory: failed to fetch accounts', { error: acctError.message });
      return next(acctError);
    }

    // Fetch snapshot rows for the date range
    const { data: snapshots, error: snapError } = await supabase
      .from('account_daily_snapshots')
      .select('snapshot_date, account_id, total_value, is_backfilled')
      .eq('user_id', req.user.id)
      .gte('snapshot_date', cutoffDate)
      .order('snapshot_date', { ascending: true });

    if (snapError) {
      logger.error('getHistory: failed to fetch snapshots', { error: snapError.message });
      return next(snapError);
    }

    return res.status(200).json({
      success: true,
      days,
      accounts: (accounts || []).map(a => ({
        id: a.id,
        name: a.name,
        institution: a.institution,
        type: a.type,
        accountNumberLast4: a.account_number_last4,
      })),
      history: (snapshots || []).map(s => ({
        date: s.snapshot_date,
        accountId: s.account_id,
        value: s.total_value,
        isBackfilled: s.is_backfilled,
      })),
    });

  } catch (err) {
    next(err);
  }
};

// =============================================================================
// POST /api/v1/analytics/backfill
// Body: { lookbackDays: 30 | 90 | 180 | 365 | 730 }
// =============================================================================
// Triggers a Yahoo Finance historical backfill for the requesting user.
// Estimates historical portfolio value using current holdings × historical price.
// =============================================================================
const runBackfill = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ success: false, errors: errors.array() });
    }

    const lookbackDays = Number(req.body.lookbackDays);

    const supabase = getAdminClient();

    // Verify user has at least one opted-in, active account with positions
    const { data: optedIn, error: checkError } = await supabase
      .from('accounts')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('include_in_snapshot', true)
      .eq('is_active', true)
      .limit(1);

    if (checkError) return next(checkError);

    if (!optedIn || optedIn.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No accounts are opted in to snapshots. Enable "Include in portfolio value history snapshot" on at least one account first.',
      });
    }

    logger.info(`runBackfill: starting for user ${req.user.id}, ${lookbackDays} days`);

    const results = await backfill(req.user.id, lookbackDays);

    return res.status(200).json({
      success: true,
      message: `Backfill complete — ${results.datesProcessed} trading days across ${results.accountsProcessed} accounts`,
      ...results,
    });

  } catch (err) {
    logger.error('runBackfill failed', { userId: req.user.id, error: err.message });
    next(err);
  }
};

module.exports = { getHistory, runBackfill };

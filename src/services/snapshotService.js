'use strict';

const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const { getAdminClient } = require('../lib/supabase');
const logger = require('../utils/logger');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const todayUTC = () => new Date().toISOString().split('T')[0];

// =============================================================================
// captureSnapshot
// =============================================================================
// Called nightly after price refresh completes. Reads current prices from
// price_cache and computes per-account total value for each opted-in account.
// Bulk-upserts one row per account into account_daily_snapshots.
// =============================================================================
const captureSnapshot = async () => {
  const supabase = getAdminClient();
  const snapshotDate = todayUTC();
  const results = { snapshotted: 0, errors: 0 };

  // Fetch all opted-in, active accounts
  const { data: accounts, error: acctError } = await supabase
    .from('accounts')
    .select('id, user_id')
    .eq('include_in_snapshot', true)
    .eq('is_active', true);

  if (acctError) {
    logger.error('captureSnapshot: failed to fetch opted-in accounts', { error: acctError.message });
    throw acctError;
  }

  if (!accounts || accounts.length === 0) {
    logger.info('captureSnapshot: no opted-in accounts');
    return results;
  }

  const accountIds = accounts.map(a => a.id);

  // Fetch all positions for opted-in accounts in one query
  const { data: allPositions, error: posError } = await supabase
    .from('positions')
    .select('ticker, shares, cost_basis, account_id')
    .in('account_id', accountIds);

  if (posError) {
    logger.error('captureSnapshot: failed to fetch positions', { error: posError.message });
    throw posError;
  }

  if (!allPositions || allPositions.length === 0) {
    logger.info('captureSnapshot: no positions found for opted-in accounts');
    return results;
  }

  // Fetch current prices for all relevant tickers
  const tickers = [...new Set(allPositions.map(p => p.ticker))];
  const { data: priceRows, error: priceError } = await supabase
    .from('price_cache')
    .select('ticker, price')
    .in('ticker', tickers);

  if (priceError) {
    logger.error('captureSnapshot: failed to fetch price_cache', { error: priceError.message });
    throw priceError;
  }

  const priceMap = new Map((priceRows || []).map(r => [r.ticker, r.price]));

  // Compute per-account totals and build upsert rows
  const snapshotRows = [];
  for (const account of accounts) {
    const positions = allPositions.filter(p => p.account_id === account.id);
    if (positions.length === 0) continue;

    let totalValue = 0;
    let totalCostBasis = 0;
    for (const pos of positions) {
      const price = priceMap.get(pos.ticker) ?? 0;
      totalValue += (pos.shares || 0) * price;
      totalCostBasis += pos.cost_basis || 0;
    }

    snapshotRows.push({
      user_id: account.user_id,
      account_id: account.id,
      snapshot_date: snapshotDate,
      total_value: Math.round(totalValue * 100) / 100,
      total_cost_basis: Math.round(totalCostBasis * 100) / 100,
      is_backfilled: false,
    });
  }

  if (snapshotRows.length === 0) {
    logger.info('captureSnapshot: no rows to upsert');
    return results;
  }

  const { error: upsertError } = await supabase
    .from('account_daily_snapshots')
    .upsert(snapshotRows, { onConflict: 'account_id,snapshot_date' });

  if (upsertError) {
    logger.error('captureSnapshot: upsert failed', { error: upsertError.message });
    results.errors = snapshotRows.length;
  } else {
    results.snapshotted = snapshotRows.length;
    logger.info(`captureSnapshot: saved ${results.snapshotted} account snapshots for ${snapshotDate}`);
  }

  return results;
};

// =============================================================================
// backfill
// =============================================================================
// On-demand backfill for one user. Fetches historical daily prices from Yahoo
// Finance for all tickers in their opted-in accounts and reconstructs portfolio
// value per account per trading day.
//
// IMPORTANT: Values are estimated — current holdings × historical price.
// If the user changed positions over time, these will not match actual history.
// =============================================================================
const backfill = async (userId, lookbackDays) => {
  const supabase = getAdminClient();

  logger.info(`backfill: starting for user ${userId}, ${lookbackDays} days`);

  // Step 1: Get opted-in account IDs for this user
  const { data: accounts, error: acctError } = await supabase
    .from('accounts')
    .select('id, user_id')
    .eq('user_id', userId)
    .eq('include_in_snapshot', true)
    .eq('is_active', true);

  if (acctError) throw acctError;
  if (!accounts || accounts.length === 0) {
    return { datesProcessed: 0, accountsProcessed: 0, tickersProcessed: 0, tickersFailed: 0 };
  }

  const accountIds = accounts.map(a => a.id);

  // Step 2: Get all positions for those accounts
  const { data: allPositions, error: posError } = await supabase
    .from('positions')
    .select('ticker, shares, account_id')
    .in('account_id', accountIds);

  if (posError) throw posError;
  if (!allPositions || allPositions.length === 0) {
    return { datesProcessed: 0, accountsProcessed: accounts.length, tickersProcessed: 0, tickersFailed: 0 };
  }

  // Separate CASH from market tickers — CASH is always $1.00, no Yahoo data needed
  const cashPositionsByAccount = {};
  const marketPositionsByAccount = {};
  for (const pos of allPositions) {
    if (pos.ticker === 'CASH') {
      if (!cashPositionsByAccount[pos.account_id]) cashPositionsByAccount[pos.account_id] = [];
      cashPositionsByAccount[pos.account_id].push(pos);
    } else {
      if (!marketPositionsByAccount[pos.account_id]) marketPositionsByAccount[pos.account_id] = [];
      marketPositionsByAccount[pos.account_id].push(pos);
    }
  }

  const uniqueTickers = [...new Set(allPositions.filter(p => p.ticker !== 'CASH').map(p => p.ticker))];

  // Step 3: Compute period1/period2 date strings
  // period2 must be explicit — the library fails validation if it receives period2: undefined.
  // If today is Sat/Sun, roll back to Friday — weekend dates have no market data and produce
  // artificially low totals when only a handful of tickers report.
  const period1Date = new Date();
  period1Date.setDate(period1Date.getDate() - lookbackDays);
  const period1 = period1Date.toISOString().split('T')[0];

  const period2Date = new Date();
  const todayDow = period2Date.getUTCDay();  // 0=Sun, 6=Sat
  if (todayDow === 0) period2Date.setUTCDate(period2Date.getUTCDate() - 2);  // Sun → Fri
  else if (todayDow === 6) period2Date.setUTCDate(period2Date.getUTCDate() - 1);  // Sat → Fri
  const period2 = period2Date.toISOString().split('T')[0];

  // Step 4: Fetch historical prices per ticker from Yahoo Finance
  // One call per ticker — each returns the full date range in one response
  // Note: omit `events` (defaults to price history) — passing events:'history' maps
  // to events:'' internally and fails ChartOptions schema validation in v3.14.x
  const priceSeriesByTicker = {};
  let tickersFailed = 0;

  for (const ticker of uniqueTickers) {
    try {
      const rows = await yahooFinance.historical(ticker, {
        period1,
        period2,
        interval: '1d',
      });

      if (rows && rows.length > 0) {
        priceSeriesByTicker[ticker] = rows
          .filter(r => (r.adjClose ?? r.close) != null)
          .map(r => ({
            date: r.date.toISOString().split('T')[0],   // date is always a Date obj
            price: r.adjClose ?? r.close,               // prefer split/dividend-adjusted
          }));
      } else {
        logger.warn(`backfill: no data returned for ${ticker}`);
        tickersFailed++;
      }
    } catch (err) {
      logger.warn(`backfill: failed to fetch ${ticker}`, { error: err.message });
      tickersFailed++;
    }

    await sleep(200);
  }

  logger.info(`backfill: fetched data for ${Object.keys(priceSeriesByTicker).length}/${uniqueTickers.length} tickers`);

  // Step 5: Build O(1) lookup: Map<ticker, Map<date, price>>
  const priceMap = new Map();
  for (const [ticker, series] of Object.entries(priceSeriesByTicker)) {
    priceMap.set(ticker, new Map(series.map(s => [s.date, s.price])));
  }

  // Step 6: Collect candidate dates and filter to genuine trading days.
  // A date is a trading day if:
  //   (a) it is not a Saturday (6) or Sunday (0), AND
  //   (b) at least 40% of market tickers have price data for it
  //       (this catches holidays where only a few outlier tickers report)
  const allDatesSet = new Set();
  for (const series of Object.values(priceSeriesByTicker)) {
    series.forEach(s => allDatesSet.add(s.date));
  }

  const minTickersForDay = Math.max(1, Math.ceil(uniqueTickers.length * 0.4));
  const allDates = [...allDatesSet].sort().filter(date => {
    const dow = new Date(date + 'T12:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6) return false;  // weekend
    let count = 0;
    for (const ticker of uniqueTickers) {
      if (priceMap.get(ticker)?.has(date)) count++;
    }
    return count >= minTickersForDay;
  });

  if (allDates.length === 0) {
    logger.warn('backfill: no trading dates found across all tickers');
    return { datesProcessed: 0, accountsProcessed: accounts.length, tickersProcessed: uniqueTickers.length - tickersFailed, tickersFailed };
  }

  // Step 7: Delete all existing backfill rows for this user before inserting new ones.
  // This ensures re-runs produce clean data — stale rows from prior runs (e.g. weekend
  // dates with partial data) are removed. Real nightly snapshot rows (is_backfilled=false)
  // are preserved.
  const { error: deleteError } = await supabase
    .from('account_daily_snapshots')
    .delete()
    .eq('user_id', userId)
    .eq('is_backfilled', true);

  if (deleteError) {
    logger.warn('backfill: failed to clear existing backfill rows', { error: deleteError.message });
    // Non-fatal — upsert will still succeed
  }

  // Step 8: For each account × date, compute total value
  const snapshotRows = [];

  for (const account of accounts) {
    const cashPositions = cashPositionsByAccount[account.id] || [];
    const marketPositions = marketPositionsByAccount[account.id] || [];

    const cashTotal = cashPositions.reduce((s, p) => s + (p.shares || 0) * 1.00, 0);

    for (const date of allDates) {
      let marketTotal = 0;
      let hasData = false;

      for (const pos of marketPositions) {
        const price = priceMap.get(pos.ticker)?.get(date);
        if (price !== undefined) {
          marketTotal += (pos.shares || 0) * price;
          hasData = true;
        }
        // If no price for this ticker on this date (weekend gap, different exchange),
        // skip it — don't count zero, accept the undercount for that day
      }

      const totalValue = marketTotal + cashTotal;
      // Only store rows where we got at least some market data, or account is all-cash
      if (hasData || cashPositions.length > 0) {
        snapshotRows.push({
          user_id: userId,
          account_id: account.id,
          snapshot_date: date,
          total_value: Math.round(totalValue * 100) / 100,
          total_cost_basis: null,   // not available from historical data
          is_backfilled: true,
        });
      }
    }
  }

  if (snapshotRows.length === 0) {
    logger.warn('backfill: no rows to insert');
    return { datesProcessed: 0, accountsProcessed: accounts.length, tickersProcessed: uniqueTickers.length - tickersFailed, tickersFailed };
  }

  // Step 9: Bulk upsert — Supabase handles up to ~500 rows efficiently;
  // for 730 days × 12 accounts = ~8760 rows, batch in chunks of 500
  const BATCH = 500;
  for (let i = 0; i < snapshotRows.length; i += BATCH) {
    const chunk = snapshotRows.slice(i, i + BATCH);
    const { error: upsertError } = await supabase
      .from('account_daily_snapshots')
      .upsert(chunk, { onConflict: 'account_id,snapshot_date', ignoreDuplicates: false });

    if (upsertError) {
      logger.error(`backfill: upsert failed (batch ${i / BATCH + 1})`, { error: upsertError.message });
      throw upsertError;
    }
  }

  const datesProcessed = allDates.length;
  logger.info(`backfill complete: ${snapshotRows.length} rows across ${accounts.length} accounts, ${datesProcessed} dates`);

  return {
    datesProcessed,
    accountsProcessed: accounts.length,
    tickersProcessed: uniqueTickers.length - tickersFailed,
    tickersFailed,
  };
};

module.exports = { captureSnapshot, backfill };

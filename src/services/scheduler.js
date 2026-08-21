'use strict';

const cron = require('node-cron');
const { fetchPrices } = require('./priceRefresh');
const { captureSnapshot } = require('./snapshotService');
const logger = require('../utils/logger');

// =============================================================================
// Scheduler
// =============================================================================
// Runs two cron jobs:
//   1. Nightly full price refresh + portfolio snapshot (PRICE_REFRESH_CRON)
//      Default: '0 17 * * 1-5' = 5pm CT, Monday-Friday
//   2. Intraday price refresh, no snapshot (INTRADAY_PRICE_REFRESH_CRON)
//      Default: '30 9-15 * * 1-5' = 9:30am-3:30pm ET, Monday-Friday
//      Always runs in America/New_York regardless of the server's TZ, since
//      market hours are ET-based. Keeps Dashboard/Watchlist prices fresh
//      throughout the trading day instead of only at close.
//
// Both are called once from server.js on startup.
//
// In RPG terms: think of these as submitted batch jobs that run on a schedule
// =============================================================================

let priceRefreshJob = null;
let intradayPriceRefreshJob = null;

const startScheduler = () => {
  // --- Nightly job: full refresh + snapshot ---
  const schedule = process.env.PRICE_REFRESH_CRON || '0 17 * * 1-5';
  const timezone = process.env.TZ || 'America/Chicago';

  logger.info(`Price refresh scheduled: ${schedule} (${timezone})`);

  priceRefreshJob = cron.schedule(
    schedule,
    async () => {
      logger.info('Nightly price refresh triggered by cron');
      try {
        const results = await fetchPrices();
        logger.info('Nightly price refresh complete', results);
      } catch (err) {
        logger.error('Nightly price refresh failed', { error: err.message });
      }

      // Capture daily portfolio snapshot after prices are fresh
      try {
        const snapResults = await captureSnapshot();
        logger.info('Nightly snapshot complete', snapResults);
      } catch (snapErr) {
        logger.error('Nightly snapshot failed', { error: snapErr.message });
        // Non-fatal — price refresh already succeeded
      }
    },
    {
      timezone,
    }
  );

  // --- Intraday job: price refresh only, no snapshot ---
  const intradaySchedule = process.env.INTRADAY_PRICE_REFRESH_CRON || '30 9-15 * * 1-5';
  const intradayTimezone = 'America/New_York';

  logger.info(`Intraday price refresh scheduled: ${intradaySchedule} (${intradayTimezone})`);

  intradayPriceRefreshJob = cron.schedule(
    intradaySchedule,
    async () => {
      logger.info('Intraday price refresh triggered by cron');
      try {
        const results = await fetchPrices();
        logger.info('Intraday price refresh complete', results);
      } catch (err) {
        logger.error('Intraday price refresh failed', { error: err.message });
      }
    },
    {
      timezone: intradayTimezone,
    }
  );

  logger.info('Scheduler started');
};

const stopScheduler = () => {
  if (priceRefreshJob) {
    priceRefreshJob.stop();
    logger.info('Nightly scheduler stopped');
  }
  if (intradayPriceRefreshJob) {
    intradayPriceRefreshJob.stop();
    logger.info('Intraday scheduler stopped');
  }
};

module.exports = { startScheduler, stopScheduler };

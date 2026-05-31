'use strict';

const cron = require('node-cron');
const { fetchPrices } = require('./priceRefresh');
const { captureSnapshot } = require('./snapshotService');
const logger = require('../utils/logger');

// =============================================================================
// Scheduler
// =============================================================================
// Runs the nightly price refresh cron job.
// Called once from server.js on startup.
//
// Schedule is set via PRICE_REFRESH_CRON in .env
// Default: '0 17 * * 1-5' = 5pm CT, Monday-Friday
//
// In RPG terms: think of this as a submitted batch job that runs on a schedule
// =============================================================================

let priceRefreshJob = null;

const startScheduler = () => {
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

  logger.info('Scheduler started');
};

const stopScheduler = () => {
  if (priceRefreshJob) {
    priceRefreshJob.stop();
    logger.info('Scheduler stopped');
  }
};

module.exports = { startScheduler, stopScheduler };
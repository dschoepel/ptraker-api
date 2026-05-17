'use strict';

const express = require('express');
const router = express.Router();

const { getAdminClient } = require('../lib/supabase');
const { fetchPrices, fetchPricesForTickers } = require('../services/priceRefresh');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

// =============================================================================
// Price Routes — /api/v1/prices
// =============================================================================

// -----------------------------------------------------------------------------
// GET /api/v1/prices
// Returns all cached prices — useful for debugging
// -----------------------------------------------------------------------------
router.get('/',
  requireAuth,
  async (req, res, next) => {
    try {
      const supabase = getAdminClient();
      const { data, error } = await supabase
        .from('price_cache')
        .select('*')
        .order('ticker');

      if (error) return next(error);

      return res.status(200).json({
        success: true,
        count: data.length,
        prices: data,
      });
    } catch (err) {
      next(err);
    }
  }
);

// -----------------------------------------------------------------------------
// POST /api/v1/prices/refresh
// Manually trigger a full price refresh — admin only in production,
// available to all users in development
// -----------------------------------------------------------------------------
router.post('/refresh',
  requireAuth,
  async (req, res, next) => {
    try {
      logger.info('Manual price refresh triggered', { userId: req.user.id });
      const results = await fetchPrices();

      return res.status(200).json({
        success: true,
        message: 'Price refresh complete',
        ...results,
      });
    } catch (err) {
      next(err);
    }
  }
);

// -----------------------------------------------------------------------------
// POST /api/v1/prices/refresh/tickers
// Refresh prices for specific tickers only
// Body: { tickers: ['AAPL', 'FTCS', ...] }
// -----------------------------------------------------------------------------
router.post('/refresh/tickers',
  requireAuth,
  async (req, res, next) => {
    try {
      const { tickers } = req.body;

      if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'tickers array is required',
        });
      }

      const results = await fetchPricesForTickers(tickers);

      return res.status(200).json({
        success: true,
        message: `Refreshed prices for ${results.updated} tickers`,
        ...results,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
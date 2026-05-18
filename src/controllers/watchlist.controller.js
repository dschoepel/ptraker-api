'use strict';

const { getAdminClient } = require('../lib/supabase');
const { fetchPricesForTickers } = require('../services/priceRefresh');
const logger = require('../utils/logger');

// =============================================================================
// Watchlist Controller
// =============================================================================

// -----------------------------------------------------------------------------
// GET /api/v1/watchlist
// Returns user's watchlist with current prices from price_cache
// -----------------------------------------------------------------------------
const getAll = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const { data: items, error } = await supabase
      .from('watchlist')
      .select('*')
      .eq('user_id', req.user.id)
      .order('added_at', { ascending: false });

    if (error) return next(error);

    if (items.length === 0) {
      return res.status(200).json({ success: true, count: 0, watchlist: [] });
    }

    // Fetch current prices from price_cache
    const tickers = items.map(i => i.ticker).filter(t => t !== 'CASH');
    const { data: prices } = await supabase
      .from('price_cache')
      .select('ticker, price, previous_close, change_amount, change_percent, last_fetched_at')
      .in('ticker', tickers);

    const priceMap = {};
    (prices || []).forEach(p => { priceMap[p.ticker] = p; });

    const watchlist = items.map(item => ({
      ...item,
      current_price:   priceMap[item.ticker]?.price || null,
      change_amount:   priceMap[item.ticker]?.change_amount || null,
      change_percent:  priceMap[item.ticker]?.change_percent || null,
      price_as_of:     priceMap[item.ticker]?.last_fetched_at || null,
    }));

    return res.status(200).json({
      success: true,
      count: watchlist.length,
      watchlist,
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// POST /api/v1/watchlist
// Body: { ticker, assetName?, assetType?, notes?, addedFrom? }
// -----------------------------------------------------------------------------
const add = async (req, res, next) => {
  try {
    const { ticker, assetName, assetType, notes, addedFrom } = req.body;

    if (!ticker) {
      return res.status(400).json({ success: false, message: 'Ticker is required' });
    }

    const supabase = getAdminClient();

    const { data: item, error } = await supabase
      .from('watchlist')
      .upsert({
        user_id:    req.user.id,
        ticker:     ticker.toUpperCase(),
        asset_name: assetName || null,
        asset_type: assetType || null,
        notes:      notes || null,
        added_from: addedFrom || 'manual',
      }, {
        onConflict: 'user_id,ticker',
        ignoreDuplicates: false,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          success: false,
          message: `${ticker.toUpperCase()} is already on your watchlist`,
        });
      }
      return next(error);
    }

    // Fetch price for the new ticker if not already cached
    try {
      await fetchPricesForTickers([ticker.toUpperCase()]);
    } catch {
      // Price fetch failure is non-fatal
    }

    logger.info('Watchlist item added', { userId: req.user.id, ticker });

    return res.status(201).json({ success: true, item });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// PATCH /api/v1/watchlist/:ticker
// Body: { notes? }
// -----------------------------------------------------------------------------
const update = async (req, res, next) => {
  try {
    const { notes } = req.body;
    const ticker = req.params.ticker.toUpperCase();
    const supabase = getAdminClient();

    const { data: item, error } = await supabase
      .from('watchlist')
      .update({ notes })
      .eq('user_id', req.user.id)
      .eq('ticker', ticker)
      .select()
      .single();

    if (error || !item) {
      return res.status(404).json({ success: false, message: 'Watchlist item not found' });
    }

    return res.status(200).json({ success: true, item });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// DELETE /api/v1/watchlist/:ticker
// -----------------------------------------------------------------------------
const remove = async (req, res, next) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const supabase = getAdminClient();

    const { error } = await supabase
      .from('watchlist')
      .delete()
      .eq('user_id', req.user.id)
      .eq('ticker', ticker);

    if (error) return next(error);

    logger.info('Watchlist item removed', { userId: req.user.id, ticker });

    return res.status(200).json({ success: true, message: `${ticker} removed from watchlist` });

  } catch (err) {
    next(err);
  }
};

module.exports = { getAll, add, update, remove };

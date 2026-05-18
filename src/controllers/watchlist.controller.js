'use strict';

const { getAdminClient } = require('../lib/supabase');
const { fetchPricesForTickers } = require('../services/priceRefresh');
const logger = require('../utils/logger');

// =============================================================================
// Watchlist Controller
// =============================================================================

// -----------------------------------------------------------------------------
// GET /api/v1/watchlist
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

    const tickers = items.map(i => i.ticker).filter(t => t !== 'CASH');
    const { data: prices } = await supabase
      .from('price_cache')
      .select('ticker, price, previous_close, change_amount, change_percent, last_fetched_at')
      .in('ticker', tickers);

    const priceMap = {};
    (prices || []).forEach(p => { priceMap[p.ticker] = p; });

    const watchlist = items.map(item => ({
      ...item,
      current_price:  priceMap[item.ticker]?.price || null,
      change_amount:  priceMap[item.ticker]?.change_amount || null,
      change_percent: priceMap[item.ticker]?.change_percent || null,
      price_as_of:    priceMap[item.ticker]?.last_fetched_at || null,
    }));

    return res.status(200).json({ success: true, count: watchlist.length, watchlist });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// GET /api/v1/watchlist/:ticker/history?days=30
// Returns daily close prices for sparkline chart
// -----------------------------------------------------------------------------
const getHistory = async (req, res, next) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const days = parseInt(req.query.days) || 30;

    const YahooFinance = require('yahoo-finance2').default;
    const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

    const period1 = new Date();
    period1.setDate(period1.getDate() - days);

    const result = await yahooFinance.chart(ticker, {
      period1: period1.toISOString().split('T')[0],
      interval: '1d',
    });

    if (!result || !result.quotes || result.quotes.length === 0) {
      return res.status(200).json({ success: true, ticker, history: [] });
    }

    const history = result.quotes
      .filter(q => q.close !== null)
      .map(q => ({
        date:  q.date instanceof Date
          ? q.date.toISOString().split('T')[0]
          : String(q.date).split('T')[0],
        close: q.close,
      }));

    return res.status(200).json({ success: true, ticker, history });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// POST /api/v1/watchlist
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
      }, { onConflict: 'user_id,ticker', ignoreDuplicates: false })
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

    try {
      await fetchPricesForTickers([ticker.toUpperCase()]);
    } catch {
      // Non-fatal
    }

    logger.info('Watchlist item added', { userId: req.user.id, ticker });
    return res.status(201).json({ success: true, item });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// PATCH /api/v1/watchlist/:ticker
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

const search = async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.status(200).json({ success: true, results: [] });
    }

    const YahooFinance = require('yahoo-finance2').default;
    const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

    const result = await yahooFinance.search(q);

    const results = (result.quotes || [])
      .filter(r => r.symbol && r.quoteType !== 'OPTION')
      .slice(0, 8)
      .map(r => ({
        ticker:   r.symbol,
        name:     r.longname || r.shortname || r.symbol,
        exchDisp: r.exchDisp || r.exchange,
        typeDisp: r.typeDisp || r.quoteType,
      }));

    return res.status(200).json({ success: true, results });

  } catch (err) {
    next(err);
  }
};

module.exports = { getAll, getHistory, add, update, remove, search };

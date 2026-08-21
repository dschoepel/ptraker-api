'use strict';

const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({
    suppressNotices: ['yahooSurvey'],
});
const { getAdminClient } = require('../lib/supabase');
const logger = require('../utils/logger');

// =============================================================================
// Price Refresh Service
// =============================================================================
// Fetches current prices from Yahoo Finance for all tickers tracked across
// all users (positions held + watchlist entries) and upserts them into the
// price_cache table.
//
// Called by:
//   1. The nightly + intraday cron jobs (scheduler.js)
//   2. The manual refresh endpoint POST /api/v1/prices/refresh
//
// Price cache is shared across ALL users — if two family members hold AAPL,
// the price is fetched once and shared.
// =============================================================================

// Tickers to skip — these don't have Yahoo Finance quotes
const SKIP_TICKERS = ['CASH'];

// Yahoo Finance quote fields we care about
const QUOTE_FIELDS = [
    'symbol',
    'regularMarketPrice',
    'regularMarketPreviousClose',
    'regularMarketChange',
    'regularMarketChangePercent',
    'currency',
    'marketState',
    'longName',
    'shortName',
];

// =============================================================================
// getAllTrackedTickers
// =============================================================================
// All unique tickers across all users — union of positions held and
// watchlist entries (a ticker on someone's watchlist but never held as a
// position still needs its price kept fresh).
// =============================================================================
const getAllTrackedTickers = async (supabase) => {
    const skipFilter = `(${SKIP_TICKERS.map(t => `"${t}"`).join(',')})`;

    const [{ data: posTickers, error: posError }, { data: wlTickers, error: wlError }] = await Promise.all([
        supabase.from('positions').select('ticker').not('ticker', 'in', skipFilter),
        supabase.from('watchlist').select('ticker').not('ticker', 'in', skipFilter),
    ]);

    if (posError) {
        logger.error('Failed to fetch position tickers', { error: posError.message });
        throw posError;
    }
    if (wlError) {
        logger.error('Failed to fetch watchlist tickers', { error: wlError.message });
        throw wlError;
    }

    const merged = [...(posTickers || []), ...(wlTickers || [])].map(r => r.ticker);
    return [...new Set(merged)].sort();
};

// =============================================================================
// fetchPrices
// =============================================================================
// Main function — fetches prices for all unique tickers across all users
// (positions ∪ watchlist). Returns a summary of what was updated.
// =============================================================================
const fetchPrices = async () => {
    const supabase = getAdminClient();
    const startTime = Date.now();



    logger.info('Price refresh started');

    // Get all unique tickers tracked across all users (positions + watchlist)
    const uniqueTickers = await getAllTrackedTickers(supabase);

    if (uniqueTickers.length === 0) {
        logger.info('No tickers to refresh');
        return { updated: 0, failed: 0, skipped: 0 };
    }

    logger.info(`Fetching prices for ${uniqueTickers.length} tickers`, {
        tickers: uniqueTickers,
    });

    // ==========================================================================
    // Fetch quotes from Yahoo Finance in batches
    // Yahoo Finance can handle multiple symbols in one call via quoteSummary
    // but quoteSync is more reliable for bulk fetches
    // We batch to avoid overwhelming the API
    // ==========================================================================
    const BATCH_SIZE = 10;
    const results = { updated: 0, failed: 0, skipped: 0 };
    const priceRows = [];

    for (let i = 0; i < uniqueTickers.length; i += BATCH_SIZE) {
        const batch = uniqueTickers.slice(i, i + BATCH_SIZE);

        // Fetch each ticker individually — more reliable than bulk for mutual funds
        for (const ticker of batch) {
            try {
                const quote = await yahooFinance.quote(ticker, {
                    fields: QUOTE_FIELDS,
                });

                if (!quote || !quote.regularMarketPrice) {
                    logger.debug(`No price data for ${ticker}`);
                    results.failed++;
                    continue;
                }

                priceRows.push({
                    ticker,
                    price: quote.regularMarketPrice,
                    previous_close: quote.regularMarketPreviousClose || null,
                    change_amount: quote.regularMarketChange || null,
                    change_percent: quote.regularMarketChangePercent || null,
                    currency: quote.currency || 'USD',
                    market_state: quote.marketState || null,
                    last_fetched_at: new Date().toISOString(),
                    fetch_source: 'yahoo',
                });

                results.updated++;
                logger.debug(`Fetched ${ticker}`, {
                    price: quote.regularMarketPrice,
                    change: quote.regularMarketChangePercent?.toFixed(2) + '%',
                });

            } catch (err) {
                logger.warn(`Failed to fetch price for ${ticker}`, {
                    error: err.message,
                });
                results.failed++;
            }

            // Small delay between requests to be polite to Yahoo Finance
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    // Always ensure CASH is priced at $1
    priceRows.push({
        ticker: 'CASH',
        price: 1.00,
        previous_close: 1.00,
        change_amount: 0,
        change_percent: 0,
        currency: 'USD',
        market_state: 'CLOSED',
        last_fetched_at: new Date().toISOString(),
        fetch_source: 'static',
    });

    // ==========================================================================
    // Upsert all price rows in one operation
    // price_cache uses ticker as primary key so this updates existing rows
    // ==========================================================================
    if (priceRows.length > 0) {
        const { error: upsertError } = await supabase
            .from('price_cache')
            .upsert(priceRows, {
                onConflict: 'ticker',
                ignoreDuplicates: false,
            });

        if (upsertError) {
            logger.error('Failed to upsert price cache', {
                error: upsertError.message,
            });
            throw upsertError;
        }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    logger.info('Price refresh complete', {
        ...results,
        durationSeconds: duration,
    });

    return results;
};

// =============================================================================
// fetchPricesForTickers
// =============================================================================
// Fetch prices for a specific list of tickers only.
// Used when new positions are imported — refresh just the new tickers
// rather than waiting for the nightly cron.
// =============================================================================
const fetchPricesForTickers = async (tickers) => {
    const supabase = getAdminClient();

    const toFetch = tickers.filter(t => !SKIP_TICKERS.includes(t));
    if (toFetch.length === 0) return { updated: 0, failed: 0 };

    logger.info(`Fetching prices for ${toFetch.length} specific tickers`, {
        tickers: toFetch,
    });

    const results = { updated: 0, failed: 0 };
    const priceRows = [];

    for (const ticker of toFetch) {
        try {
            const quote = await yahooFinance.quote(ticker, {
                fields: QUOTE_FIELDS,
            });

            if (!quote || !quote.regularMarketPrice) {
                results.failed++;
                continue;
            }

            priceRows.push({
                ticker,
                price: quote.regularMarketPrice,
                previous_close: quote.regularMarketPreviousClose || null,
                change_amount: quote.regularMarketChange || null,
                change_percent: quote.regularMarketChangePercent || null,
                currency: quote.currency || 'USD',
                market_state: quote.marketState || null,
                last_fetched_at: new Date().toISOString(),
                fetch_source: 'yahoo',
            });

            results.updated++;
            await new Promise(resolve => setTimeout(resolve, 100));

        } catch (err) {
            logger.warn(`Failed to fetch price for ${ticker}`, {
                error: err.message,
            });
            results.failed++;
        }
    }

    if (priceRows.length > 0) {
        const { error } = await supabase
            .from('price_cache')
            .upsert(priceRows, { onConflict: 'ticker', ignoreDuplicates: false });

        if (error) {
            logger.error('Failed to upsert prices', { error: error.message });
            throw error;
        }
    }

    return results;
};

module.exports = { fetchPrices, fetchPricesForTickers, getAllTrackedTickers };
'use strict';

// =============================================================================
// Manual Entry "Importer"
// =============================================================================
// Handles direct position entry from the UI — no file upload needed.
//
// Two modes:
//   1. Cash balance — ticker=CASH, balance=dollar amount, shares=balance
//   2. Fund/stock by value — ticker=VTTHX etc, marketValue=dollar amount,
//      shares back-calculated from current price (fetched by controller)
//
// The controller calls parse() with enriched data including currentPrice
// when available.
// =============================================================================

const parse = (data) => {
  const { ticker, balance, marketValue, shares, costBasis, assetName, assetType, currentPrice } = data;

  if (!ticker) {
    return {
      positions: [],
      skipped:   [],
      errors:    [{ message: 'Ticker is required', type: 'validation_error' }],
    };
  }

  const upperTicker = ticker.toUpperCase();
  const isCash = upperTicker === 'CASH' || assetType === 'cash' ||
                 assetType === 'checking' || assetType === 'savings';

  let resolvedShares = null;
  let resolvedCostBasis = parseFloat(costBasis) || 0;

  if (isCash) {
    // Cash — shares = dollar balance
    resolvedShares = Math.abs(parseFloat(balance || marketValue || 0));
    resolvedCostBasis = 0;
  } else if (shares) {
    // Explicit share count provided
    resolvedShares = Math.abs(parseFloat(shares));
  } else if (marketValue && currentPrice && currentPrice > 0) {
    // Back-calculate shares from market value and current price
    resolvedShares = Math.abs(parseFloat(marketValue)) / currentPrice;
    resolvedShares = Math.round(resolvedShares * 1000) / 1000; // 3 decimal places
  } else if (marketValue) {
    // No price available — use market value as shares (1:1 fallback)
    resolvedShares = Math.abs(parseFloat(marketValue));
  }

  if (resolvedShares === null || isNaN(resolvedShares)) {
    return {
      positions: [],
      skipped:   [],
      errors:    [{ message: 'Could not determine share count', type: 'validation_error' }],
    };
  }

  return {
    positions: [{
      accountNumber: null,
      ticker:        isCash ? 'CASH' : upperTicker,
      assetName:     assetName || (isCash ? 'Cash Balance' : upperTicker),
      assetType:     isCash ? 'cash' : (assetType || 'mutual_fund'),
      shares:        resolvedShares,
      costBasis:     resolvedCostBasis,
      asOfDate:      new Date().toISOString().split('T')[0],
      importSource:  'manual',
    }],
    skipped: [],
    errors:  [],
  };
};

module.exports = {
  id:          'manual',
  name:        'Manual Entry',
  accepts:     ['manual'],
  institution: 'manual',
  description: 'Manually enter a position by ticker and value, or a cash balance.',
  isManual:    true,
  parse,
};

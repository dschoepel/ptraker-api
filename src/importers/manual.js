'use strict';

// =============================================================================
// Manual Balance Entry "Importer"
// =============================================================================
// Not a file parser — handles direct balance entry from the UI.
// The controller calls this differently from file importers:
//   parse({ ticker, balance, assetName, assetType, accountNumber })
//
// Used for:
//   - Bank accounts with no recent transactions (empty CSV export)
//   - Cash holdings not tracked by any institution export
//   - Any position you want to enter manually
// =============================================================================

const parse = (data) => {
  const { ticker, balance, assetName, assetType, accountNumber } = data;

  if (!ticker || balance === undefined || balance === null) {
    return {
      positions: [],
      skipped: [],
      errors: [{ message: 'Ticker and balance are required', type: 'validation_error' }],
    };
  }

  const isCash = ticker === 'CASH' ||
                 assetType === 'cash' ||
                 assetType === 'checking' ||
                 assetType === 'savings';

  return {
    positions: [{
      accountNumber: accountNumber || null,
      ticker:        isCash ? 'CASH' : ticker.toUpperCase(),
      assetName:     assetName || (isCash ? 'Cash Balance' : ticker.toUpperCase()),
      assetType:     isCash ? 'cash' : (assetType || 'other'),
      shares:        Math.abs(parseFloat(balance)),
      costBasis:     isCash ? 0 : parseFloat(balance),
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
  accepts:     ['manual'], // not a file format
  institution: 'manual',
  description: 'Manually enter a balance or position value directly.',
  isManual:    true, // flag for UI to show form instead of file upload
  parse,
};

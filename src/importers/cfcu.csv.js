'use strict';

// =============================================================================
// CFCU (Community First Credit Union) CSV Importer
// =============================================================================
// Parses the transaction history CSV export from CFCU online banking.
//
// To export from CFCU:
//   1. Log in to cfcu.org
//   2. Select account → Transaction History
//   3. Export → Comma Separated (.csv)
//   4. You can export multiple accounts in one file or separately
//
// Format: transaction history with running balance
//   Account ID, Transaction ID, Date, Name, Description, Check Number,
//   Category, Tags, Amount, Balance
//
// Strategy: group rows by Account ID, take the most recent row's Balance
// as the current cash balance for that account.
// =============================================================================

const Papa = require('papaparse');

// Parse currency string to float
// Handles: "$2,727.67", "-$231.34", "$60,589.83"
const parseCurrency = (value) => {
  if (!value) return null;
  const cleaned = value.toString().trim().replace(/[$,\s"]/g, '').replace(/^\((.+)\)$/, '-$1');
  if (cleaned === '' || cleaned === '-') return null;
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
};

// Extract last 4 digits from account ID
const getLast4 = (accountId) => {
  if (!accountId) return null;
  return accountId.toString().trim().slice(-4);
};

const parse = (fileBuffer) => {
  const positions = [];
  const skipped   = [];
  const errors    = [];

  // Strip BOM if present
  const buf = fileBuffer[0] === 0xEF && fileBuffer[1] === 0xBB && fileBuffer[2] === 0xBF
    ? fileBuffer.slice(3)
    : fileBuffer;
  const csvString = buf.toString('utf8');

  const result = Papa.parse(csvString, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0) {
    result.errors.forEach(err => {
      errors.push({ row: err.row, message: err.message, type: 'parse_error' });
    });
  }

  if (result.data.length === 0) {
    errors.push({ message: 'No transaction data found in file', type: 'empty_file' });
    return { positions, skipped, errors };
  }

  // Group rows by Account ID — keep only the first (most recent) row per account
  // CSV is ordered newest first so first row = current balance
  const accountMap = new Map();

  for (const row of result.data) {
    const accountId = row['Account ID']?.toString().trim();
    if (!accountId) {
      skipped.push({ reason: 'no_account_id', row });
      continue;
    }

    // Only keep the first (most recent) row per account
    if (!accountMap.has(accountId)) {
      accountMap.set(accountId, row);
    }
  }

  // Build a position for each account
  for (const [accountId, row] of accountMap.entries()) {
    const balance = parseCurrency(row['Balance']);
    const date    = row['Date']?.trim();

    if (balance === null) {
      errors.push({
        accountId,
        message: `Could not parse balance for account ${accountId}`,
        type: 'parse_error',
      });
      continue;
    }

    // Parse date — CFCU format: "05/18/26"
    let asOfDate = null;
    if (date) {
      const parts = date.split('/');
      if (parts.length === 3) {
        const [month, day, year] = parts;
        const fullYear = parseInt(year) < 100 ? 2000 + parseInt(year) : parseInt(year);
        const d = new Date(fullYear, parseInt(month) - 1, parseInt(day));
        if (!isNaN(d.getTime())) {
          asOfDate = d.toISOString().split('T')[0];
        }
      }
    }

    positions.push({
      accountNumber:  accountId,
      accountLast4:   getLast4(accountId),

      // Cash position — balance is the dollar amount
      ticker:         'CASH',
      assetName:      'Cash Balance',
      assetType:      'cash',

      shares:         Math.abs(balance), // balance = dollar amount for cash
      costBasis:      0,
      costBasisPerShare: null,

      exportPrice:    1.00,
      asOfDate,
      importSource:   'cfcu_csv',
    });
  }

  return { positions, skipped, errors };
};

module.exports = {
  id:          'cfcu_csv',
  name:        'CFCU (Community First CU) CSV',
  accepts:     ['csv'],
  institution: 'cfcu',
  description: 'Parses transaction history CSV from Community First Credit Union. Uses most recent balance per account.',
  parse,
};

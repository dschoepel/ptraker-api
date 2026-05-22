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

// Parse currency string to float — handles "$2,727.67", "-$231.34"
const parseCurrency = (value) => {
  if (!value) return null;
  const cleaned = value.toString().trim().replace(/[$,\s"]/g, '').replace(/^\((.+)\)$/, '-$1');
  if (cleaned === '' || cleaned === '-') return null;
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
};

const getLast4 = (accountId) => {
  if (!accountId) return null;
  return accountId.toString().trim().slice(-4);
};

// Parse CFCU date format "05/18/26" → "2026-05-18"
const parseDate = (dateStr) => {
  if (!dateStr) return null;
  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) return null;
  const [month, day, year] = parts;
  const fullYear = parseInt(year) < 100 ? 2000 + parseInt(year) : parseInt(year);
  const d = new Date(fullYear, parseInt(month) - 1, parseInt(day));
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
};

// Core parse — returns grouped positions keyed by account last4
const parseBuffer = (fileBuffer) => {
  const errors = [];

  const buf = fileBuffer[0] === 0xEF && fileBuffer[1] === 0xBB && fileBuffer[2] === 0xBF
    ? fileBuffer.slice(3)
    : fileBuffer;

  const result = Papa.parse(buf.toString('utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  result.errors.forEach(err =>
    errors.push({ row: err.row, message: err.message, type: 'parse_error' })
  );

  if (result.data.length === 0) {
    errors.push({ message: 'No transaction data found in file', type: 'empty_file' });
    return { accountMap: new Map(), errors };
  }

  // Group by Account ID — keep only first (most recent) row per account
  const accountMap = new Map();
  for (const row of result.data) {
    const accountId = row['Account ID']?.toString().trim();
    if (!accountId) continue;
    if (!accountMap.has(accountId)) {
      accountMap.set(accountId, row);
    }
  }

  return { accountMap, errors };
};

// Build a single position from an account row
const buildPosition = (accountId, row) => {
  const balance = parseCurrency(row['Balance']);
  if (balance === null) return null;

  return {
    ticker:      'CASH',
    asset_name:  'Cash Balance',
    asset_type:  'cash',
    shares:      Math.abs(balance),
    cost_basis:  0,
    as_of_date:  parseDate(row['Date']) || new Date().toISOString().split('T')[0],
    accountLast4: getLast4(accountId),
  };
};

// ---------------------------------------------------------------------------
// parseMulti — multi-account path (used by upload controller)
// Returns { accounts: [{ acctId, positions[] }], errors[] }
// ---------------------------------------------------------------------------
const parseMulti = (fileBuffer) => {
  const { accountMap, errors } = parseBuffer(fileBuffer);
  const accounts = [];

  for (const [accountId, row] of accountMap.entries()) {
    const position = buildPosition(accountId, row);
    if (!position) {
      errors.push({ accountId, message: `Could not parse balance for account ${accountId}`, type: 'parse_error' });
      continue;
    }
    accounts.push({ acctId: getLast4(accountId), positions: [position] });
  }

  return { accounts, errors };
};

// ---------------------------------------------------------------------------
// matchAccounts — standard last4 matching (same pattern as LPL/OFX)
// ---------------------------------------------------------------------------
const matchAccounts = (parsedAccounts, dbAccounts) => {
  const matched   = [];
  const unmatched = [];

  for (const parsed of parsedAccounts) {
    const last4  = String(parsed.acctId).slice(-4);
    const dbAcct = dbAccounts.find(a => String(a.account_number_last4).trim() === last4);
    if (dbAcct) {
      matched.push({ parsed, dbAcct });
    } else {
      unmatched.push(parsed.acctId);
    }
  }

  return { matched, unmatched };
};

module.exports = {
  id:           'cfcu_csv',
  name:         'CFCU (Community First CU) CSV',
  description:  'Transaction history CSV from Community First Credit Union. Auto-matches accounts by last 4 digits.',
  fileTypes:    ['.csv'],
  institutions: ['cfcu'],
  multiAccount: true,
  parseMulti,
  matchAccounts,
};

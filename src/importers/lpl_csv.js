/**
 * LPL Financial CSV Importer — multi-account
 *
 * Supports the "All Accounts" position export from LPL ClientWorks/BranchNet.
 * Handles quoted newlines inside description fields (LPL wraps long names).
 *
 * Columns (0-indexed):
 *   0  Account Number    — full account number, last 4 used for DB matching
 *   3  Symbol/CUSIP      — ticker; 9999227=CASH, ----=skip
 *   4  Description       — security name (may contain embedded newlines in quotes)
 *   5  Quantity          — shares (may have commas/spaces)
 *   6  Price ($)         — unit price (may have $ and commas)
 *  10  Unit Cost
 *  11  Cost Basis ($)
 *  15  Security Type Description
 */

'use strict';

// ---------------------------------------------------------------------------
// Proper RFC 4180 CSV parser — handles quoted newlines and escaped quotes.
// Newlines inside quoted fields are collapsed to a single space.
// ---------------------------------------------------------------------------
function parseCSV(text) {
  const rows = [];
  let col = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch   = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        col += '"'; i++;                // escaped quote ""
      } else if (ch === '"') {
        inQuotes = false;               // end of quoted field
      } else if (ch === '\r' || ch === '\n') {
        col += ' ';                     // embedded newline → space
        if (ch === '\r' && next === '\n') i++;
      } else {
        col += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(col.trim()); col = '';
      } else if (ch === '\r' || ch === '\n') {
        row.push(col.trim()); col = '';
        if (row.some(c => c)) rows.push(row);
        row = [];
        if (ch === '\r' && next === '\n') i++;
      } else {
        col += ch;
      }
    }
  }
  // flush last field / row
  if (col.trim()) row.push(col.trim());
  if (row.some(c => c)) rows.push(row);
  return rows;
}

// ---------------------------------------------------------------------------
// Parse a dollar/number string like "$1,234.56 " → 1234.56
// ---------------------------------------------------------------------------
function parseMoney(str) {
  if (!str || str.trim() === '-' || str.trim() === '') return null;
  const cleaned = str.replace(/[$,%\s]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

// ---------------------------------------------------------------------------
// Determine asset_type from LPL Security Type Description + ticker
// ---------------------------------------------------------------------------
function resolveAssetType(secTypeDesc, ticker) {
  if (!ticker || ticker === 'CASH') return 'cash';
  const desc = (secTypeDesc || '').toLowerCase();
  if (desc.includes('money market'))                    return 'cash';
  if (desc.includes('open-end'))                        return 'mutual_fund';
  if (desc.includes('closed-end') || desc.includes('etf')) return 'etf';
  if (desc.includes('mutual'))                          return 'mutual_fund';
  if (desc.includes('equity') || desc.includes('common')) return 'stock';
  return 'stock';
}

// ---------------------------------------------------------------------------
// Parse the full CSV buffer → { accounts: [{ acctId, positions[] }], errors[] }
// ---------------------------------------------------------------------------
function parseLPLCSV(fileBuffer) {
  const raw  = typeof fileBuffer === 'string' ? fileBuffer : fileBuffer.toString('utf-8');
  const text = raw.replace(/^\uFEFF/, '');  // strip UTF-8 BOM

  const allRows = parseCSV(text);
  if (allRows.length < 2) return { accounts: [], errors: ['File appears empty'] };

  // Skip header row (index 0)
  const dataRows = allRows.slice(1);
  const accountMap = new Map();

  for (const cols of dataRows) {
    if (cols.length < 6) continue;

    const acctId      = cols[0]?.trim();
    const symbol      = cols[3]?.trim();
    const description = cols[4]?.trim();
    const secTypeDesc = cols[15]?.trim() || '';

    if (!acctId || !symbol) continue;
    if (symbol === '----') continue;  // blank LPL cash placeholder row

    const isCash = symbol === '9999227';
    const ticker = isCash ? 'CASH' : symbol.toUpperCase();

    const shares    = parseMoney(cols[5]);
    const price     = parseMoney(cols[6]);
    const unitCost  = parseMoney(cols[10]);
    const costBasis = parseMoney(cols[11]);

    if (shares === null || shares === 0) continue;

    const position = {
      ticker,
      asset_name:    isCash ? 'Cash' : (description || ticker),
      asset_type:    resolveAssetType(secTypeDesc, ticker),
      shares,
      current_price: isCash ? 1.0 : price,
      cost_basis:    isCash ? 0 : (costBasis !== null ? costBasis : 0),
      unit_cost:     unitCost,
    };

    if (!accountMap.has(acctId)) accountMap.set(acctId, []);
    accountMap.get(acctId).push(position);
  }

  const accounts = [];
  for (const [acctId, positions] of accountMap) {
    accounts.push({ acctId, positions });
  }

  return { accounts, errors: [] };
}

// ---------------------------------------------------------------------------
// Match parsed accounts to DB accounts by last-4 of account number
// ---------------------------------------------------------------------------
function matchAccounts(parsedAccounts, dbAccounts) {
  const matched   = [];
  const unmatched = [];

  for (const parsed of parsedAccounts) {
    const last4  = String(parsed.acctId).slice(-4);
    const dbAcct = dbAccounts.find(a => String(a.account_number_last4).trim() === last4);

    if (dbAcct) matched.push({ parsed, dbAcct });
    else        unmatched.push(parsed.acctId);
  }

  return { matched, unmatched };
}

// ---------------------------------------------------------------------------
// Legacy single-account parse — kept for backward compat
// ---------------------------------------------------------------------------
function parse(fileBuffer) {
  const { accounts } = parseLPLCSV(fileBuffer);
  return accounts.flatMap(a => a.positions);
}

module.exports = {
  id:           'lpl_csv',
  name:         'LPL Financial CSV',
  description:  'Position export from LPL ClientWorks — single or all-accounts CSV',
  fileTypes:    ['.csv'],
  institutions: ['lpl'],
  multiAccount: true,
  parseMulti:   parseLPLCSV,   // standard multi-account interface
  parseLPLCSV,                 // keep for direct use
  matchAccounts,
  parse,                       // legacy single-account compat
};

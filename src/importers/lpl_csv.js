/**
 * LPL Financial CSV Importer — multi-account
 *
 * Supports the "All Accounts" position export from LPL ClientWorks/BranchNet.
 * Handles quoted newlines inside description fields (LPL wraps long names).
 *
 * Columns are located by HEADER NAME, not position — LPL has changed the
 * column order before (Nov 2026: 15-column layout, Symbol/CUSIP moved to
 * column 2). Required headers: Account Number, Symbol/CUSIP, Quantity.
 * Optional: Description, Price ($), Unit Cost, Cost Basis ($),
 * Security Type Description.
 *
 * Symbol/CUSIP 9999227 = CASH, ---- = skip.
 * Files without recognizable headers fall back to the legacy fixed layout
 * (3=Symbol, 4=Description, 5=Quantity, 6=Price, 10=Unit Cost,
 * 11=Cost Basis, 15=Security Type) only if rows have >= 16 columns;
 * otherwise the parse fails with an error rather than importing garbage.
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
// Column resolution — header name → index
// ---------------------------------------------------------------------------
const normalizeHeader = (h) => String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');

const COLUMN_HEADERS = {
  acctId:      'account number',
  symbol:      'symbol/cusip',
  description: 'description',
  quantity:    'quantity',
  price:       'price ($)',
  unitCost:    'unit cost',
  costBasis:   'cost basis ($)',
  secType:     'security type description',
};
const REQUIRED_COLUMNS = ['acctId', 'symbol', 'quantity'];

// Legacy fixed layout used before LPL's Nov 2026 export change
const LEGACY_COLUMNS = {
  acctId: 0, symbol: 3, description: 4, quantity: 5, price: 6,
  unitCost: 10, costBasis: 11, secType: 15,
};
const LEGACY_MIN_COLS = 16;

function resolveColumns(headerRow, dataRows) {
  const index = new Map(headerRow.map((h, i) => [normalizeHeader(h), i]));
  const cols = {};
  for (const [key, name] of Object.entries(COLUMN_HEADERS)) {
    cols[key] = index.has(name) ? index.get(name) : -1;
  }
  const missing = REQUIRED_COLUMNS.filter(k => cols[k] < 0);
  if (missing.length === 0) return { cols };

  const looksLegacy = dataRows.length > 0 && dataRows.every(r => r.length >= LEGACY_MIN_COLS);
  if (looksLegacy) return { cols: { ...LEGACY_COLUMNS } };

  return {
    error: 'Unrecognized LPL CSV layout — missing columns: ' +
      missing.map(k => COLUMN_HEADERS[k]).join(', '),
  };
}

// Tickers and 9-char CUSIPs — rejects descriptions/numbers landing in the symbol slot
const VALID_SYMBOL = /^[A-Z0-9.\-\/]{1,12}$/;

// ---------------------------------------------------------------------------
// Parse the full CSV buffer → { accounts: [{ acctId, positions[] }], errors[] }
// ---------------------------------------------------------------------------
function parseLPLCSV(fileBuffer) {
  const raw  = typeof fileBuffer === 'string' ? fileBuffer : fileBuffer.toString('utf-8');
  const text = raw.replace(/^\uFEFF/, '');  // strip UTF-8 BOM

  const allRows = parseCSV(text);
  if (allRows.length < 2) return { accounts: [], errors: ['File appears empty'] };

  const dataRows = allRows.slice(1);
  const { cols: c, error } = resolveColumns(allRows[0], dataRows);
  if (error) return { accounts: [], errors: [error] };

  const get = (row, key) => (c[key] >= 0 ? row[c[key]]?.trim() : undefined);
  const minLen = Math.max(...REQUIRED_COLUMNS.map(k => c[k])) + 1;

  const accountMap = new Map();
  const errors = [];

  for (const cols of dataRows) {
    if (cols.length < minLen) continue;

    const acctId      = get(cols, 'acctId');
    const symbol      = get(cols, 'symbol');
    const description = get(cols, 'description');
    const secTypeDesc = get(cols, 'secType') || '';

    if (!acctId || !symbol) continue;
    if (symbol === '----') continue;  // blank LPL cash placeholder row

    const isCash = symbol === '9999227';
    const ticker = isCash ? 'CASH' : symbol.toUpperCase();

    if (!isCash && !VALID_SYMBOL.test(ticker)) {
      errors.push(`Skipped row with invalid symbol "${symbol}" (account ...${String(acctId).slice(-4)})`);
      continue;
    }

    const shares    = parseMoney(get(cols, 'quantity'));
    const price     = parseMoney(get(cols, 'price'));
    const unitCost  = parseMoney(get(cols, 'unitCost'));
    const costBasis = parseMoney(get(cols, 'costBasis'));

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

  return { accounts, errors };
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

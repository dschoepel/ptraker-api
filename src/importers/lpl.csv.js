'use strict';

// =============================================================================
// LPL Financial CSV Importer
// =============================================================================
// Parses the CSV export from LPL Financial's account positions page.
//
// To export from LPL:
//   1. Log in to lplfinancial.com
//   2. Go to Accounts → Positions
//   3. Select the account
//   4. Click Export → CSV
//
// Expected columns:
//   Account Number, Account Name, Account Nick Name, Symbol/CUSIP,
//   Description, Quantity, Price ($), Day Change ($), Value ($),
//   Price as Of, Unit Cost, Cost Basis ($), Unrealized G/L ($),
//   Unrealized G/L (%), Held In, Security Type Description
// =============================================================================

const Papa = require('papaparse');

// Maps LPL's Security Type Description to our internal asset_type values
const SECURITY_TYPE_MAP = {
  'mutual fund - open-end':   'mutual_fund',
  'mutual fund - closed-end': 'etf',
  'cash':                     'cash',
  'money market':             'cash',
  'equity':                   'stock',
  'common stock':             'stock',      // ← add this
  'etf':                      'etf',
  'exchange traded fund':     'etf',        // ← add this just in case
  'fixed income':             'other',
  'alternative':              'other',
};

// Tickers to treat as cash positions
const CASH_TICKERS = ['----', '9999227', 'CASH'];

// =============================================================================
// Helper: Parse a currency string to a float
// Handles: "$1,234.56 ", "1234.56", "-", "$1.00"
// Returns null for dash or empty values
// =============================================================================
const parseCurrency = (value) => {
    if (!value) return null;
    const cleaned = value.toString().trim().replace(/[$,\s]/g, '');
    if (cleaned === '-' || cleaned === '' || cleaned === '--') return null;
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
};

// =============================================================================
// Helper: Parse a quantity/shares string to a float
// Handles: "209.46 ", "1,569.32 ", "-"
// =============================================================================
const parseQuantity = (value) => {
    if (!value) return null;
    const cleaned = value.toString().trim().replace(/[,\s]/g, '');
    if (cleaned === '-' || cleaned === '') return null;
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
};

// =============================================================================
// Helper: Parse LPL date string to ISO date
// Handles: "5/15/26 03:00 AM ET"
// =============================================================================
const parseDate = (value) => {
    if (!value) return null;
    // Extract just the date part "5/15/26"
    const datePart = value.toString().trim().split(' ')[0];
    if (!datePart) return null;

    const parts = datePart.split('/');
    if (parts.length !== 3) return null;

    const [month, day, year] = parts;
    // LPL uses 2-digit year — assume 2000s
    const fullYear = parseInt(year) < 100
        ? 2000 + parseInt(year)
        : parseInt(year);

    const date = new Date(fullYear, parseInt(month) - 1, parseInt(day));
    return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
};

// =============================================================================
// Helper: Map security type to internal asset_type
// =============================================================================
const mapAssetType = (securityTypeDesc) => {
    if (!securityTypeDesc) return 'other';
    const key = securityTypeDesc.toLowerCase().trim();
    return SECURITY_TYPE_MAP[key] || 'other';
};

// =============================================================================
// Main parse function
// =============================================================================
// Input:  fileBuffer — Buffer or string of the CSV file contents
// Output: { positions, skipped, errors }
//   positions — array of normalized position objects ready for DB upsert
//   skipped   — rows that were intentionally skipped (cash rows, etc.)
//   errors    — rows that failed to parse
// =============================================================================
const parse = (fileBuffer) => {
    const positions = [];
    const skipped = [];
    const errors = [];

    // Convert buffer to string and strip BOM character if present
    const csvString = fileBuffer
        .toString('utf8')
        .replace(/^\uFEFF/, '');

    // Parse CSV with PapaParse
    const result = Papa.parse(csvString, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
    });

        if (result.errors.length > 0) {
        // Non-fatal parse errors — log them but continue
        result.errors.forEach(err => {
            errors.push({
                row: err.row,
                message: err.message,
                type: 'parse_error',
            });
        });
    }

    for (const row of result.data) {
        const ticker = row['Symbol/CUSIP']?.trim();
        // Handle BOM on first column header
        const accountNumber = (row['Account Number'] || row['\uFEFFAccount Number'])?.toString().trim();
        const securityType = row['Security Type Description']?.trim();

        // Skip rows with no ticker
        if (!ticker) {
            skipped.push({ reason: 'no_ticker', row });
            continue;
        }

        // Skip the bare CASH row (Symbol/CUSIP = "----")
        if (ticker === '----') {
            skipped.push({ reason: 'cash_placeholder', ticker, accountNumber });
            continue;
        }

        const quantity = parseQuantity(row['Quantity']);
        const unitCost = parseCurrency(row['Unit Cost']);
        const costBasis = parseCurrency(row['Cost Basis ($)']);
        const price = parseCurrency(row['Price ($)']);
        const asOfDate = parseDate(row['Price as Of']);

        // Skip rows with zero or null quantity
        if (quantity === null || quantity === 0) {
            skipped.push({ reason: 'zero_quantity', ticker, accountNumber });
            continue;
        }

        // Determine if this is a cash-type position
        const isCash = CASH_TICKERS.includes(ticker) ||
            securityType?.toLowerCase() === 'cash' ||
            securityType?.toLowerCase() === 'money market';

        const position = {
            // Account identification — used by the controller to find the account_id
            accountNumber,
            accountNickName: row['Account Nick Name']?.trim(),

            // Asset details
            ticker: isCash ? 'CASH' : ticker.toUpperCase(),
            assetName: row['Description']?.trim() || ticker,
            assetType: isCash ? 'cash' : mapAssetType(securityType),

            // Holdings
            shares: quantity,
            costBasis: costBasis,
            costBasisPerShare: unitCost,

            // Price data from the export (used as fallback if Yahoo Finance fails)
            exportPrice: price,
            asOfDate,

            // Import metadata
            importSource: 'lpl_csv',
        };

        positions.push(position);
    }

    return { positions, skipped, errors };
};

// =============================================================================
// Plugin interface — all importers export this same shape
// =============================================================================
module.exports = {
    id: 'lpl_csv',
    name: 'LPL Financial CSV',
    accepts: ['csv'],
    institution: 'lpl',
    description: 'Parses the CSV position export from LPL Financial',
    parse,
};
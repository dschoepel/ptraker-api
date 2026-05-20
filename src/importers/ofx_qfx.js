/**
 * Generic OFX/QFX Importer
 *
 * Handles investment position files from any institution that exports OFX/QFX:
 *   - LPL Financial (.qfx)
 *   - Community First CU (.ofx / .qfx)
 *   - Merrill, Schwab, Fidelity, etc.
 *
 * What it does:
 *   1. Strips QFX headers above <OFX>
 *   2. Parses SGML-style OFX (unclosed tags) into a JS object
 *   3. Builds a CUSIP → ticker/name map from <SECLIST>
 *   4. Extracts current positions from <INVPOSLIST> in each <INVSTMTTRNRS>
 *   5. Returns { acctId, positions[] } for each account in the file
 *
 * Does NOT use Yahoo Finance — tickers come from <SECLIST> embedded in the file.
 */

'use strict';

// ---------------------------------------------------------------------------
// SGML parser — OFX uses unclosed tags like <UNITS>242.446 (not XML)
// ---------------------------------------------------------------------------

/**
 * Parse OFX SGML into a nested plain object.
 * Aggregate tags (e.g. <INVPOS>) become objects.
 * Value tags (e.g. <UNITS>242.446) become string values on the parent.
 */
function parseOFXSGML(text) {
  // Normalise line endings and collapse whitespace between tags
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  const result = {};
  const stack = [result];
  const tagPattern = /<([^>]+)>([^<]*)/g;
  let match;

  while ((match = tagPattern.exec(cleaned)) !== null) {
    const [, tag, rawValue] = match;
    const value = rawValue.trim();

    if (tag.startsWith('/')) {
      // Closing tag — pop stack
      if (stack.length > 1) stack.pop();
    } else if (value === '') {
      // Opening aggregate tag — push new object
      const node = {};
      const parent = stack[stack.length - 1];
      if (Array.isArray(parent[tag])) {
        parent[tag].push(node);
      } else if (parent[tag] !== undefined) {
        parent[tag] = [parent[tag], node];
      } else {
        parent[tag] = node;
      }
      stack.push(node);
    } else {
      // Value tag — set on current node
      const parent = stack[stack.length - 1];
      parent[tag] = value;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helper — always return an array (handles single item vs array from parser)
// ---------------------------------------------------------------------------
function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

// ---------------------------------------------------------------------------
// Build CUSIP → { ticker, name } map from <SECLIST>
// ---------------------------------------------------------------------------
function buildSecurityMap(ofxObj) {
  const map = {};
  const seclist = ofxObj?.OFX?.SECLISTMSGSRSV1?.SECLIST;
  if (!seclist) return map;

  const secTypes = ['STOCKINFO', 'MFINFO', 'OTHERINFO', 'DEBTINFO', 'OPTINFO'];
  for (const type of secTypes) {
    for (const entry of toArray(seclist[type])) {
      const info = entry?.SECINFO;
      if (!info) continue;
      const cusip = info?.SECID?.UNIQUEID;
      const ticker = info?.TICKER || null;
      const name = info?.SECNAME || null;
      if (cusip) map[cusip] = { ticker, name };
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Determine asset_type from OFX position tag + CUSIP
// ---------------------------------------------------------------------------
function resolveAssetType(posTag, cusip) {
  if (cusip === '9999227') return 'cash';
  if (posTag === 'POSMF') return 'mutual_fund';
  if (posTag === 'POSOTHER') return 'cash'; // non-9999227 POSOTHER treated as cash
  // POSSTOCK — could be ETF or stock; we'll mark 'stock' and let price refresh
  // distinguish later via Yahoo (or leave as-is — dashboard shows asset_type label)
  return 'stock';
}

// ---------------------------------------------------------------------------
// Parse a single <INVPOSLIST> block → array of position objects
// ---------------------------------------------------------------------------
function parsePositions(invposlist, secMap) {
  const positions = [];
  const posTags = ['POSSTOCK', 'POSMF', 'POSOTHER', 'POSDEBT', 'POSOPT'];

  for (const posTag of posTags) {
    for (const posEntry of toArray(invposlist[posTag])) {
      const invpos = posEntry?.INVPOS;
      if (!invpos) continue;

      const cusip = invpos?.SECID?.UNIQUEID;
      if (!cusip) continue;

      const security = secMap[cusip] || {};
      const ticker = security.ticker || cusip; // fallback to CUSIP if no ticker
      const assetName = security.name || ticker;
      const assetType = resolveAssetType(posTag, cusip);

      const units = parseFloat(invpos.UNITS || 0);
      const unitPrice = parseFloat(invpos.UNITPRICE || 0);
      const mktval = parseFloat(invpos.MKTVAL || 0);

      // Skip zero-unit positions
      if (units === 0) continue;

      positions.push({
        ticker: ticker.toUpperCase(),
        asset_name: assetName,
        asset_type: assetType,
        shares: units,
        current_price: unitPrice,
        market_value: mktval,
        cusip,
        price_date: invpos.DTPRICEASOF
          ? parseDateOFX(invpos.DTPRICEASOF)
          : null,
      });
    }
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Parse OFX date format: YYYYMMDDHHMMSS[.mmm][ZZZ] → ISO string
// ---------------------------------------------------------------------------
function parseDateOFX(dtStr) {
  if (!dtStr) return null;
  const s = String(dtStr).replace(/\[.*\]/, '').trim();
  // Minimum: YYYYMMDD
  if (s.length < 8) return null;
  const year = s.slice(0, 4);
  const month = s.slice(4, 6);
  const day = s.slice(6, 8);
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Main parse function — called by the import controller
//
// Returns:
//   {
//     accounts: [
//       {
//         acctId: '25620878',        // from <ACCTID>
//         brokerId: 'LPL.COM',       // from <BROKERID>
//         dtAsOf: '2026-05-20',      // statement date
//         positions: [
//           {
//             ticker, asset_name, asset_type,
//             shares, current_price, market_value,
//             cusip, price_date,
//           },
//           ...
//         ]
//       },
//       ...
//     ],
//     errors: [],   // non-fatal warnings
//   }
// ---------------------------------------------------------------------------
function parseOFXFile(fileBuffer) {
  const raw = typeof fileBuffer === 'string'
    ? fileBuffer
    : fileBuffer.toString('utf-8');

  // Strip QFX/OFX file-level headers (everything before <OFX>)
  const ofxStart = raw.indexOf('<OFX>');
  if (ofxStart === -1) {
    throw new Error('Not a valid OFX/QFX file — <OFX> tag not found');
  }
  const ofxText = raw.slice(ofxStart);

  // Parse SGML
  const ofxObj = parseOFXSGML(ofxText);

  // Build security map from embedded <SECLIST>
  const secMap = buildSecurityMap(ofxObj);

  // Extract per-account data from investment statement blocks
  const stmtBlocks = toArray(
    ofxObj?.OFX?.INVSTMTMSGSRSV1?.INVSTMTTRNRS
  );

  if (stmtBlocks.length === 0) {
    throw new Error('No investment statement blocks found in OFX file');
  }

  const errors = [];
  const accounts = [];

  for (const block of stmtBlocks) {
    const stmtrs = block?.INVSTMTRS;
    if (!stmtrs) continue;

    const acctId = stmtrs?.INVACCTFROM?.ACCTID;
    const brokerId = stmtrs?.INVACCTFROM?.BROKERID || null;
    const dtAsOf = parseDateOFX(stmtrs?.DTASOF);

    if (!acctId) {
      errors.push('Skipped a statement block — no <ACCTID> found');
      continue;
    }

    const invposlist = stmtrs?.INVPOSLIST;
    if (!invposlist) {
      errors.push(`Account ${acctId}: no <INVPOSLIST> block`);
      accounts.push({ acctId, brokerId, dtAsOf, positions: [] });
      continue;
    }

    const positions = parsePositions(invposlist, secMap);
    accounts.push({ acctId, brokerId, dtAsOf, positions });
  }

  return { accounts, errors };
}

// ---------------------------------------------------------------------------
// Match parsed accounts to DB accounts (called by controller)
//
// Tries to match on last 4 digits of account_number_last4.
// Returns matched pairs and any unmatched account IDs.
// ---------------------------------------------------------------------------
function matchAccounts(parsedAccounts, dbAccounts) {
  const matched = [];
  const unmatched = [];

  for (const parsed of parsedAccounts) {
    const last4 = String(parsed.acctId).slice(-4);
    const dbAcct = dbAccounts.find(a => String(a.account_number_last4).trim() === last4);

    if (dbAcct) {
      matched.push({ parsed, dbAcct });
    } else {
      unmatched.push(parsed.acctId);
    }
  }

  return { matched, unmatched };
}

module.exports = {
  id: 'ofx_qfx',
  name: 'OFX / QFX (Generic)',
  description: 'Investment positions from any OFX or QFX file (LPL, CFCU, Merrill, Schwab, etc.)',
  fileTypes: ['.ofx', '.qfx'],
  institutions: ['lpl', 'cfcu', 'merrill', 'schwab', 'fidelity', 'other'],
  multiAccount: true,
  parseMulti: parseOFXFile,    // standard multi-account interface
  parseOFXFile,                // keep for direct use
  matchAccounts,
};

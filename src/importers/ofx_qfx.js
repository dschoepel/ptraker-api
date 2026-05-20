/**
 * Generic OFX/QFX Importer
 *
 * Handles two OFX message types automatically:
 *
 *   INVESTMENT files (LPL, Merrill, Schwab, etc.)
 *     <INVSTMTMSGSRSV1> → extracts positions from <INVPOSLIST>
 *     Tickers come from embedded <SECLIST> — no Yahoo lookup needed
 *
 *   BANK files (CFCU checking/savings/money market)
 *     <BANKMSGSRSV1> → extracts current balance from <LEDGERBAL>
 *     Creates a single CASH position per account
 *
 * Both types auto-match to DB accounts by last 4 digits of account number.
 */

'use strict';

// ---------------------------------------------------------------------------
// SGML parser — OFX uses unclosed tags like <UNITS>242.446 (not XML)
// ---------------------------------------------------------------------------
function parseOFXSGML(text) {
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const result = {};
  const stack = [result];
  const tagPattern = /<([^>]+)>([^<]*)/g;
  let match;

  while ((match = tagPattern.exec(cleaned)) !== null) {
    const [, tag, rawValue] = match;
    const value = rawValue.trim();

    if (tag.startsWith('/')) {
      if (stack.length > 1) stack.pop();
    } else if (value === '') {
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
      stack[stack.length - 1][tag] = value;
    }
  }
  return result;
}

function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

// ---------------------------------------------------------------------------
// Parse OFX date: YYYYMMDDHHMMSS.mmm → YYYY-MM-DD
// ---------------------------------------------------------------------------
function parseDateOFX(dtStr) {
  if (!dtStr) return null;
  const s = String(dtStr).replace(/\[.*\]/, '').trim();
  if (s.length < 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

// ---------------------------------------------------------------------------
// Build CUSIP → { ticker, name } map from <SECLIST>
// ---------------------------------------------------------------------------
function buildSecurityMap(ofxObj) {
  const map = {};
  const seclist = ofxObj?.OFX?.SECLISTMSGSRSV1?.SECLIST;
  if (!seclist) return map;

  for (const type of ['STOCKINFO', 'MFINFO', 'OTHERINFO', 'DEBTINFO', 'OPTINFO']) {
    for (const entry of toArray(seclist[type])) {
      const info = entry?.SECINFO;
      if (!info) continue;
      const cusip = info?.SECID?.UNIQUEID;
      if (cusip) map[cusip] = { ticker: info?.TICKER || null, name: info?.SECNAME || null };
    }
  }
  return map;
}

function resolveAssetType(posTag, cusip) {
  if (cusip === '9999227') return 'cash';
  if (posTag === 'POSMF')    return 'mutual_fund';
  if (posTag === 'POSOTHER') return 'cash';
  return 'stock';
}

// ---------------------------------------------------------------------------
// Parse <INVPOSLIST> → positions[]  (investment accounts)
// ---------------------------------------------------------------------------
function parseInvestmentPositions(invposlist, secMap) {
  const positions = [];
  for (const posTag of ['POSSTOCK', 'POSMF', 'POSOTHER', 'POSDEBT', 'POSOPT']) {
    for (const posEntry of toArray(invposlist[posTag])) {
      const invpos = posEntry?.INVPOS;
      if (!invpos) continue;
      const cusip = invpos?.SECID?.UNIQUEID;
      if (!cusip) continue;

      const security = secMap[cusip] || {};
      const ticker   = (security.ticker || cusip).toUpperCase();
      const units    = parseFloat(invpos.UNITS     || 0);
      const price    = parseFloat(invpos.UNITPRICE || 0);
      const mktval   = parseFloat(invpos.MKTVAL    || 0);
      if (units === 0) continue;

      positions.push({
        ticker,
        asset_name:    security.name || ticker,
        asset_type:    resolveAssetType(posTag, cusip),
        shares:        units,
        current_price: price,
        market_value:  mktval,
        cusip,
        price_date:    parseDateOFX(invpos.DTPRICEASOF),
      });
    }
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Parse <LEDGERBAL> → single CASH position  (bank accounts)
// ---------------------------------------------------------------------------
function parseBankBalance(stmtrs) {
  const bal   = parseFloat(stmtrs?.LEDGERBAL?.BALAMT || 0);
  const dtRaw = stmtrs?.LEDGERBAL?.DTASOF;
  if (bal === 0) return [];
  return [{
    ticker:        'CASH',
    asset_name:    'Cash',
    asset_type:    'cash',
    shares:        bal,       // shares = dollar balance for cash positions
    current_price: 1.0,
    market_value:  bal,
    price_date:    parseDateOFX(dtRaw),
  }];
}

// ---------------------------------------------------------------------------
// Main parse — handles both investment and bank OFX files
// ---------------------------------------------------------------------------
function parseOFXFile(fileBuffer) {
  const raw = typeof fileBuffer === 'string' ? fileBuffer : fileBuffer.toString('utf-8');

  const ofxStart = raw.indexOf('<OFX>');
  if (ofxStart === -1) throw new Error('Not a valid OFX/QFX file — <OFX> tag not found');

  const ofxObj = parseOFXSGML(raw.slice(ofxStart));
  const secMap  = buildSecurityMap(ofxObj);
  const errors  = [];
  const accounts = [];

  // ---- Investment accounts (<INVSTMTMSGSRSV1>) ----------------------------
  const invBlocks = toArray(ofxObj?.OFX?.INVSTMTMSGSRSV1?.INVSTMTTRNRS);
  for (const block of invBlocks) {
    const stmtrs  = block?.INVSTMTRS;
    const acctId  = stmtrs?.INVACCTFROM?.ACCTID;
    const dtAsOf  = parseDateOFX(stmtrs?.DTASOF);
    if (!acctId) { errors.push('Investment block missing ACCTID'); continue; }

    const invposlist = stmtrs?.INVPOSLIST;
    if (!invposlist) {
      errors.push(`Account ${acctId}: no INVPOSLIST`);
      accounts.push({ acctId, dtAsOf, positions: [] });
      continue;
    }
    accounts.push({ acctId, dtAsOf, positions: parseInvestmentPositions(invposlist, secMap) });
  }

  // ---- Bank accounts (<BANKMSGSRSV1>) -------------------------------------
  const bankBlocks = toArray(ofxObj?.OFX?.BANKMSGSRSV1);
  for (const block of bankBlocks) {
    const stmtrs  = block?.STMTTRNRS?.STMTRS;
    const acctId  = stmtrs?.BANKACCTFROM?.ACCTID;
    const dtAsOf  = parseDateOFX(stmtrs?.LEDGERBAL?.DTASOF);
    if (!acctId) { errors.push('Bank block missing ACCTID'); continue; }

    accounts.push({ acctId, dtAsOf, positions: parseBankBalance(stmtrs) });
  }

  if (accounts.length === 0) {
    throw new Error('No accounts found — file contains neither investment nor bank statements');
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

module.exports = {
  id:           'ofx_qfx',
  name:         'OFX / QFX (Generic)',
  description:  'Investment positions (LPL, Merrill, Schwab) and bank balances (CFCU, any bank) — single file, all accounts',
  fileTypes:    ['.ofx', '.qfx'],
  institutions: ['lpl', 'cfcu', 'merrill', 'schwab', 'fidelity', 'other'],
  multiAccount: true,
  parseMulti:   parseOFXFile,
  parseOFXFile,
  matchAccounts,
};

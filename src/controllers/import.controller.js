/**
 * Import Controller
 * Handles CSV, OFX/QFX, and manual position imports.
 */

'use strict';

const multer = require('multer');
const path = require('path');
const { getAnonClient, getAdminClient } = require('../lib/supabase');
const { fetchPricesForTickers } = require('../services/priceRefresh');
const { runPurge } = require('../lib/importHistory');
const logger = require('../utils/logger');

// Importers
const lplCsvImporter = require('../importers/lpl_csv');
const cfcuCsvImporter = require('../importers/cfcu_csv');
const ofxQfxImporter = require('../importers/ofx_qfx');
const manualImporter = require('../importers/manual');

const IMPORTERS = {
  lpl_csv: lplCsvImporter,
  cfcu_csv: cfcuCsvImporter,
  ofx_qfx: ofxQfxImporter,
  manual: manualImporter,
};

// Multer — in-memory, 20MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// GET /import/importers
// Returns list of importers the user has enabled (defaults always included)
// ---------------------------------------------------------------------------
const getImporters = async (req, res) => {
  const userId = req.user.id;
  const admin = getAdminClient();

  try {
    const { data: dbImporters, error } = await admin
      .from('importers')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) throw error;

    const { data: prefs } = await admin
      .from('user_importer_preferences')
      .select('importer_id, is_enabled')
      .eq('user_id', userId);

    const prefMap = {};
    (prefs || []).forEach(p => { prefMap[p.importer_id] = p.is_enabled; });

    const list = (dbImporters || [])
      .filter(imp => {
        if (!IMPORTERS[imp.id]) {
          logger.warn(`Importer '${imp.id}' has no code module — skipping`);
          return false;
        }
        return imp.is_default || prefMap[imp.id] === true;
      })
      .map(imp => ({
        id:           imp.id,
        name:         imp.name,
        description:  imp.description,
        instructions: imp.instructions,
        fileTypes:    imp.file_types || [],
        institutions: imp.institutions || [],
        multiAccount: imp.multi_account,
        isManual:     imp.is_manual,
        isDefault:    imp.is_default,
      }));

    return res.json({ importers: list });
  } catch (err) {
    logger.warn('getImporters DB query failed, falling back to code registry:', err.message);
    const list = Object.values(IMPORTERS).map(i => ({
      id: i.id, name: i.name, description: i.description, instructions: '',
      fileTypes: i.fileTypes || [], institutions: i.institutions || [],
      multiAccount: i.multiAccount === true, isManual: i.isManual === true,
      isDefault: i.id === 'ofx_qfx' || i.id === 'manual',
    }));
    return res.json({ importers: list });
  }
};

// ---------------------------------------------------------------------------
// POST /import/upload
// File import — CSV or OFX/QFX
// Body: importerId, accountId (optional for OFX multi-account), syncMode
// ---------------------------------------------------------------------------
const uploadFile = [
  upload.single('file'),
  async (req, res) => {
    const userId = req.user.id;
    const { importerId, accountId, syncMode } = req.body;
    const doSync = syncMode === 'true' || syncMode === true;

    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    if (!importerId) return res.status(400).json({ message: 'importerId is required' });

    const importer = IMPORTERS[importerId];
    if (!importer) return res.status(400).json({ message: `Unknown importer: ${importerId}` });

    // File type validation — normalize to dot-prefixed (e.g. '.csv')
    const ext = path.extname(req.file.originalname).toLowerCase();
    const accepted = (importer.fileTypes || []).map(t => t.startsWith('.') ? t : `.${t}`);
    if (accepted.length > 0 && !accepted.includes(ext)) {
      return res.status(400).json({
        message: `This importer only accepts ${accepted.join(' or ')} files. You uploaded "${ext || '(no extension)'}"`,
      });
    }

    const supabase = getAnonClient();
    const admin = getAdminClient();

    try {
      // -----------------------------------------------------------------------
      // Multi-account path — OFX/QFX and LPL all-accounts CSV
      // Any importer with multiAccount:true uses parseXxx + matchAccounts
      // -----------------------------------------------------------------------
      const isMultiAccount = importer.multiAccount === true;

      if (isMultiAccount) {
        // All multi-account importers expose parseMulti(buffer)
        // returning { accounts: [{ acctId, positions[] }], errors[] }
        const { accounts: parsedAccounts, errors: parseErrors } =
          importer.parseMulti(req.file.buffer);

        // Load all user accounts — use admin client to bypass RLS, include inactive
        const { data: dbAccounts, error: acctErr } = await admin
          .from('accounts')
          .select('id, name, account_number_last4, institution, is_active')
          .eq('user_id', userId);

        if (acctErr) throw acctErr;

        const { matched, unmatched } = importer.matchAccounts(parsedAccounts, dbAccounts || []);

        if (matched.length === 0) {
          return res.status(400).json({
            message: 'No accounts in this file matched your portfolio accounts. ' +
              'Check that account last-4 digits match.',
            unmatchedAccountIds: unmatched,
          });
        }

        const results = [];
        const allTickers = new Set();

        for (const { parsed, dbAcct } of matched) {
          const result = await upsertPositions({
            supabase,
            admin,
            userId,
            accountId: dbAcct.id,
            accountName: dbAcct.name,
            accountInstitution: dbAcct.institution,
            positions: parsed.positions,
            syncMode: doSync,
            source: importerId,
            dtAsOf: parsed.dtAsOf,
          });
          results.push({ accountId: dbAcct.id, accountName: dbAcct.name, ...result });
          result.tickers.forEach(t => allTickers.add(t));
        }

        // Refresh prices for all new tickers
        if (allTickers.size > 0) {
          await fetchPricesForTickers([...allTickers]).catch(e =>
          logger.warn('Price refresh after multi-account import failed:', e.message)
          );
        }

        return res.json({
          success: true,
          matchedAccounts: matched.length,
          unmatchedAccountIds: unmatched,
          parseWarnings: parseErrors,
          results,
        });
      }

      // -----------------------------------------------------------------------
      // CSV path — single account, uses parse(buffer) on the importer
      // -----------------------------------------------------------------------
      if (!accountId) {
        return res.status(400).json({ message: 'accountId is required for CSV imports' });
      }

      // Verify account belongs to user — use admin client (anon client has no user JWT)
      const { data: acct, error: acctErr } = await admin
        .from('accounts')
        .select('id, name, account_number_last4')
        .eq('id', accountId)
        .eq('user_id', userId)
        .single();

      if (acctErr || !acct) {
        return res.status(404).json({ message: 'Account not found' });
      }

      const parseResult = importer.parse(req.file.buffer);

      // Importers may return a plain array or { positions, skipped, errors }
      let rows = Array.isArray(parseResult) ? parseResult : (parseResult.positions || []);

      // If positions carry accountLast4, filter to the selected account only
      if (rows.length > 0 && rows[0].accountLast4 && acct.account_number_last4) {
        const last4 = String(acct.account_number_last4).trim();
        rows = rows.filter(r => String(r.accountLast4).trim() === last4);
        if (rows.length === 0) {
          return res.status(400).json({
            message: `No data in this file matched account ending in ${last4}. ` +
              'Check that you selected the correct account.',
          });
        }
      }

      const result = await upsertPositions({
        supabase,
        admin,
        userId,
        accountId,
        accountName: acct.name,
        positions: rows,
        syncMode: doSync,
        source: importerId,
      });

      if (result.tickers.length > 0) {
        await fetchPricesForTickers(result.tickers).catch(e =>
          logger.warn('Price refresh after CSV import failed:', e.message)
        );
      }

      return res.json({ success: true, ...result });

    } catch (err) {
      logger.error('Import error:', err);
      return res.status(500).json({ message: err.message || 'Import failed' });
    }
  },
];

// ---------------------------------------------------------------------------
// POST /import/manual
// Manual position entry — cash balance or fund/stock by market value
// Body: accountId, mode ('cash'|'position'), ticker, shares|marketValue, costBasis, asOfDate
// ---------------------------------------------------------------------------
const importManual = async (req, res) => {
  const userId = req.user.id;
  const { accountId, mode, ticker, shares, marketValue, costBasis, asOfDate, price, assetName } = req.body;

  if (!accountId || !mode) {
    return res.status(400).json({ message: 'accountId and mode are required' });
  }

  const supabase = getAnonClient();
  const admin = getAdminClient();

  try {
    // Verify account — use admin client (anon client has no user JWT, RLS blocks the query)
    const { data: acct, error: acctErr } = await admin
      .from('accounts')
      .select('id, name, type')
      .eq('id', accountId)
      .eq('user_id', userId)
      .single();

    if (acctErr || !acct) return res.status(404).json({ message: 'Account not found' });

    let position;

    if (mode === 'cash') {
      // Cash balance entry
      const balance = parseFloat(shares || marketValue || 0);
      if (isNaN(balance) || balance < 0) {
        return res.status(400).json({ message: 'Invalid balance amount' });
      }
      position = {
        ticker: 'CASH',
        asset_name: 'Cash',
        asset_type: 'cash',
        shares: balance,
        cost_basis: 0,
        as_of_date: asOfDate || new Date().toISOString().split('T')[0],
      };
    } else {
      // Fund/stock entry
      if (!ticker) return res.status(400).json({ message: 'ticker is required' });

      let currentPrice = null;
      const manualPrice = parseFloat(price);
      const isPrivate = manualPrice > 0;

      if (isPrivate) {
        // Private/unlisted stock — use provided price directly, skip Yahoo Finance
        currentPrice = manualPrice;
        await admin.from('price_cache').upsert(
          { ticker: ticker.toUpperCase(), price: currentPrice, last_fetched_at: new Date().toISOString(), fetch_source: 'manual' },
          { onConflict: 'ticker' }
        );
      } else {
        // Exchange-listed stock — check cache then Yahoo Finance
        const mv = parseFloat(marketValue || 0);
        if (isNaN(mv) || mv <= 0) {
          return res.status(400).json({ message: 'marketValue must be positive' });
        }

        const { data: cached } = await admin
          .from('price_cache')
          .select('price')
          .eq('ticker', ticker.toUpperCase())
          .single();

        if (cached?.price) {
          currentPrice = cached.price;
        } else {
          try {
            const YahooFinance = require('yahoo-finance2').default;
            const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
            const quote = await yf.quote(ticker.toUpperCase());
            currentPrice = quote?.regularMarketPrice || null;
          } catch {
            // Price not available
          }
        }
      }

      const mv = parseFloat(marketValue || 0);
      const calculatedShares = isPrivate
        ? parseFloat(shares || 0)
        : currentPrice
          ? mv / currentPrice
          : parseFloat(shares || 0);

      if (calculatedShares <= 0) {
        return res.status(400).json({
          message: currentPrice
            ? 'Could not calculate shares from market value'
            : 'Could not fetch current price. Please enter shares directly.',
          currentPrice,
        });
      }

      position = {
        ticker:      ticker.toUpperCase(),
        asset_name:  assetName || ticker.toUpperCase(),
        asset_type:  'stock',
        shares:      calculatedShares,
        cost_basis:  parseFloat(costBasis || 0),
        as_of_date:  asOfDate || new Date().toISOString().split('T')[0],
        current_price: currentPrice,
      };
    }

    // Upsert position
    const result = await upsertPositions({
      supabase,
      admin,
      userId,
      accountId,
      accountName: acct.name,
      positions: [position],
      syncMode: false,
      source: 'manual',
    });

    // Refresh price cache for exchange-listed stocks (private stocks already have price in cache)
    if (position.asset_type !== 'cash' && !parseFloat(price)) {
      await fetchPricesForTickers([position.ticker]).catch(() => {});
    }

    return res.json({ success: true, ...result });

  } catch (err) {
    logger.error('Manual import error:', err);
    return res.status(500).json({ message: err.message || 'Import failed' });
  }
};

// ---------------------------------------------------------------------------
// GET /import/history
// Recent import history for the user
// ---------------------------------------------------------------------------
const getHistory = async (req, res) => {
  const userId = req.user.id;
  const admin = getAdminClient();

  try {
    const { data: history, error } = await admin
      .from('import_history')
      .select('id, account_id, filename, file_format, institution, status, rows_parsed, rows_imported, rows_skipped, error_detail, as_of_date, imported_at')
      .eq('user_id', userId)
      .order('imported_at', { ascending: false, nullsFirst: false })
      .limit(50);

    if (error) {
      logger.error('getHistory query error:', error.code, error.message, error.details, error.hint);
      // Return empty rather than 500 — history failure shouldn't break the page
      return res.json({ history: [] });
    }

    // Enrich with account names
    const accountIds = [...new Set((history || []).map(h => h.account_id).filter(Boolean))];
    let accountMap = {};
    if (accountIds.length > 0) {
      const { data: accts } = await admin
        .from('accounts')
        .select('id, name, institution')
        .in('id', accountIds);
      (accts || []).forEach(a => { accountMap[a.id] = { name: a.name, institution: a.institution }; });
    }

    const result = (history || []).map(h => ({
      ...h,
      account: h.account_id ? {
        id: h.account_id,
        name: accountMap[h.account_id]?.name || null,
        institution: accountMap[h.account_id]?.institution || null,
      } : null,
    }));

    res.json({ history: result });
  } catch (err) {
    logger.error('getHistory exception:', err.message);
    res.json({ history: [] });
  }
};


// ---------------------------------------------------------------------------
// Internal helper — upsert positions for one account
// Returns { rowsImported, rowsRemoved, tickers, removedPositions }
//
// source behaviour:
//   CSV importers  → writes cost_basis (has it from the file)
//   ofx_qfx        → preserves existing cost_basis on conflict (OFX has no cost basis)
//   manual         → writes cost_basis as provided
// ---------------------------------------------------------------------------
async function upsertPositions({
  supabase, admin, userId, accountId, accountName, accountInstitution,
  positions, syncMode, source, dtAsOf,
}) {
  const isOFX = source === 'ofx_qfx';

  // Build upsert rows
  const rows = positions.map(p => ({
    user_id: userId,
    account_id: accountId,
    ticker: p.ticker,
    asset_name: p.asset_name || p.ticker,
    asset_type: p.asset_type || 'stock',
    shares: p.shares,
    cost_basis: p.cost_basis ?? 0,
    as_of_date: dtAsOf || p.as_of_date || new Date().toISOString().split('T')[0],
  }));

  if (isOFX) {
    // OFX: for existing positions only update shares/price-related fields, never cost_basis.
    // Strategy: insert new rows normally (cost_basis=0), update existing ones without touching cost_basis.

    // 1. Find which tickers already exist for this account
    const incomingTickers = rows.map(r => r.ticker);
    const { data: existing } = await admin
      .from('positions')
      .select('id, ticker, cost_basis')
      .eq('account_id', accountId)
      .in('ticker', incomingTickers);

    const existingMap = {};
    (existing || []).forEach(e => { existingMap[e.ticker] = e; });

    const toInsert = rows.filter(r => !existingMap[r.ticker]);
    const toUpdate = rows.filter(r =>  existingMap[r.ticker]);

    // Insert new positions (cost_basis=0 is fine for brand new ones)
    if (toInsert.length > 0) {
      const { error: insertErr } = await admin.from('positions').insert(toInsert);
      if (insertErr) throw insertErr;
    }

    // Update existing positions — preserve their cost_basis
    for (const row of toUpdate) {
      const existingRow = existingMap[row.ticker];
      const { error: updateErr } = await admin
        .from('positions')
        .update({
          shares: row.shares,
          asset_name: row.asset_name,
          asset_type: row.asset_type,
          as_of_date: row.as_of_date,
          // cost_basis intentionally omitted — preserve existing value
        })
        .eq('id', existingRow.id);
      if (updateErr) throw updateErr;
    }
  } else {
    // CSV / manual: full upsert including cost_basis
    const { error: upsertErr } = await admin
      .from('positions')
      .upsert(rows, { onConflict: 'account_id,ticker' });
    if (upsertErr) throw upsertErr;
  }

  const tickers = [...new Set(rows.map(r => r.ticker).filter(t => t !== 'CASH'))];

  // Sync-delete: remove positions not in this import
  let removedPositions = [];
  if (syncMode) {
    const incomingTickers = rows.map(r => r.ticker);

    const { data: existing } = await admin
      .from('positions')
      .select('id, ticker')
      .eq('account_id', accountId);

    const toRemove = (existing || []).filter(p => !incomingTickers.includes(p.ticker));

    if (toRemove.length > 0) {
      const removeIds = toRemove.map(p => p.id);
      await admin.from('positions').delete().in('id', removeIds);
      removedPositions = toRemove;
    }
  }

  // Log import history
  try {
    const fileFormat = source;

    const INSTITUTION_NAMES = {
      lpl_csv: 'lpl', ofx_qfx: 'lpl', cfcu_csv: 'cfcu', manual: 'manual',
    };
    const institution = accountInstitution
      || INSTITUTION_NAMES[source]
      || source.replace('_csv','').replace('_qfx','').replace('_ofx','');

    const { error: histErr } = await admin.from('import_history').insert({
      user_id:       userId,
      account_id:    accountId,
      filename:      accountName ? `${source} — ${accountName}` : `${source} import`,
      file_format:   fileFormat,
      institution:   institution,
      status:        'success',
      rows_parsed:   rows.length,
      rows_imported: rows.length,
      rows_skipped:  0,
      as_of_date:    dtAsOf || new Date().toISOString().split('T')[0],
      imported_at:   new Date().toISOString(),
    });
    if (histErr) {
      logger.warn('History insert failed:', histErr.code, histErr.message);
    }
  } catch (e) {
    logger.error('History insert exception:', e.message);
  }

  // Auto-purge old history records if the user has a retention limit set
  try {
    const { data: profile } = await admin
      .from('profiles')
      .select('import_history_limit')
      .eq('id', userId)
      .single();
    if (profile?.import_history_limit) {
      await runPurge(admin, userId, profile.import_history_limit);
    }
  } catch (e) {
    logger.warn('Import history auto-purge failed:', e.message);
  }

  return {
    rowsImported: rows.length,
    rowsRemoved: removedPositions.length,
    tickers,
    removedPositions,
  };
}

module.exports = {
  getImporters,
  uploadFile,
  importManual,
  getHistory,
};

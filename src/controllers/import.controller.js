'use strict';

const { getAdminClient } = require('../lib/supabase');
const { getImporter, listImporters } = require('../importers');
const logger = require('../utils/logger');

// =============================================================================
// Import Controller
// =============================================================================

const getImporters = (req, res) => {
  return res.status(200).json({
    success: true,
    importers: listImporters(),
  });
};

// -----------------------------------------------------------------------------
// POST /api/v1/import/upload
// Form fields:
//   file       — CSV/QFX file (multipart)
//   importerId — which parser to use e.g. 'lpl_csv'
//   accountId  — optional: force all positions into one account
//   syncMode   — optional: 'true' to remove positions no longer in file
// -----------------------------------------------------------------------------
const uploadAndImport = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const { importerId, accountId, syncMode } = req.body;
    const shouldSync = syncMode === 'true';

    if (!importerId) {
      return res.status(400).json({ success: false, message: 'importerId is required' });
    }

    const importer = getImporter(importerId);
    if (!importer) {
      return res.status(400).json({
        success: false,
        message: `Unknown importer: ${importerId}`,
      });
    }

    logger.info('Import started', {
      userId: req.user.id,
      importerId,
      filename: req.file.originalname,
      syncMode: shouldSync,
    });

    const { positions, skipped, errors } = importer.parse(req.file.buffer);

    if (positions.length === 0) {
      return res.status(422).json({
        success: false,
        message: 'No valid positions found in file',
        skipped: skipped.length,
        errors,
      });
    }

    const supabase = getAdminClient();

    // Load user's accounts for matching
    const { data: userAccounts, error: accountsError } = await supabase
      .from('accounts')
      .select('id, name, institution, account_number_last4')
      .eq('user_id', req.user.id)
      .eq('is_active', true);

    if (accountsError) return next(accountsError);

    const accountMap = {};
    userAccounts.forEach(acc => {
      if (acc.account_number_last4) {
        accountMap[acc.account_number_last4] = acc.id;
      }
    });

    let rowsImported = 0;
    let rowsSkipped = skipped.length;
    const importErrors = [...errors];
    const positionsByAccount = {};

    for (const position of positions) {
      let targetAccountId = accountId || null;

      if (!targetAccountId && position.accountNumber) {
        const last4 = position.accountNumber.toString().slice(-4);
        targetAccountId = accountMap[last4] || null;
      }

      if (!targetAccountId) {
        rowsSkipped++;
        importErrors.push({
          ticker: position.ticker,
          message: `No matching account for account number ending in ${position.accountNumber?.toString().slice(-4)}`,
          type: 'account_not_found',
        });
        continue;
      }

      if (!positionsByAccount[targetAccountId]) {
        positionsByAccount[targetAccountId] = [];
      }
      positionsByAccount[targetAccountId].push({ ...position, resolvedAccountId: targetAccountId });
    }

    const asOfDate = positions.find(p => p.asOfDate)?.asOfDate || null;
    const removedPositions = []; // track positions removed by sync

    for (const [targetAccountId, accountPositions] of Object.entries(positionsByAccount)) {
      // Upsert positions
      const upsertRows = accountPositions.map(p => ({
        user_id:       req.user.id,
        account_id:    targetAccountId,
        ticker:        p.ticker,
        asset_name:    p.assetName,
        asset_type:    p.assetType,
        shares:        p.shares,
        cost_basis:    p.costBasis || 0,
        import_source: p.importSource,
        imported_at:   new Date().toISOString(),
        as_of_date:    p.asOfDate,
      }));

      const { error: upsertError } = await supabase
        .from('positions')
        .upsert(upsertRows, { onConflict: 'account_id,ticker', ignoreDuplicates: false });

      if (upsertError) {
        logger.error('Upsert failed', { accountId: targetAccountId, error: upsertError.message });
        importErrors.push({ accountId: targetAccountId, message: upsertError.message, type: 'upsert_error' });
      } else {
        rowsImported += upsertRows.length;
      }

      // ==========================================================================
      // Sync-delete — remove positions no longer in the file (opt-in)
      // ==========================================================================
      if (shouldSync) {
        const importedTickers = accountPositions.map(p => p.ticker);

        // Find positions in this account not in the imported file
        const { data: existingPositions } = await supabase
          .from('positions')
          .select('id, ticker, asset_name, asset_type')
          .eq('account_id', targetAccountId)
          .eq('user_id', req.user.id)
          .not('ticker', 'in', `(${importedTickers.map(t => `"${t}"`).join(',')})`);

        if (existingPositions && existingPositions.length > 0) {
          // Get current prices for removed positions
          const removedTickers = existingPositions.map(p => p.ticker);
          const { data: prices } = await supabase
            .from('price_cache')
            .select('ticker, price, change_percent')
            .in('ticker', removedTickers);

          const priceMap = {};
          (prices || []).forEach(p => { priceMap[p.ticker] = p; });

          // Delete the positions
          await supabase
            .from('positions')
            .delete()
            .eq('account_id', targetAccountId)
            .eq('user_id', req.user.id)
            .not('ticker', 'in', `(${importedTickers.map(t => `"${t}"`).join(',')})`);

          // Track removed positions with price data for the response
          existingPositions.forEach(p => {
            removedPositions.push({
              ticker:        p.ticker,
              assetName:     p.asset_name,
              assetType:     p.asset_type,
              currentPrice:  priceMap[p.ticker]?.price || null,
              changePercent: priceMap[p.ticker]?.change_percent || null,
              accountId:     targetAccountId,
            });
          });

          logger.info('Sync removed positions', {
            accountId: targetAccountId,
            removed: existingPositions.map(p => p.ticker),
          });
        }
      }
    }

    // Log import history
    const status = importErrors.length === 0 ? 'success'
                 : rowsImported === 0        ? 'failed'
                 : 'partial';

    const primaryAccountId = accountId || Object.keys(positionsByAccount)[0] || null;

    await supabase.from('import_history').insert({
      user_id:       req.user.id,
      account_id:    primaryAccountId,
      filename:      req.file.originalname,
      file_format:   'csv',
      institution:   importer.institution,
      status,
      rows_parsed:   positions.length + skipped.length,
      rows_imported: rowsImported,
      rows_skipped:  rowsSkipped,
      error_detail:  importErrors.length > 0 ? JSON.stringify(importErrors) : null,
      as_of_date:    asOfDate,
    });

    logger.info('Import complete', {
      userId: req.user.id,
      filename: req.file.originalname,
      rowsImported,
      rowsSkipped,
      removed: removedPositions.length,
      status,
    });

    return res.status(200).json({
      success: true,
      status,
      filename: req.file.originalname,
      rowsImported,
      rowsSkipped,
      errors: importErrors,
      asOfDate,
      removedPositions,  // positions removed by sync-delete
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// GET /api/v1/import/history
// -----------------------------------------------------------------------------
const getHistory = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const { data: history, error } = await supabase
      .from('import_history')
      .select(`
        id, filename, file_format, institution, status,
        rows_parsed, rows_imported, rows_skipped,
        error_detail, as_of_date, imported_at,
        account:account_id ( id, name )
      `)
      .eq('user_id', req.user.id)
      .order('imported_at', { ascending: false })
      .limit(50);

    if (error) return next(error);

    return res.status(200).json({ success: true, count: history.length, history });

  } catch (err) {
    next(err);
  }
};

module.exports = { getImporters, uploadAndImport, getHistory };

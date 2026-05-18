'use strict';

const { getAdminClient } = require('../lib/supabase');
const { getImporter, listImporters } = require('../importers');
const logger = require('../utils/logger');

// =============================================================================
// Import Controller
// =============================================================================

// -----------------------------------------------------------------------------
// GET /api/v1/import/importers
// Returns list of available import plugins
// -----------------------------------------------------------------------------
const getImporters = (req, res) => {
  return res.status(200).json({
    success: true,
    importers: listImporters(),
  });
};

// -----------------------------------------------------------------------------
// POST /api/v1/import/upload
// Multipart form upload — file + importerId + accountId (optional)
//
// Form fields:
//   file       — the CSV/QFX file
//   importerId — which parser to use e.g. 'lpl_csv'
//   accountId  — optional: force import into a specific account
//                if omitted, the importer matches by account number
// -----------------------------------------------------------------------------
const uploadAndImport = async (req, res, next) => {
  try {
    // multer puts the uploaded file on req.file
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    const { importerId, accountId } = req.body;

    if (!importerId) {
      return res.status(400).json({
        success: false,
        message: 'importerId is required',
      });
    }

    // Look up the parser
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
      size: req.file.size,
    });

    // Parse the file
    const { positions, skipped, errors } = importer.parse(req.file.buffer);

    if (positions.length === 0) {
      return res.status(422).json({
        success: false,
        message: 'No valid positions found in file',
        skipped: skipped.length,
        errors,
      });
    }

    // Load this user's accounts for matching by account number
    const supabase = getAdminClient();
    const { data: userAccounts, error: accountsError } = await supabase
      .from('accounts')
      .select('id, name, institution, account_number_last4')
      .eq('user_id', req.user.id)
      .eq('is_active', true);

    if (accountsError) return next(accountsError);

    // ==========================================================================
    // Match each position to an account
    // Priority:
    //   1. If accountId was provided in the form, use that for all positions
    //   2. Otherwise match by last 4 digits of account number from the CSV
    // ==========================================================================
    const accountMap = {};
    userAccounts.forEach(acc => {
      if (acc.account_number_last4) {
        accountMap[acc.account_number_last4] = acc.id;
      }
    });

    let rowsImported = 0;
    let rowsSkipped = skipped.length;
    const importErrors = [...errors];

    // Group positions by account for efficient upsert
    const positionsByAccount = {};

    for (const position of positions) {
      // Determine which account this position belongs to
      let targetAccountId = accountId || null;

      if (!targetAccountId && position.accountNumber) {
        // Match by last 4 digits of the account number from the CSV
        const last4 = position.accountNumber.toString().slice(-4);
        targetAccountId = accountMap[last4] || null;
      }

      if (!targetAccountId) {
        rowsSkipped++;
        importErrors.push({
          ticker: position.ticker,
          message: `No matching account found for account number ending in ${position.accountNumber?.toString().slice(-4)}`,
          type: 'account_not_found',
        });
        continue;
      }

      if (!positionsByAccount[targetAccountId]) {
        positionsByAccount[targetAccountId] = [];
      }
      positionsByAccount[targetAccountId].push({
        ...position,
        resolvedAccountId: targetAccountId,
      });
    }

    // ==========================================================================
    // Upsert positions into the database
    // The UNIQUE(account_id, ticker) constraint means:
    //   - New tickers get inserted
    //   - Existing tickers get updated with latest shares/cost basis
    // ==========================================================================
    const asOfDate = positions.find(p => p.asOfDate)?.asOfDate || null;

    for (const [targetAccountId, accountPositions] of Object.entries(positionsByAccount)) {
      const upsertRows = accountPositions.map(p => ({
        user_id:              req.user.id,
        account_id:           targetAccountId,
        ticker:               p.ticker,
        asset_name:           p.assetName,
        asset_type:           p.assetType,
        shares:               p.shares,
        cost_basis:           p.costBasis || 0,
        import_source:        p.importSource,
        imported_at:          new Date().toISOString(),
        as_of_date:           p.asOfDate,
      }));

      const { error: upsertError } = await supabase
        .from('positions')
        .upsert(upsertRows, {
          onConflict: 'account_id,ticker',
          ignoreDuplicates: false,   // update on conflict
        });

      if (upsertError) {
        logger.error('Upsert failed for account', {
          accountId: targetAccountId,
          error: upsertError.message,
        });
        importErrors.push({
          accountId: targetAccountId,
          message: upsertError.message,
          type: 'upsert_error',
        });
      } else {
        rowsImported += upsertRows.length;
      }
    }

    // ==========================================================================
    // Log the import to import_history
    // ==========================================================================
    const status = importErrors.length === 0 ? 'success'
                 : rowsImported === 0        ? 'failed'
                 : 'partial';

    await supabase.from('import_history').insert({
      user_id:       req.user.id,
      account_id:    accountId || Object.keys(positionsByAccount)[0] || null,
      filename:      req.file.originalname,
      file_format:   'csv',
      institution:   importer.institution,
      status,
      rows_parsed:   positions.length + skipped.length,
      rows_imported: rowsImported,
      rows_skipped:  rowsSkipped,
      error_detail:  importErrors.length > 0
                       ? JSON.stringify(importErrors)
                       : null,
      as_of_date:    asOfDate,
    });

    logger.info('Import complete', {
      userId: req.user.id,
      filename: req.file.originalname,
      rowsImported,
      rowsSkipped,
      errors: importErrors.length,
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
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// GET /api/v1/import/history
// Returns import history for the logged-in user
// -----------------------------------------------------------------------------
const getHistory = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const { data: history, error } = await supabase
      .from('import_history')
      .select(`
        id,
        filename,
        file_format,
        institution,
        status,
        rows_parsed,
        rows_imported,
        rows_skipped,
        error_detail,
        as_of_date,
        imported_at,
        account:account_id (
          id,
          name
        )
      `)
      .eq('user_id', req.user.id)
      .order('imported_at', { ascending: false })
      .limit(50);

    if (error) return next(error);

    return res.status(200).json({
      success: true,
      count: history.length,
      history,
    });

  } catch (err) {
    next(err);
  }
};

module.exports = { getImporters, uploadAndImport, getHistory };
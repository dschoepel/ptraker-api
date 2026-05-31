'use strict';

const { getAdminClient } = require('../lib/supabase');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

// =============================================================================
// Account Controller
// =============================================================================
// Manages financial accounts (LPL, Merrill, bank, etc.)
// All operations are scoped to req.user.id — users only see their own accounts.
// =============================================================================

// -----------------------------------------------------------------------------
// GET /api/v1/accounts
// Returns all accounts for the logged-in user
// -----------------------------------------------------------------------------
const getAll = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const { data: accounts, error } = await supabase
      .from('accounts')
      .select(`
        id,
        name,
        institution,
        type,
        account_number_last4,
        is_active,
        include_in_snapshot,
        notes,
        created_at,
        updated_at
      `)
      .eq('user_id', req.user.id)
      .order('institution', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      logger.error('Failed to fetch accounts', {
        userId: req.user.id,
        error: error.message,
      });
      return next(error);
    }

    return res.status(200).json({
      success: true,
      count: accounts.length,
      accounts,
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// GET /api/v1/accounts/:id
// Returns one account (must belong to logged-in user)
// -----------------------------------------------------------------------------
const getOne = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    const { data: account, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)   // ← scoped to this user
      .single();

    if (error || !account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    return res.status(200).json({
      success: true,
      account,
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// POST /api/v1/accounts
// Body: { name, institution, type, accountNumberLast4?, notes? }
// -----------------------------------------------------------------------------
const create = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { name, institution, type, accountNumberLast4, notes } = req.body;

    const supabase = getAdminClient();

    const { data: account, error } = await supabase
      .from('accounts')
      .insert({
        user_id: req.user.id,
        name,
        institution: institution.toLowerCase(),
        type,
        account_number_last4: accountNumberLast4 || null,
        notes: notes || null,
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create account', {
        userId: req.user.id,
        error: error.message,
      });
      return next(error);
    }

    logger.info('Account created', {
      userId: req.user.id,
      accountId: account.id,
      name: account.name,
    });

    return res.status(201).json({
      success: true,
      account,
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// PATCH /api/v1/accounts/:id
// Body: { name?, institution?, type?, accountNumberLast4?, notes?, isActive? }
// -----------------------------------------------------------------------------
const update = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { name, institution, type, accountNumberLast4, notes, isActive, includeInSnapshot } = req.body;

    // Build update object with only the fields that were provided
    const updates = {};
    if (name !== undefined)                updates.name = name;
    if (institution !== undefined)         updates.institution = institution.toLowerCase();
    if (type !== undefined)                updates.type = type;
    if (accountNumberLast4 !== undefined)  updates.account_number_last4 = accountNumberLast4;
    if (notes !== undefined)               updates.notes = notes;
    if (isActive !== undefined)            updates.is_active = isActive;
    if (includeInSnapshot !== undefined)   updates.include_in_snapshot = includeInSnapshot;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update',
      });
    }

    const supabase = getAdminClient();

    const { data: account, error } = await supabase
      .from('accounts')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)   // ← scoped to this user
      .select()
      .single();

    if (error || !account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found or update failed',
      });
    }

    logger.info('Account updated', {
      userId: req.user.id,
      accountId: account.id,
    });

    return res.status(200).json({
      success: true,
      account,
    });

  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// DELETE /api/v1/accounts/:id
// Deletes account and all its positions (cascade handled by DB)
// -----------------------------------------------------------------------------
const remove = async (req, res, next) => {
  try {
    const supabase = getAdminClient();

    // Verify account belongs to this user before deleting
    const { data: existing, error: findError } = await supabase
      .from('accounts')
      .select('id, name')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (findError || !existing) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    const { error: deleteError } = await supabase
      .from('accounts')
      .delete()
      .eq('id', req.params.id);

    if (deleteError) {
      return next(deleteError);
    }

    logger.info('Account deleted', {
      userId: req.user.id,
      accountId: req.params.id,
      name: existing.name,
    });

    return res.status(200).json({
      success: true,
      message: `Account "${existing.name}" deleted`,
    });

  } catch (err) {
    next(err);
  }
};

module.exports = { getAll, getOne, create, update, remove };
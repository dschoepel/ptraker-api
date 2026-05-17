'use strict';

const { getAnonClient } = require('../lib/supabase');
const logger = require('../utils/logger');

// =============================================================================
// Auth Middleware — requireAuth
// =============================================================================
// Validates the Supabase JWT on every protected route.
//
// How it works:
//   1. Reads the Bearer token from the Authorization header
//   2. Asks Supabase Auth to validate it (getUser call)
//   3. If valid, attaches the user object to req.user and calls next()
//   4. If invalid or missing, returns 401
//
// Usage in routes:
//   const { requireAuth } = require('../middleware/auth');
//   router.get('/accounts', requireAuth, accountController.getAll);
//
// After this middleware runs successfully, route handlers can access:
//   req.user.id       — the Supabase user UUID
//   req.user.email    — the user's email address
//   req.user          — the full Supabase user object
// =============================================================================

const requireAuth = async (req, res, next) => {
  try {
    // Check for Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided',
      });
    }

    // Extract the token
    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Malformed authorization header',
      });
    }

    // Validate token with Supabase Auth
    // getUser() verifies the JWT signature and expiry
    const supabase = getAnonClient();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      logger.debug('Auth failed', { error: error?.message });
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
      });
    }

    // Attach user to request — available in all downstream handlers
    req.user = user;
    next();

  } catch (err) {
    logger.error('Auth middleware error', { error: err.message });
    return res.status(500).json({
      success: false,
      message: 'Authentication error',
    });
  }
};

// =============================================================================
// requireAdmin — extends requireAuth, also checks for admin role
// =============================================================================
// Usage:
//   router.delete('/users/:id', requireAdmin, userController.delete);
// =============================================================================

const requireAdmin = async (req, res, next) => {
  // First run the standard auth check
  await requireAuth(req, res, async () => {
    try {
      const { getAdminClient } = require('../lib/supabase');
      const supabase = getAdminClient();

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', req.user.id)
        .single();

      if (error || !profile) {
        return res.status(403).json({
          success: false,
          message: 'Could not verify permissions',
        });
      }

      if (profile.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required',
        });
      }

      next();

    } catch (err) {
      logger.error('Admin check error', { error: err.message });
      return res.status(500).json({
        success: false,
        message: 'Authorization error',
      });
    }
  });
};

module.exports = { requireAuth, requireAdmin };
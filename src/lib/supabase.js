'use strict';

const { createClient } = require('@supabase/supabase-js');

// =============================================================================
// Supabase Client — Two-client singleton pattern
// Mirrors the pattern used in the Zwift app
// =============================================================================
//
// Two clients, both singletons:
//
// getAnonClient()  — uses the public anon key, RESPECTS Row Level Security.
//                    Used to validate user JWTs in auth middleware.
//
// getAdminClient() — uses the service-role key, BYPASSES Row Level Security.
//                    Used for all server-side data operations in route handlers.
//                    Singleton avoids heap growth from creating a new client
//                    per request.
// =============================================================================

let _anonClient = null;
let _adminClient = null;

const getAnonClient = () => {
  if (!_anonClient) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment');
    }
    _anonClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }
  return _anonClient;
};

const getAdminClient = () => {
  if (!_adminClient) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment');
    }
    _adminClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }
  return _adminClient;
};

module.exports = { getAnonClient, getAdminClient };
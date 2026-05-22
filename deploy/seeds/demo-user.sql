-- =============================================================================
-- Demo User Seed Script
-- =============================================================================
-- Email:    demo@ptraker.com
-- Password: Demo1234!
-- Role:     user (full user — can view their own seeded portfolio; cannot access admin)
--
-- Run in Supabase Studio SQL Editor (dev or prod).
-- After running, click "Refresh Prices" on the dashboard to populate
-- current market prices for all positions.
--
-- To remove the demo user and all their data, run:
--   SELECT id INTO TEMP demo_id FROM auth.users WHERE email = 'demo@ptraker.com';
--   DELETE FROM positions       WHERE user_id = (SELECT id FROM demo_id);
--   DELETE FROM accounts        WHERE user_id = (SELECT id FROM demo_id);
--   DELETE FROM profiles        WHERE id      = (SELECT id FROM demo_id);
--   DELETE FROM auth.users      WHERE id      = (SELECT id FROM demo_id);
-- =============================================================================

DO $$
DECLARE
  demo_id           uuid := gen_random_uuid();

  -- Schwab retirement accounts
  schwab_trad       uuid := gen_random_uuid();
  schwab_roth       uuid := gen_random_uuid();
  schwab_rollover   uuid := gen_random_uuid();

  -- US Bank accounts
  usbank_checking   uuid := gen_random_uuid();
  usbank_savings    uuid := gen_random_uuid();
  usbank_mm         uuid := gen_random_uuid();

  -- Merrill Lynch brokerage
  merrill_broker    uuid := gen_random_uuid();

  -- Other
  other_acct        uuid := gen_random_uuid();

BEGIN

  -- ---------------------------------------------------------------------------
  -- Auth user
  -- Required: confirmation_token / recovery_token / email_change_token_new /
  -- email_change must be '' not NULL or login returns 500.
  -- ---------------------------------------------------------------------------
  INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    demo_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'demo@ptraker.com',
    crypt('Demo1234!', gen_salt('bf')),
    now(),
    '', '', '', '',
    '{"display_name":"Demo User","intended_role":"user"}',
    now(), now()
  );

  -- Explicit profile insert — belt-and-suspenders in case the handle_new_user
  -- trigger doesn't fire (e.g. direct SQL insert bypasses some GoTrue hooks).
  -- ON CONFLICT DO NOTHING means if the trigger already created it, this is a no-op.
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (demo_id, 'Demo User', 'user')
  ON CONFLICT (id) DO NOTHING;

  -- ---------------------------------------------------------------------------
  -- Accounts
  -- ---------------------------------------------------------------------------
  INSERT INTO accounts (id, user_id, name, institution, type, account_number_last4, is_active) VALUES
    -- Schwab retirement accounts
    (schwab_trad,     demo_id, 'Traditional IRA',          'schwab',  'retirement', '4821', true),
    (schwab_roth,     demo_id, 'Roth IRA',                 'schwab',  'retirement', '3956', true),
    (schwab_rollover, demo_id, 'Rollover IRA',             'schwab',  'retirement', '7103', true),
    -- US Bank
    (usbank_checking, demo_id, 'Checking Account',         'usbank',  'checking',   '6214', true),
    (usbank_savings,  demo_id, 'Premium Savings',          'usbank',  'savings',    '8830', true),
    (usbank_mm,       demo_id, 'Money Market',             'usbank',  'savings',    '2947', true),
    -- Merrill Lynch brokerage
    (merrill_broker,  demo_id, 'Individual Brokerage',     'merrill', 'brokerage',  '5518', true),
    -- Other
    (other_acct,      demo_id, 'Real Estate & Alts',       'other',   'brokerage',  '0091', true);

  -- ---------------------------------------------------------------------------
  -- Positions
  -- Approx current prices (May 2025) used for share counts.
  -- Actual current prices are fetched by "Refresh Prices" after seeding.
  -- Cost basis set at realistic acquisition prices for a multi-year investor.
  -- ---------------------------------------------------------------------------

  -- Schwab Traditional IRA — target ~$164K
  INSERT INTO positions (user_id, account_id, ticker, asset_name, asset_type, shares, cost_basis, as_of_date) VALUES
    (demo_id, schwab_trad, 'VTI',  'Vanguard Total Stock Market ETF',       'etf', 300,  68400.00, '2025-05-21'),
    (demo_id, schwab_trad, 'VXUS', 'Vanguard Total Intl Stock ETF',         'etf', 300,  16200.00, '2025-05-21'),
    (demo_id, schwab_trad, 'BND',  'Vanguard Total Bond Market ETF',        'etf', 700,  52500.00, '2025-05-21'),
    (demo_id, schwab_trad, 'AGG',  'iShares Core U.S. Aggregate Bond ETF',  'etf', 100,  10000.00, '2025-05-21');

  -- Schwab Roth IRA — target ~$125K
  INSERT INTO positions (user_id, account_id, ticker, asset_name, asset_type, shares, cost_basis, as_of_date) VALUES
    (demo_id, schwab_roth, 'QQQ',  'Invesco QQQ Trust',                     'etf', 120,  40000.00, '2025-05-21'),
    (demo_id, schwab_roth, 'VGT',  'Vanguard Information Technology ETF',   'etf',  80,  35000.00, '2025-05-21'),
    (demo_id, schwab_roth, 'SCHD', 'Schwab U.S. Dividend Equity ETF',       'etf', 500,  11500.00, '2025-05-21');

  -- Schwab Rollover IRA — target ~$239K
  INSERT INTO positions (user_id, account_id, ticker, asset_name, asset_type, shares, cost_basis, as_of_date) VALUES
    (demo_id, schwab_rollover, 'SPY',  'SPDR S&P 500 ETF Trust',            'etf', 250, 110000.00, '2025-05-21'),
    (demo_id, schwab_rollover, 'IVV',  'iShares Core S&P 500 ETF',          'etf', 100,  48000.00, '2025-05-21'),
    (demo_id, schwab_rollover, 'VXUS', 'Vanguard Total Intl Stock ETF',     'etf', 400,  22000.00, '2025-05-21'),
    (demo_id, schwab_rollover, 'BND',  'Vanguard Total Bond Market ETF',    'etf', 150,  12000.00, '2025-05-21');

  -- US Bank — cash balances (shares = dollar balance, cost_basis = 0)
  INSERT INTO positions (user_id, account_id, ticker, asset_name, asset_type, shares, cost_basis, as_of_date) VALUES
    (demo_id, usbank_checking, 'CASH', 'Cash', 'cash',  8750.00, 0, '2025-05-21'),
    (demo_id, usbank_savings,  'CASH', 'Cash', 'cash', 24500.00, 0, '2025-05-21'),
    (demo_id, usbank_mm,       'CASH', 'Cash', 'cash', 16250.00, 0, '2025-05-21');

  -- Merrill Lynch Individual Brokerage — target ~$347K
  INSERT INTO positions (user_id, account_id, ticker, asset_name, asset_type, shares, cost_basis, as_of_date) VALUES
    (demo_id, merrill_broker, 'AAPL',  'Apple Inc.',                        'stock', 250,  38000.00, '2025-05-21'),
    (demo_id, merrill_broker, 'MSFT',  'Microsoft Corporation',             'stock', 120,  42000.00, '2025-05-21'),
    (demo_id, merrill_broker, 'GOOGL', 'Alphabet Inc.',                     'stock', 150,  19000.00, '2025-05-21'),
    (demo_id, merrill_broker, 'AMZN',  'Amazon.com Inc.',                   'stock', 100,  16000.00, '2025-05-21'),
    (demo_id, merrill_broker, 'JPM',   'JPMorgan Chase & Co.',              'stock', 200,  38000.00, '2025-05-21'),
    (demo_id, merrill_broker, 'VTI',   'Vanguard Total Stock Market ETF',   'etf',   200,  44000.00, '2025-05-21'),
    (demo_id, merrill_broker, 'VOO',   'Vanguard S&P 500 ETF',              'etf',   100,  42000.00, '2025-05-21'),
    (demo_id, merrill_broker, 'BAC',   'Bank of America Corp.',             'stock', 500,  18000.00, '2025-05-21');

  -- Other — Real Estate & Alternatives — target ~$79K
  INSERT INTO positions (user_id, account_id, ticker, asset_name, asset_type, shares, cost_basis, as_of_date) VALUES
    (demo_id, other_acct, 'VNQ',  'Vanguard Real Estate ETF',              'etf',  400,  32000.00, '2025-05-21'),
    (demo_id, other_acct, 'O',    'Realty Income Corporation',             'stock', 500,  25000.00, '2025-05-21'),
    (demo_id, other_acct, 'STAG', 'STAG Industrial Inc.',                  'stock', 400,  13500.00, '2025-05-21');

  RAISE NOTICE 'Demo user created: demo@ptraker.com (id: %)', demo_id;

END $$;

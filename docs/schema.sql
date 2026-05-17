-- =============================================================================
-- ptraker Database Schema
-- =============================================================================
-- Run this entire script in the Supabase Studio SQL Editor
--
-- Tables:
--   profiles        — app-specific user data (extends auth.users)
--   accounts        — financial accounts (LPL, Merrill, bank, etc.)
--   positions       — holdings per account (ticker, shares, cost basis)
--   price_cache     — daily prices from Yahoo Finance (shared across users)
--   import_history  — log of every CSV/QFX file upload
--
-- Views:
--   portfolio_summary   — positions joined with current prices + calculations
--   account_summary     — rolled up totals per account
--   net_worth_summary   — grand totals per user
-- =============================================================================


-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Automatically update updated_at on any row change
-- SET search_path = public prevents search path hijacking
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Automatically create a profile row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;


-- =============================================================================
-- PROFILES
-- =============================================================================
-- One row per user, created automatically via trigger on auth.users insert.
-- =============================================================================

CREATE TABLE public.profiles (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT,
  avatar_url    TEXT,
  role          TEXT        NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- =============================================================================
-- ACCOUNTS
-- =============================================================================
-- A financial account belongs to one user.
-- Examples: "LPL - Retirement IRA", "Merrill - Joint Taxable", "Chase Checking"
-- =============================================================================

CREATE TABLE public.accounts (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                  TEXT        NOT NULL,
  institution           TEXT        NOT NULL,
  type                  TEXT        NOT NULL CHECK (type IN (
                                      'brokerage',
                                      'retirement',
                                      'checking',
                                      'savings',
                                      'other'
                                    )),
  account_number_last4  TEXT,
  is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_accounts_user_id ON public.accounts(user_id);

CREATE TRIGGER accounts_updated_at
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- =============================================================================
-- POSITIONS
-- =============================================================================
-- One row per ticker per account. Imported from CSV/QFX or entered manually.
-- Cash holdings use ticker = 'CASH' and shares = dollar amount.
-- UNIQUE(account_id, ticker) means imports upsert — no duplicates.
-- =============================================================================

CREATE TABLE public.positions (
  id                    UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id            UUID            NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,

  ticker                TEXT            NOT NULL,
  asset_name            TEXT,
  asset_type            TEXT            CHECK (asset_type IN (
                                          'stock',
                                          'etf',
                                          'mutual_fund',
                                          'cash',
                                          'other'
                                        )),

  shares                NUMERIC(18, 6)  NOT NULL DEFAULT 0,
  cost_basis            NUMERIC(18, 2)  NOT NULL DEFAULT 0,
  cost_basis_per_share  NUMERIC(18, 6)  GENERATED ALWAYS AS (
                          CASE WHEN shares > 0
                            THEN cost_basis / shares
                            ELSE 0
                          END
                        ) STORED,

  import_source         TEXT,
  imported_at           TIMESTAMPTZ,
  as_of_date            DATE,

  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  UNIQUE(account_id, ticker)
);

CREATE INDEX idx_positions_user_id    ON public.positions(user_id);
CREATE INDEX idx_positions_account_id ON public.positions(account_id);
CREATE INDEX idx_positions_ticker     ON public.positions(ticker);

CREATE TRIGGER positions_updated_at
  BEFORE UPDATE ON public.positions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- =============================================================================
-- PRICE CACHE
-- =============================================================================
-- Shared across all users. Refreshed nightly by the Express cron job.
-- CASH is always $1.00 and never fetched from Yahoo Finance.
-- =============================================================================

CREATE TABLE public.price_cache (
  ticker            TEXT        PRIMARY KEY,
  price             NUMERIC(18, 4),
  previous_close    NUMERIC(18, 4),
  change_amount     NUMERIC(18, 4),
  change_percent    NUMERIC(8, 4),
  currency          TEXT        DEFAULT 'USD',
  market_state      TEXT,
  last_fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetch_source      TEXT        DEFAULT 'yahoo'
);

CREATE INDEX idx_price_cache_last_fetched ON public.price_cache(last_fetched_at);

-- CASH is always $1.00 — insert once, the cron job keeps it current
INSERT INTO public.price_cache (ticker, price, previous_close, change_amount, change_percent, currency, market_state, fetch_source)
VALUES ('CASH', 1.00, 1.00, 0, 0, 'USD', 'CLOSED', 'static');


-- =============================================================================
-- IMPORT HISTORY
-- =============================================================================
-- Log of every file upload for debugging and showing last refresh time.
-- =============================================================================

CREATE TABLE public.import_history (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id      UUID        REFERENCES public.accounts(id) ON DELETE SET NULL,

  filename        TEXT        NOT NULL,
  file_format     TEXT        NOT NULL CHECK (file_format IN ('csv', 'qfx', 'ofx', 'manual')),
  institution     TEXT        NOT NULL,

  status          TEXT        NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  rows_parsed     INTEGER     DEFAULT 0,
  rows_imported   INTEGER     DEFAULT 0,
  rows_skipped    INTEGER     DEFAULT 0,
  error_detail    TEXT,

  as_of_date      DATE,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_import_history_user_id    ON public.import_history(user_id);
CREATE INDEX idx_import_history_account_id ON public.import_history(account_id);


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- (select auth.uid()) evaluates once per query instead of once per row
-- for better performance at scale.
-- =============================================================================

-- profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can view own profile"
  ON public.profiles FOR SELECT
  USING ((select auth.uid()) = id);

CREATE POLICY "users can update own profile"
  ON public.profiles FOR UPDATE
  USING ((select auth.uid()) = id);

-- accounts
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can view own accounts"
  ON public.accounts FOR SELECT
  USING ((select auth.uid()) = user_id);

CREATE POLICY "users can insert own accounts"
  ON public.accounts FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "users can update own accounts"
  ON public.accounts FOR UPDATE
  USING ((select auth.uid()) = user_id);

CREATE POLICY "users can delete own accounts"
  ON public.accounts FOR DELETE
  USING ((select auth.uid()) = user_id);

-- positions
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can view own positions"
  ON public.positions FOR SELECT
  USING ((select auth.uid()) = user_id);

CREATE POLICY "users can insert own positions"
  ON public.positions FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "users can update own positions"
  ON public.positions FOR UPDATE
  USING ((select auth.uid()) = user_id);

CREATE POLICY "users can delete own positions"
  ON public.positions FOR DELETE
  USING ((select auth.uid()) = user_id);

-- price_cache — readable by all authenticated users, written only by service role
ALTER TABLE public.price_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price cache is readable by all authenticated users"
  ON public.price_cache FOR SELECT
  TO authenticated
  USING (true);

-- import_history
ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can view own import history"
  ON public.import_history FOR SELECT
  USING ((select auth.uid()) = user_id);

CREATE POLICY "users can insert own import history"
  ON public.import_history FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);


-- =============================================================================
-- VIEWS
-- =============================================================================
-- security_invoker = true ensures RLS on underlying tables is enforced
-- when views are queried, preventing data leakage between users.
-- =============================================================================

-- Portfolio summary — current value and gain/loss per position
CREATE OR REPLACE VIEW public.portfolio_summary
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.user_id,
  p.account_id,
  a.name                                                        AS account_name,
  a.institution,
  a.type                                                        AS account_type,
  p.ticker,
  p.asset_name,
  p.asset_type,
  p.shares,
  p.cost_basis,
  p.cost_basis_per_share,
  p.import_source,
  p.as_of_date,

  pc.price                                                      AS current_price,
  pc.previous_close,
  pc.change_amount,
  pc.change_percent,
  pc.last_fetched_at                                            AS price_as_of,

  ROUND((p.shares * pc.price)::NUMERIC, 2)                     AS current_value,
  ROUND((p.shares * pc.price - p.cost_basis)::NUMERIC, 2)      AS gain_loss,
  CASE
    WHEN p.cost_basis > 0
    THEN ROUND(((p.shares * pc.price - p.cost_basis) / p.cost_basis * 100)::NUMERIC, 2)
    ELSE NULL
  END                                                           AS gain_loss_percent,
  ROUND((p.shares * pc.change_amount)::NUMERIC, 2)             AS days_change

FROM public.positions p
JOIN public.accounts a   ON p.account_id = a.id
LEFT JOIN public.price_cache pc ON p.ticker = pc.ticker
WHERE a.is_active = TRUE;

-- Account summary — rolled up totals per account
CREATE OR REPLACE VIEW public.account_summary
WITH (security_invoker = true)
AS
SELECT
  ps.user_id,
  ps.account_id,
  ps.account_name,
  ps.institution,
  ps.account_type,
  COUNT(ps.id)                    AS position_count,
  ROUND(SUM(ps.cost_basis), 2)    AS total_cost_basis,
  ROUND(SUM(ps.current_value), 2) AS total_current_value,
  ROUND(SUM(ps.gain_loss), 2)     AS total_gain_loss,
  ROUND(SUM(ps.days_change), 2)   AS total_days_change,
  MAX(ps.price_as_of)             AS price_as_of
FROM public.portfolio_summary ps
GROUP BY
  ps.user_id,
  ps.account_id,
  ps.account_name,
  ps.institution,
  ps.account_type;

-- Net worth summary — grand totals per user
CREATE OR REPLACE VIEW public.net_worth_summary
WITH (security_invoker = true)
AS
SELECT
  user_id,
  COUNT(DISTINCT account_id)      AS account_count,
  COUNT(id)                       AS position_count,
  ROUND(SUM(cost_basis), 2)       AS total_cost_basis,
  ROUND(SUM(current_value), 2)    AS total_current_value,
  ROUND(SUM(gain_loss), 2)        AS total_gain_loss,
  ROUND(SUM(days_change), 2)      AS total_days_change,
  CASE
    WHEN SUM(cost_basis) > 0
    THEN ROUND((SUM(gain_loss) / SUM(cost_basis) * 100)::NUMERIC, 2)
    ELSE NULL
  END                             AS total_gain_loss_percent
FROM public.portfolio_summary
GROUP BY user_id;


-- =============================================================================
-- GRANT VIEW ACCESS TO AUTHENTICATED USERS
-- =============================================================================
REVOKE ALL ON public.portfolio_summary FROM anon;
REVOKE ALL ON public.account_summary   FROM anon;
REVOKE ALL ON public.net_worth_summary FROM anon;

GRANT SELECT ON public.portfolio_summary TO authenticated;
GRANT SELECT ON public.account_summary   TO authenticated;
GRANT SELECT ON public.net_worth_summary TO authenticated;


-- =============================================================================
-- DONE
-- =============================================================================
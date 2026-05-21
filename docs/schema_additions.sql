-- =============================================================================
-- ptraker Schema Additions
-- =============================================================================
-- Run AFTER schema.sql in the Supabase Studio SQL Editor (one-time on a fresh DB).
--
-- Changes from baseline schema.sql:
--   1. profiles        — add notification_settings, discoverable; expand role CHECK
--   2. handle_new_user — updated to read intended_role from invite metadata
--   3. watchlist       — new table + RLS
--   4. user_invites    — new table
--   5. portfolio_shares — new table + RLS
--   6. role_requests   — new table + RLS
--   7. account_summary — add last_imported_at column
-- =============================================================================


-- =============================================================================
-- 1. PROFILES — additions
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_settings JSONB,
  ADD COLUMN IF NOT EXISTS discoverable BOOLEAN NOT NULL DEFAULT false;

-- Expand role CHECK to include 'viewer'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('user', 'admin', 'viewer'));


-- =============================================================================
-- 2. handle_new_user — read intended_role from invite metadata
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'intended_role', 'user')
  );
  RETURN NEW;
END;
$$;


-- =============================================================================
-- 3. WATCHLIST
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.watchlist (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker      TEXT        NOT NULL,
  asset_name  TEXT,
  asset_type  TEXT        CHECK (asset_type IN ('stock', 'etf', 'mutual_fund', 'cash', 'other')),
  notes       TEXT,
  added_from  TEXT        NOT NULL DEFAULT 'manual',
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON public.watchlist(user_id);

ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can view own watchlist"
  ON public.watchlist FOR SELECT
  USING ((select auth.uid()) = user_id);

CREATE POLICY "users can insert own watchlist"
  ON public.watchlist FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "users can update own watchlist"
  ON public.watchlist FOR UPDATE
  USING ((select auth.uid()) = user_id);

CREATE POLICY "users can delete own watchlist"
  ON public.watchlist FOR DELETE
  USING ((select auth.uid()) = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist TO authenticated;


-- =============================================================================
-- 4. USER_INVITES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_invites (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invited_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  email       TEXT        NOT NULL UNIQUE,
  role        TEXT        NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'viewer')),
  status      TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_invites_email      ON public.user_invites(email);
CREATE INDEX IF NOT EXISTS idx_user_invites_invited_by ON public.user_invites(invited_by);

ALTER TABLE public.user_invites ENABLE ROW LEVEL SECURITY;
-- All reads/writes go through service role (admin API) — no user-level policies needed


-- =============================================================================
-- 5. PORTFOLIO_SHARES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.portfolio_shares (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewer_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(owner_user_id, viewer_user_id)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_shares_owner  ON public.portfolio_shares(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_shares_viewer ON public.portfolio_shares(viewer_user_id);

ALTER TABLE public.portfolio_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can view own shares"
  ON public.portfolio_shares FOR SELECT
  USING ((select auth.uid()) = owner_user_id OR (select auth.uid()) = viewer_user_id);

CREATE POLICY "users can create shares"
  ON public.portfolio_shares FOR INSERT
  WITH CHECK ((select auth.uid()) = owner_user_id);

CREATE POLICY "owners can delete shares"
  ON public.portfolio_shares FOR DELETE
  USING ((select auth.uid()) = owner_user_id);

GRANT SELECT, INSERT, DELETE ON public.portfolio_shares TO authenticated;


-- =============================================================================
-- 6. ROLE_REQUESTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.role_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_role  TEXT        NOT NULL,
  message         TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_role_requests_user_id ON public.role_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_role_requests_status  ON public.role_requests(status);

ALTER TABLE public.role_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can view own role requests"
  ON public.role_requests FOR SELECT
  USING ((select auth.uid()) = user_id);

CREATE POLICY "users can insert own role requests"
  ON public.role_requests FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

GRANT SELECT, INSERT ON public.role_requests TO authenticated;


-- =============================================================================
-- 7. account_summary VIEW — add last_imported_at
-- =============================================================================

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
  MAX(ps.price_as_of)             AS price_as_of,
  (
    SELECT MAX(ih.imported_at)
    FROM public.import_history ih
    WHERE ih.account_id = ps.account_id
  )                               AS last_imported_at
FROM public.portfolio_summary ps
GROUP BY
  ps.user_id,
  ps.account_id,
  ps.account_name,
  ps.institution,
  ps.account_type;

GRANT SELECT ON public.account_summary TO authenticated;


-- =============================================================================
-- DONE
-- =============================================================================

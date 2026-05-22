-- =============================================================================
-- ptraker — Importer Registry Migration
-- =============================================================================
-- Run in Supabase Studio SQL Editor on any existing DB that already has
-- schema.sql + schema_additions.sql applied.
--
-- Changes:
--   1. importers               — importer metadata table (DB-managed registry)
--   2. user_importer_preferences — per-user importer enable/disable
--   3. import_history          — drop file_format CHECK constraint
--   4. Seed existing importers with descriptions and instructions
-- =============================================================================


-- =============================================================================
-- 1. IMPORTERS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.importers (
  id            text        PRIMARY KEY,
  name          text        NOT NULL,
  description   text        NOT NULL DEFAULT '',
  instructions  text        NOT NULL DEFAULT '',
  file_types    text[]      NOT NULL DEFAULT '{}',
  institutions  text[]      NOT NULL DEFAULT '{}',
  is_default    boolean     NOT NULL DEFAULT false,
  is_active     boolean     NOT NULL DEFAULT true,
  is_manual     boolean     NOT NULL DEFAULT false,
  multi_account boolean     NOT NULL DEFAULT false,
  display_order integer     NOT NULL DEFAULT 100
);

ALTER TABLE public.importers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can view importers"
  ON public.importers FOR SELECT
  TO authenticated
  USING (true);

-- Admin INSERT/UPDATE goes through service role (bypasses RLS)
GRANT SELECT ON public.importers TO authenticated;


-- =============================================================================
-- 2. USER_IMPORTER_PREFERENCES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_importer_preferences (
  user_id     uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  importer_id text    NOT NULL REFERENCES public.importers(id) ON DELETE CASCADE,
  is_enabled  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, importer_id)
);

ALTER TABLE public.user_importer_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can view own importer preferences"
  ON public.user_importer_preferences FOR SELECT
  USING ((select auth.uid()) = user_id);

CREATE POLICY "users can insert own importer preferences"
  ON public.user_importer_preferences FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "users can update own importer preferences"
  ON public.user_importer_preferences FOR UPDATE
  USING ((select auth.uid()) = user_id);

GRANT SELECT, INSERT, UPDATE ON public.user_importer_preferences TO authenticated;


-- =============================================================================
-- 3. IMPORT_HISTORY — drop file_format CHECK constraint
-- =============================================================================
-- New rows will store the importer id (e.g. 'lpl_csv', 'ofx_qfx') instead of
-- a generic category. Existing rows are left unchanged.

ALTER TABLE public.import_history
  DROP CONSTRAINT IF EXISTS import_history_file_format_check;


-- =============================================================================
-- 4. SEED EXISTING IMPORTERS
-- =============================================================================

INSERT INTO public.importers
  (id, name, description, instructions, file_types, institutions,
   is_default, is_active, is_manual, multi_account, display_order)
VALUES
  (
    'ofx_qfx',
    'OFX / QFX (Generic)',
    'Investment positions and bank balances — single file, all accounts. Works with LPL, Merrill, Schwab, CFCU, and most banks.',
    'Export from your brokerage or bank as an OFX or QFX file. Most brokerages offer this under Account > Statements & Documents > Download. The file can contain positions from multiple accounts — the importer will auto-match to your portfolio accounts by last 4 digits of the account number.',
    '{.ofx,.qfx}',
    '{lpl,cfcu,merrill,schwab,fidelity,other}',
    true, true, false, true, 10
  ),
  (
    'manual',
    'Manual Entry',
    'Manually enter a cash balance or a stock / fund position.',
    'No file needed. Use this to enter a cash balance for checking or savings accounts, or to add a stock or fund position directly. Exchange-listed stocks are looked up via Yahoo Finance. For private or unlisted stocks (not on any exchange), you can enter the price per share directly.',
    '{}',
    '{manual}',
    true, true, true, false, 20
  ),
  (
    'lpl_csv',
    'LPL Financial CSV',
    'Position export from LPL ClientWorks — handles single or all-accounts CSV.',
    E'Log in to LPL ClientWorks (clientworks.lpl.com).\nNavigate to Reports > Portfolio Review.\nSelect All Accounts to export all at once, or a specific account.\nChoose CSV as the export format and download the file.\nThe importer will auto-match accounts to your portfolio by last 4 digits.',
    '{.csv}',
    '{lpl}',
    false, true, false, true, 30
  ),
  (
    'cfcu_csv',
    'CFCU (Community First CU) CSV',
    'Transaction history CSV from Community First Credit Union. Auto-matches checking and savings accounts by last 4 digits.',
    E'Log in to Community First Credit Union online banking (communityfirstcu.org).\nSelect the account you want to export from the Accounts list.\nClick Transactions, then use the Export or Download option.\nSelect CSV format and download.\nIf you download a combined history covering multiple accounts, the importer will split them automatically.',
    '{.csv}',
    '{cfcu}',
    false, true, false, true, 40
  )
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- DONE
-- =============================================================================

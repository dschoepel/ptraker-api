-- =============================================================================
-- Import History Retention Setting
-- =============================================================================
-- Adds per-user import history retention limit to profiles.
-- NULL = unlimited (default). Integer = keep last N records.
-- Run in Studio SQL Editor before deploying API changes.
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS import_history_limit INTEGER DEFAULT NULL;

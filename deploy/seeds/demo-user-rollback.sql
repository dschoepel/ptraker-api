-- =============================================================================
-- Demo User Rollback — removes demo@ptraker.com and all their data
-- Run in Supabase Studio SQL Editor
-- =============================================================================

DO $$
DECLARE
  demo_id uuid;
BEGIN
  SELECT id INTO demo_id FROM auth.users WHERE email = 'demo@ptraker.com';

  IF demo_id IS NULL THEN
    RAISE NOTICE 'demo@ptraker.com not found — nothing to remove.';
    RETURN;
  END IF;

  DELETE FROM positions      WHERE user_id = demo_id;
  DELETE FROM import_history WHERE user_id = demo_id;
  DELETE FROM watchlist      WHERE user_id = demo_id;
  DELETE FROM accounts       WHERE user_id = demo_id;
  DELETE FROM profiles       WHERE id      = demo_id;
  DELETE FROM auth.users     WHERE id      = demo_id;

  RAISE NOTICE 'Demo user % removed successfully.', demo_id;
END $$;

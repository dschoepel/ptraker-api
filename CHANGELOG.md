# Changelog

All notable changes to ptraker-api are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [1.8.0] — 2026-07-07

### Fixed
- `handle_new_user` trigger: added `SET search_path = ''` to satisfy Supabase security advisor lint rule (function should not rely on mutable search path).

---

## [1.7.1] — 2026-05-31

### Fixed
- Watchlist search broken by Yahoo Finance changing `typeDisp` casing (`'equity'` → `'Equity'`), causing `FailedYahooValidationError` on every search request. Updated yahoo-finance2 from 3.14.1 → 3.15.2 (contains the schema fix) and added `{ validateResult: false }` to the `search()` call as a permanent guard against future Yahoo API drift.

### Changed
- GitHub Actions workflow: added `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` to opt all steps into Node.js 24 ahead of the June 16, 2026 forced migration.

---

## [1.7.0] — 2026-05-31

### Added
- `account_daily_snapshots` table — stores one row per account per trading day; RLS limits SELECT to the owning user; INSERT/UPDATE done via admin client in the snapshot service
- `accounts.include_in_snapshot` boolean column (default FALSE) — per-account opt-in flag for snapshot and backfill
- `src/services/snapshotService.js` — two exports:
  - `captureSnapshot()`: nightly job that reads current prices from `price_cache` and upserts a snapshot row for every opted-in account; called by scheduler after `fetchPrices()` completes
  - `backfill(userId, lookbackDays)`: fetches historical daily prices from Yahoo Finance `historical()` for every ticker in the user's opted-in accounts (split-adjusted via `adjClose`), filters to genuine trading days (no weekends, ≥40% of tickers must have data), bulk-upserts per-account rows; clears stale backfill rows before each run
- `GET /api/v1/analytics/history?days=N` — returns opted-in account metadata and flat snapshot rows for the requested range (30/90/180/365/730 days)
- `POST /api/v1/analytics/backfill` — triggers on-demand backfill for the requesting user (lookbackDays: 30/90/180/365/730); validates at least one opted-in account exists

### Changed
- `GET /api/v1/accounts` and `PATCH /api/v1/accounts/:id` now include and accept `include_in_snapshot` / `includeInSnapshot`
- Nightly scheduler calls `captureSnapshot()` after each `fetchPrices()` run; snapshot failure is non-fatal

---

## [1.6.1] — 2026-05-27

### Fixed
- Avatar upload stored internal Docker hostname (`ptraker-supabase-kong:8000`) as the public URL, making avatars unreachable in the browser. Now constructs the URL from `SUPABASE_PUBLIC_URL` env var (falls back to `SUPABASE_URL`). Set `SUPABASE_PUBLIC_URL=https://supabase.ptraker.com` in production `.env`.

---

## [1.6.0] — 2026-05-27

### Added
- `POST /auth/profile/avatar` — multipart image upload (max 2 MB, JPEG/PNG/WebP/GIF); stores file in `profile-avatars` Supabase Storage bucket, saves public URL to `profiles.avatar_url`
- `DELETE /auth/profile/avatar` — removes stored image from storage and clears `profiles.avatar_url`
- `docs/schema_avatars.sql` — creates the `profile-avatars` public storage bucket (run in Studio before deploying)
- multer avatar upload middleware in `auth.routes.js` with mime-type and size validation

---

## [1.5.0] — 2026-05-24

### Added
- `profiles.import_history_limit INTEGER DEFAULT NULL` column support: `getProfile` returns `importHistoryLimit`, `updateProfile` accepts it
- `src/lib/importHistory.js` — `runPurge(supabase, userId, limit)` helper that deletes records beyond the limit while always keeping the most-recent import per account (protects `last_imported_at` on the dashboard)
- `POST /user/purge-import-history` — manual purge endpoint using the user's stored limit; no-ops if limit is NULL
- `docs/schema_history_retention.sql` — migration adding the `import_history_limit` column

### Changed
- `GET /import/history`: account enrichment now fetches and returns `institution` alongside `id` and `name`, enabling the client to display the correct institution label in the import history grouped view
- Auto-purge runs non-fatally after every successful import when the user has a limit set

---

## [1.3.1] — 2026-05-22

### Fixed
- CFCU CSV importer: `fileTypes` entry was missing the dot prefix (`'csv'` → `'.csv'`), causing valid `.csv` uploads to be rejected with a false type mismatch error
- File type validation in `uploadFile` controller now normalizes accepted extensions to dot-prefixed form as a belt-and-suspenders safeguard

---

## [1.3.0] — 2026-05-22

### Added
- Pluggable importer registry: `importers` DB table stores name, description, instructions, file_types, is_default, is_active, display_order for each importer
- `user_importer_preferences` table: per-user enable/disable for non-default importers with RLS
- `GET /import/importers` queries DB and filters by user preferences; default importers (OFX/QFX, Manual Entry) always included; falls back to code registry if DB unavailable
- `GET/POST/PATCH /admin/importers` — admin endpoints to list, register, and update importers
- `GET/PATCH /user/importer-preferences` — user endpoints to get and update importer preferences
- `GET /user/export` now includes `importerPreferences` in the export payload
- `docs/schema_importers.sql` migration: creates both tables, RLS policies, seeds four importer records, drops `import_history.file_format` CHECK constraint

### Changed
- `POST /import/upload` now validates uploaded file extension against the importer's declared `fileTypes` — returns 400 with a clear message if mismatch
- `import_history.file_format` now stores the importer id (e.g. `lpl_csv`, `ofx_qfx`) instead of a generic category string

---

## [1.2.0] — 2026-05-21

### Added
- Private / unlisted stock support in `POST /import/manual` — when `price` is provided in the request body, Yahoo Finance lookup is skipped; shares are used directly and price is upserted into `price_cache`
- `deploy/seeds/demo-user.sql` — seed script creating a demo user with ~$1M sample portfolio across Schwab (3 retirement), Merrill Lynch (brokerage), US Bank (3 bank), and Other accounts
- `deploy/seeds/demo-user-rollback.sql` — cleanup script to remove demo user and all associated data

### Fixed
- `price_cache` upsert used wrong column name (`updated_at` instead of `last_fetched_at`) causing the upsert to silently fail and private stock prices not appearing on the dashboard

---

## [1.1.4] — 2026-05-21

### Added
- `GET /api/v1/version` — public endpoint returning `{ version }` used by client footer
- `GET /health` now also includes `version` field

---

## [1.1.3] — 2026-05-21

### Fixed
- Manual entry "Account not found" — account lookup now uses admin client; anon client has no user JWT so RLS blocked the query
- Same fix applied to single-account CSV upload path

---

## [1.1.2] — 2026-05-21

### Fixed
- CFCU CSV importer rewritten as multi-account (`multiAccount: true`) — no longer requires account selection; auto-matches checking/savings accounts by last 4 digits, eliminating "accountId is required for CSV imports" error

---

## [1.1.1] — 2026-05-21

### Fixed
- CFCU CSV import crash — `parse()` returns `{positions,skipped,errors}` not a plain array; controller now extracts the array before passing to `upsertPositions`
- CFCU CSV now filters imported positions to the selected account by last4 digits, preventing all CFCU account balances from landing in one account

---

## [1.1.0] — 2026-05-21

### Added
- `GET /import/importers` now includes the manual entry importer (with `isManual: true` flag) so the UI can display it alongside file importers

### Fixed
- Renamed `cfcu.csv.js` → `cfcu_csv.js` to match underscore naming convention and fix Linux case-sensitive build

---

## [1.0.0] — 2026-05-21

### Added
- Initial production release
- Auth: login, logout, token refresh, profile GET/PATCH
- Auth: invite flow via `generateLink` + nodemailer (GoTrue v2.186 bug workaround)
- Auth: forgot-password and reset-password via `generateLink`
- Accounts: full CRUD
- Positions: list, delete
- Import: LPL Financial CSV (multi-account, handles quoted newlines)
- Import: OFX/QFX — investment positions and bank balance (CFCU, Associated Bank)
- Import: CFCU transaction CSV (single-account, first-row balance)
- Import: manual entry (cash balance or fund/stock by market value)
- Import history log per upload
- Prices: Yahoo Finance quote integration (`yahoo-finance2` v3)
- Prices: nightly cron refresh (weekdays 5pm CT, configurable via `PRICE_REFRESH_CRON`)
- Dashboard: portfolio summary with current prices and gain/loss
- Watchlist: CRUD, Yahoo Finance symbol search, price history for sparklines
- Admin: user management (list, invite, role change, delete)
- Admin: role upgrade requests (viewer → user) with ntfy + email notifications
- Admin: notification settings (ntfy push + email) with test endpoint
- Portfolio sharing: share with existing users or auto-invite new viewers
- User: upgrade request, data export, self-service account deletion
- Winston structured logging
- Helmet + CORS security middleware
- Health check endpoint at `GET /health`

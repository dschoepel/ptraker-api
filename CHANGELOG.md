# Changelog

All notable changes to ptraker-api are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

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

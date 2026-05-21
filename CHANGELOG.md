# Changelog

All notable changes to ptraker-api are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

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

# ptraker-api — Claude Development Guide

## Project
Personal investment portfolio tracker backend.
Tracks $2M+ across 12 accounts (LPL Financial, CFCU, Associated Bank/NJSD).

## Repos
- API:    https://github.com/dschoepel/ptraker-api     (E:\ptraker\ptraker-api)
- Client: https://github.com/dschoepel/ptraker-client  (E:\ptraker\ptraker-client)

## Stack
- Node.js 23 / Express 4
- Supabase PostgreSQL (self-hosted, dev: http://10.0.10.60:8100)
- yahoo-finance2 v3 (YahooFinance class pattern, not default export)
- nodemailer (GoTrue v2.186 bug — all auth emails sent manually via generateLink)
- Winston logger

## Dev Infrastructure
- Dev Supabase: Mercury 10.0.10.60
  - Kong: 8100, Postgres: 5434, Studio: http://10.0.10.60:3002
  - Stack: supabase-ptraker, containers: ptraker-supabase-*
  - Templates: /data/supabase-ptraker/volumes/templates/
- ENABLE_EMAIL_AUTOCONFIRM=false (required)
- GoTrue v2.186 bug: invite AND recovery emails silently skipped
  → Use generateLink + nodemailer for BOTH invite and password reset

## Key Patterns

### Supabase Clients
```javascript
getAnonClient()   // respects RLS — for user-scoped queries
getAdminClient()  // bypasses RLS — for cross-user ops, history inserts
```

### yahoo-finance2 v3
```javascript
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
// use yf.quote(), yf.search() — autoc decommissioned
// yf.historical() maps to chart() internally in v3.14+; suppress 'ripHistorical' notice
// historical() requires explicit period2 (not undefined) or validation fails
// omit events option entirely — passing events:'history' maps to '' and fails ChartOptions schema
```

### Supabase .catch() — NOT supported on query builder
```javascript
// WRONG:
await supabase.from('table').insert({...}).catch(e => ...)
// CORRECT:
const { error } = await supabase.from('table').insert({...});
if (error) logger.warn(error.message);
// OR wrap in try/catch
```

## Database Schema

### Tables
- `profiles` — display_name, role (user/admin/viewer), notification_settings JSONB, discoverable BOOLEAN
- `accounts` — institution, type, account_number_last4, is_active, include_in_snapshot, user_id
- `account_daily_snapshots` — user_id, account_id, snapshot_date DATE, total_value, total_cost_basis (NULL on backfill), is_backfilled; UNIQUE(account_id, snapshot_date)
- `positions` — ticker, shares, cost_basis, asset_type, as_of_date, account_id, user_id
- `price_cache` — shared, CASH always $1.00
- `import_history` — see constraints below
- `watchlist` — ticker, asset_name, asset_type, notes, added_from, added_at
- `importers` — id (PK, matches JS module key), name, description, instructions, file_types[], institutions[], is_default, is_active, is_manual, multi_account, display_order
- `user_importer_preferences` — (user_id, importer_id) PK, is_enabled; RLS per-user; default importers always shown regardless of preferences
- `user_invites` — invited_by, email, role, status
- `portfolio_shares` — owner_user_id, viewer_user_id, label
- `role_requests` — user_id, requested_role, message, status, reviewed_by

### Views (security_invoker=true)
- `portfolio_summary`, `account_summary` (includes last_imported_at), `net_worth_summary`

### import_history Constraints
```sql
-- file_format CHECK: csv, qfx, ofx, manual ONLY
-- status CHECK: success, partial, failed ONLY
-- No rows_removed column
-- Columns: id, user_id, account_id, filename, file_format, institution,
--          status, rows_parsed, rows_imported, rows_skipped,
--          error_detail, as_of_date, imported_at
```

### Key SQL — handle_new_user trigger
```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'intended_role', 'user'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## Import Pipeline

### Importer Interface
All file importers must export:
- `id`, `name`, `description`, `fileTypes`, `institutions`
- `multiAccount: true` if handles multiple accounts
- `parseMulti(buffer)` → `{ accounts: [{ acctId, positions[] }], errors[] }` (multi-account)
- `parse(buffer)` → `positions[]` (single-account, legacy)
- `matchAccounts(parsedAccounts, dbAccounts)` → `{ matched, unmatched }`

### Current Importers
| Importer | File | Multi | Notes |
|---|---|---|---|
| `lpl_csv` | LPL Financial CSV | ✅ | Handles quoted newlines in descriptions |
| `ofx_qfx` | Any OFX/QFX | ✅ | Investment (INVSTMTMSGSRSV1) + Bank (BANKMSGSRSV1) |
| `cfcu_csv` | CFCU transaction CSV | ✅ | Multi-account, auto-matches by last4, uses first row balance per account |
| `manual` | No file | ❌ | Cash balance or fund/stock by market value |

### OFX/QFX Parser — Two Message Types
```
INVSTMTMSGSRSV1 → investment positions from <INVPOSLIST>
BANKMSGSRSV1    → bank balance from <LEDGERBAL> as CASH position
```

### Cost Basis Behaviour
- `ofx_qfx`: preserves existing cost_basis on update (OFX has no cost basis data)
- `lpl_csv`: full upsert — writes cost_basis from file
- `manual`: writes cost_basis as provided

### Account Matching
All multi-account importers match by last-4 digits of account number.
```javascript
const last4 = String(parsed.acctId).slice(-4);
const dbAcct = dbAccounts.find(a => String(a.account_number_last4).trim() === last4);
```

## API Routes (all under /api/v1/)
- auth: login, logout, refresh, profile GET/PATCH, forgot-password, reset-password
- accounts: GET, POST, PATCH/:id, DELETE/:id  (`includeInSnapshot` bool accepted on PATCH)
- positions: GET list, DELETE/:id
- import: GET /importers (DB-filtered by user prefs), POST /upload (multipart + file type validation), POST /manual, GET /history
- prices: POST /refresh
- dashboard: GET
- analytics: GET /history?days=N, POST /backfill `{ lookbackDays }` (see snapshotService.js)
- watchlist: GET, GET /search, GET /:ticker/history, POST, PATCH/:ticker, DELETE/:ticker
- admin: GET/POST/DELETE /users, POST /invite, GET/PATCH /role-requests/:id, GET/PATCH/POST /notification-settings(/test), GET/POST/PATCH /importers
- shares: GET /, GET /discoverable-users, POST /, DELETE /:id, GET /:ownerId/dashboard
- user: POST /request-upgrade, GET /upgrade-request, GET /export, DELETE /account, GET/PATCH /importer-preferences

### Route Registration Order — matters!
```javascript
router.get('/discoverable-users', ...); // BEFORE /:ownerId/dashboard
router.get('/search', ...);             // BEFORE /:ticker
```

## Notifications
Stored in `profiles.notification_settings` JSONB:
```json
{
  "ntfy":  { "enabled": true, "url": "https://ntfy.schoepels.com", "topic": "ptraker-alerts", "token": "" },
  "email": { "enabled": true, "recipient": "dave@theschoepels.com" }
}
```
Ntfy headers: sanitize with `str.replace(/[^\x00-\x7F]/g, '')`

## Environment Variables
```
SUPABASE_URL=http://10.0.10.60:8100
SUPABASE_SERVICE_ROLE_KEY=<key>
SMTP_HOST=theschoepels-com-smtp.dynu.com
SMTP_PORT=587
SMTP_USER=dave@theschoepels.com
SMTP_PASS=<password>
SMTP_SENDER_NAME=portfolioTraker
SMTP_FROM_EMAIL=ptraker@theschoepels.com
CLIENT_URL=http://localhost:5173
```

## Financial Accounts
| Account | Institution | Type | Last 4 |
|---|---|---|---|
| April's Inherited IRA | lpl | retirement | 9584 |
| April's Roth IRA | lpl | retirement | 0517 |
| D and A Non IRA Account | lpl | brokerage | 0878 |
| Dave's Inherited IRA | lpl | retirement | 0509 |
| Dave's K-C Roll-Over IRA | lpl | retirement | 0505 |
| Dave's Roth IRA | lpl | retirement | 0502 |
| Dave's Stocks | lpl | brokerage | 2461 |
| CFCU Checking | cfcu | checking | 7845 |
| CFCU Regular Savings | cfcu | savings | 8400 |
| CFCU Money Market Savings | cfcu | savings | 8405 |
| NJSD 403(b) Plan | associated | retirement | 9001 |
| NJSD Deferred Comp 457 | associated | retirement | 9000 |

NJSD plans: import via Manual Entry → Fund/Stock mode quarterly.

## Pending / TODO
- [ ] Merrill Lynch CSV importer
- [ ] Schwab CSV importer
- [x] Production deployment (Dockerfile, Jupiter VPS 142.202.190.9, ptraker.com DNS)

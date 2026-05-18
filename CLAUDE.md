# ptraker — Project Context for Claude

This file provides context for Claude (VSCode extension and claude.ai chat)
about the ptraker project architecture, decisions made, and plans.

Last updated: May 2026

---

## What This App Does

portfolioTraker (ptraker) is a personal investment portfolio tracker:
- Consolidates holdings across multiple financial institutions
- Imports position data from CSV/QFX exports and manual entry
- Fetches daily prices from Yahoo Finance
- Watchlist with sparkline chart data and symbol search
- Consolidated dashboard with current values and gain/loss

---

## Repositories

- **API:** https://github.com/dschoepel/ptraker-api (this repo)
- **Client:** https://github.com/dschoepel/ptraker-client

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 23 (dev) / 22 LTS (prod) |
| Framework | Express 4 |
| Database | PostgreSQL via self-hosted Supabase |
| Auth | Supabase Auth (JWT) |
| Price data | yahoo-finance2 v3 |
| Scheduler | node-cron |
| File parsing | papaparse (CSV), ofx-js (QFX) |
| Logging | Winston |

### yahoo-finance2 v3 Usage

```javascript
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// Search (autoc is decomissioned — use search)
const result = await yahooFinance.search(q);

// Quote
const quote = await yahooFinance.quote(ticker);

// Chart (historical for sparklines)
const chart = await yahooFinance.chart(ticker, { period1: '2026-04-01', interval: '1d' });
```

---

## Infrastructure

### Development
- **API:** Windows (E:\ptraker\ptraker-api), `npm run dev`, port 5000
- **Supabase dev:** Mercury (10.0.10.60)
  - Stack: `supabase-ptraker`, containers: `ptraker-supabase-*`
  - Kong: 8100, Postgres: 5434, Studio: http://10.0.10.60:3002

### Production (planned)
- **Jupiter VPS** — ptraker-api (Docker/Portainer) + ptraker-client (Swag static)
- **New LAN server** — production Supabase slim stack
- **Domain:** ptraker.com

---

## Database Schema

### Tables
- `profiles` — display_name, role (user/admin), avatar_url
- `accounts` — institution, type, account_number_last4, is_active
- `positions` — ticker, shares, cost_basis, asset_type, as_of_date
- `price_cache` — shared, ticker PK, includes CASH at $1.00
- `import_history` — account_id, status, rows counts, as_of_date, file_format
- `watchlist` — ticker, asset_name, asset_type, notes, added_from, added_at

### Views
- `portfolio_summary` — positions + prices + calculations
- `account_summary` — per account rollup + `last_imported_at` (subquery on import_history)
- `net_worth_summary` — grand totals per user

All views: `security_invoker=true`, anon revoked, authenticated granted.
RLS: `(select auth.uid())` pattern on all tables.

### account_summary last_imported_at
```sql
(SELECT MAX(ih.imported_at) FROM public.import_history ih
 WHERE ih.account_id = ps.account_id
 AND ih.status IN ('success', 'partial')) AS last_imported_at
```

---

## Supabase Client Pattern

```javascript
const { getAnonClient, getAdminClient } = require('../lib/supabase');
// getAnonClient() — respects RLS, JWT validation only
// getAdminClient() — bypasses RLS, all data operations
```

---

## Import Pipeline

Plugin architecture: `src/importers/`
Each plugin: `parse(buffer) → { positions, skipped, errors }`
Upsert on `UNIQUE(account_id, ticker)`

### Sync-delete
When `syncMode=true` in upload request:
- Removes positions from DB not present in file
- Returns `removedPositions[]` in response for watchlist integration

### Manual Entry
- `POST /api/v1/import/manual` — no file, just JSON body
- Uses `manual.js` importer (isManual: true flag)
- Creates a single CASH position with balance as shares
- Used for bank accounts with no recent transactions

### Import History file_format values
`'csv'` | `'qfx'` | `'ofx'` | `'manual'`

---

## Import Plugins

| Plugin | Institution | Format | Status | Notes |
|---|---|---|---|---|
| `lpl_csv` | LPL Financial | CSV | ✅ Complete | Multi-account, BOM handling |
| `cfcu_csv` | Community First CU | CSV | ✅ Complete | Transaction history, uses latest balance |
| `manual` | Any | Manual | ✅ Complete | Balance entry, isManual flag |
| `lpl_qfx` | LPL Financial | QFX | 🔜 Planned | |
| `merrill_csv` | Merrill Lynch | CSV | 🔜 Planned | |
| `schwab_csv` | Schwab | CSV | 🔜 Planned | |

### LPL CSV Notes
- UTF-8 BOM: strip 0xEF 0xBB 0xBF from buffer
- Security types: `Common Stock` → stock, `Mutual Fund - Open-end` → mutual_fund
- `9999227` CUSIP → CASH, `----` → skip

### CFCU CSV Notes
- Transaction history format — NOT current balance export
- Rows ordered newest first — take first row per Account ID for current balance
- Account ID in file matches last 4 digits of account number
- Date format: `MM/DD/YY`
- Balance format: `"$2,727.67"` with quotes and commas

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | /health | Health check |
| POST | /api/v1/auth/login | Login |
| POST | /api/v1/auth/logout | Logout |
| POST | /api/v1/auth/refresh | Refresh token |
| GET | /api/v1/auth/profile | Get profile |
| PATCH | /api/v1/auth/profile | Update profile |
| POST | /api/v1/auth/forgot-password | Send reset email |
| POST | /api/v1/auth/reset-password | Set new password |
| GET | /api/v1/accounts | List accounts |
| POST | /api/v1/accounts | Create account |
| PATCH | /api/v1/accounts/:id | Update account |
| DELETE | /api/v1/accounts/:id | Delete account |
| GET | /api/v1/positions | All positions with prices |
| DELETE | /api/v1/positions/:id | Remove position |
| GET | /api/v1/import/importers | List plugins |
| POST | /api/v1/import/upload | Upload CSV/QFX (multipart) |
| POST | /api/v1/import/manual | Manual balance entry (JSON) |
| GET | /api/v1/import/history | Import history |
| GET | /api/v1/prices | Cached prices |
| POST | /api/v1/prices/refresh | Manual price refresh |
| GET | /api/v1/dashboard | Full dashboard data |
| GET | /api/v1/watchlist | User watchlist with prices |
| GET | /api/v1/watchlist/search?q= | Symbol search |
| GET | /api/v1/watchlist/:ticker/history | 30-day sparkline data |
| POST | /api/v1/watchlist | Add to watchlist |
| PATCH | /api/v1/watchlist/:ticker | Update notes |
| DELETE | /api/v1/watchlist/:ticker | Remove from watchlist |

### Route order matters for watchlist
```javascript
router.get('/search', requireAuth, watchlistController.search);      // BEFORE /:ticker
router.get('/:ticker/history', requireAuth, watchlistController.getHistory);
```

---

## Financial Accounts (Dave's)

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
| April's 403(b) Plan | schwab | retirement | 9999 |
| April's Deferred Compensation 457 | schwab | retirement | 9999 |

---

## Cash Account Display Rules

Bank/cash accounts (type: checking, savings) should show `—` for:
- Gain/Loss (balance is not a gain — cost basis is $0)
- Today's Change (cash doesn't move with markets)

Check in Dashboard.jsx `AccountPanelHeader` and `AccountPositionsTable` summary row.

---

## Coding Pattern

```javascript
const handler = async (req, res, next) => {
  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase.from('table').select('*');
    if (error) return next(error);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};
```

---

## Dev Email Reset Link Issue
GoTrue builds links from request Host header.
In dev: shows `https://10.0.10.60` — change to `http://10.0.10.60:8100` manually.
Production works correctly with proper domain.

---

## TODO

- [ ] User invite flow (admin invites family members by email)
- [ ] Portfolio sharing (view-only access between users)
- [ ] LPL QFX importer
- [ ] Merrill Lynch CSV importer
- [ ] Schwab CSV importer
- [ ] Email template branding
- [ ] OTP password reset code entry
- [ ] Data export endpoint
- [ ] Account deletion with password confirmation
- [ ] Mobile view for Accounts page
- [ ] Profile/settings page
- [ ] Dockerfile for production deployment
- [ ] Production Supabase server provisioning
- [ ] ptraker.com DNS configuration

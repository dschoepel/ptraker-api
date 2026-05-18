# ptraker — Project Context for Claude

This file provides context for Claude (VSCode extension and claude.ai chat)
about the ptraker project architecture, decisions made, and plans.

Last updated: May 2026

---

## What This App Does

portfolioTraker (ptraker) is a personal investment portfolio tracker that:
- Consolidates holdings across multiple financial institutions
- Imports position data from CSV/QFX exports
- Fetches daily prices from Yahoo Finance
- Shows a consolidated dashboard with current values and gain/loss

---

## Repositories

- **API:** https://github.com/dschoepel/ptraker-api (this repo)
- **Client:** https://github.com/dschoepel/ptraker-client (React frontend)

---

## Tech Stack

| Layer | Technology |
|---|---|
| API | Node.js 23 (dev) / 22 LTS (prod), Express 4 |
| Database | PostgreSQL via self-hosted Supabase |
| Auth | Supabase Auth (JWT) |
| Price data | yahoo-finance2 v3 |
| Scheduler | node-cron |
| File parsing | papaparse (CSV), ofx-js (QFX) |
| Logging | Winston |

### yahoo-finance2 v3 Usage (breaking change from v2)
```javascript
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
```

---

## Infrastructure

### Development
- **API:** runs locally on Windows (E:\ptraker\ptraker-api), `npm run dev`, port 5000
- **Supabase dev:** self-hosted Docker on Mercury (10.0.10.60)
  - Stack name: `supabase-ptraker`
  - Container prefix: `ptraker-supabase-*`
  - Kong: port 8100
  - Postgres: port 5434
  - Studio: http://10.0.10.60:3002
  - Public URL: https://pt-api.schoepels.com
- **Earth:** LAN hardware in DMZ, Nginx reverse proxy

### Production (planned)
- **Jupiter VPS** (142.202.190.9, Ubuntu 22.04, 8GB RAM)
  - Runs Swag (SSL + Nginx routing via Portainer)
  - ptraker-api → Docker container managed by Portainer
  - ptraker-client → static files served by Swag/Nginx
- **New LAN server** — production Supabase slim stack
- **Domain:** ptraker.com (purchased, not yet configured)

### DNS Plan (production)
```
ptraker.com        A → Earth → Jupiter:443 (Swag)
api.ptraker.com    A → Earth → Jupiter:443 (Swag)
```

---

## Key Architectural Decisions

### Database
- PostgreSQL via self-hosted Supabase
- All queries through PostgREST REST API (no direct pg connections)
- Two Supabase client singletons:
  - `getAnonClient()` — respects RLS, used for JWT validation only
  - `getAdminClient()` — bypasses RLS, used for all data operations
- RLS on all tables using `(select auth.uid())` pattern for performance

### Auth
- Supabase Auth handles everything
- Express middleware validates JWT via `supabase.auth.getUser(token)`
- Separate `profiles` table extends `auth.users`
- Profile row auto-created by trigger on auth.users insert
- Password reset uses `adminClient.auth.admin.updateUserById()`

### Import Pipeline
- Plugin architecture — each institution has its own parser in `src/importers/`
- All parsers: `parse(buffer) → { positions, skipped, errors }`
- Positions upserted on `UNIQUE(account_id, ticker)`
- Account matching: last 4 digits of account number from CSV

### yahoo-finance2 v3
```javascript
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
```

### Price Refresh
- Nightly cron: `PRICE_REFRESH_CRON=0 16 * * 1-5` (4pm CT weekdays)
- CASH always priced at $1.00, added to price_cache on every refresh
- Manual refresh: `POST /api/v1/prices/refresh`

---

## Database Schema

### Tables
- `profiles` — display_name, role (user/admin), avatar_url
- `accounts` — institution, type, account_number_last4, is_active
- `positions` — ticker, shares, cost_basis, asset_type, import_source, as_of_date
- `price_cache` — shared across all users, ticker as PK
- `import_history` — log of every file upload, account_id, status, rows

### Views
- `portfolio_summary` — positions + price_cache + calculations
- `account_summary` — rolled up per account, includes `last_imported_at`
  (subquery on import_history for last successful import per account)
- `net_worth_summary` — grand totals per user

All views: `security_invoker = true`, anon revoked, authenticated granted.
RLS policies use `(select auth.uid())` for performance.

---

## Users & Multi-tenancy

- Every table scoped by `user_id`
- RLS enforced at DB level
- Roles: `user` (default), `admin`
- Admin cannot see other users' financial data (RLS applies to all)
- Studio access bypasses RLS — keep Studio stopped when not needed

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

## Import Plugins

| Plugin | Institution | Format | Status |
|---|---|---|---|
| `lpl_csv` | LPL Financial | CSV | ✅ Complete |
| `lpl_qfx` | LPL Financial | QFX/Quicken | 🔜 Planned |
| `merrill_csv` | Merrill Lynch | CSV | 🔜 Planned |
| `cfcu_csv` | Community First CU | CSV | 🔜 Planned |
| `schwab_csv` | Schwab | CSV | 🔜 Planned |
| `manual` | Any | UI form | 🔜 Planned |

### LPL CSV Notes
- UTF-8 BOM: strip bytes 0xEF 0xBB 0xBF from buffer before parsing
- RapidAPI re-encodes files — use PowerShell or node test script for testing
- Security type map includes: Common Stock → stock, Mutual Fund - Open-end → mutual_fund
- `9999227` CUSIP = Insured Cash Account → CASH ticker
- `----` symbol = bare cash placeholder row, skip it

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
| GET | /api/v1/accounts/:id | Get account |
| POST | /api/v1/accounts | Create account |
| PATCH | /api/v1/accounts/:id | Update account |
| DELETE | /api/v1/accounts/:id | Delete account |
| GET | /api/v1/positions | All positions with prices |
| GET | /api/v1/positions/:id | Get position |
| DELETE | /api/v1/positions/:id | Remove position |
| GET | /api/v1/import/importers | List import plugins |
| POST | /api/v1/import/upload | Upload CSV/QFX (multipart) |
| GET | /api/v1/import/history | Import history |
| GET | /api/v1/prices | All cached prices |
| POST | /api/v1/prices/refresh | Manual price refresh |
| POST | /api/v1/prices/refresh/tickers | Refresh specific tickers |
| GET | /api/v1/dashboard | Full dashboard data |

---

## Coding Patterns

```javascript
// Every route handler — no exceptions
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

Never use callbacks. Never mix async/await with .then(). Always try/catch.

---

## Frontend Context

- React 19 + Vite + Ant Design v6
- Auth token in localStorage as `ptraker_token`
- All API calls: `Authorization: Bearer <token>`
- Axios interceptor auto-refreshes on 401
- Dashboard: single `GET /api/v1/dashboard` call
- File uploads: multipart/form-data, fields: `file`, `importerId`, `accountId`
- Client URL dev: `http://localhost:5173` — must match `CLIENT_URL` in `.env`

---

## Known Issues / TODO

- [ ] Sync-delete on import (remove positions no longer in file)
- [ ] Watchlist table + API endpoints
- [ ] LPL QFX importer
- [ ] Merrill Lynch CSV importer
- [ ] CFCU bank CSV importer
- [ ] Schwab CSV importer
- [ ] Manual position entry
- [ ] User invite flow (admin invites family members)
- [ ] Portfolio sharing (view-only access)
- [ ] Data export endpoint
- [ ] Account deletion endpoint
- [ ] Email templates branding (Studio templates UI has skeleton loading bug)
- [ ] OTP code entry for password reset
- [ ] Dockerfile + docker-compose for production
- [ ] Production Supabase server not yet provisioned
- [ ] ptraker.com DNS not yet configured

## Dev Email Reset Link Issue
GoTrue builds email verification links using request Host header.
In dev: links show `https://10.0.10.60` (no port).
Workaround: manually change to `http://10.0.10.60:8100` in browser.
Production (pt-api.schoepels.com / api.ptraker.com): works correctly.

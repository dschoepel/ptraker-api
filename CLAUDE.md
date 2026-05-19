# ptraker — Project Context for Claude

This file provides context for Claude (VSCode extension and claude.ai chat)
about the ptraker project architecture, decisions made, and plans.

Last updated: May 2026

---

## What This App Does

portfolioTraker (ptraker) is a personal investment portfolio tracker:
- Consolidates holdings across multiple financial institutions
- Imports position data from CSV exports and manual entry
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
| File parsing | papaparse (CSV) |
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
- `import_history` — account_id, status, rows, as_of_date, file_format
- `watchlist` — ticker, asset_name, asset_type, notes, added_from, added_at

### Views
- `portfolio_summary` — positions + prices + calculations
- `account_summary` — per account rollup + `last_imported_at`
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

## Import Plugins

| Plugin | Institution | Format | Status | Notes |
|---|---|---|---|---|
| `lpl_csv` | LPL Financial | CSV | ✅ | Multi-account, BOM handling |
| `cfcu_csv` | Community First CU | CSV | ✅ | Transaction history, uses latest balance per account |
| `manual` | Any | Manual | ✅ | Cash balance OR fund/stock by market value |
| `lpl_qfx` | LPL Financial | QFX | 🔜 | |
| `merrill_csv` | Merrill Lynch | CSV | 🔜 | |
| `schwab_csv` | Schwab | CSV | 🔜 | |

### Manual Importer — Two Modes

**Cash mode** (ticker=CASH):
- `shares` = dollar balance
- `costBasis` = 0

**Fund/Stock mode** (any other ticker):
- Fetches current price from price_cache or Yahoo Finance
- `shares` = marketValue / currentPrice (back-calculated)
- `costBasis` = from statement (total net investments)
- After upsert: calls `fetchPricesForTickers` to populate price_cache immediately

### LPL CSV Notes
- UTF-8 BOM: strip 0xEF 0xBB 0xBF
- `Common Stock` → stock, `Mutual Fund - Open-end` → mutual_fund
- `9999227` CUSIP → CASH, `----` → skip

### CFCU CSV Notes
- Transaction history, newest row first
- Take first row per Account ID for current balance
- Date: `MM/DD/YY`, Balance: `"$2,727.67"`

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
| NJSD 403(b) Plan | associated | retirement | 9001 |
| NJSD Deferred Compensation 457 | associated | retirement | 9000 |

### NJSD Plans (Associated Bank / Schwab platform)
- Administered by local bank using Schwab technology
- No CSV/QFX export available — quarterly PDF statements only
- Fund: VTTHX (Vanguard Target Retire 2035)
- Import method: Manual Entry → Fund/Stock mode
- Shares back-calculated from market value / current VTTHX price
- Cost basis from "Total net investments" on dashboard chart

---

## Cash Account Display Rules

Bank accounts (checking, savings) show `—` for gain/loss and today's change.
Cost basis = $0 for cash, so gain = balance which is misleading.
Check account_type in both dashboard header and positions table summary row.

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
| DELETE | /api/v1/positions/:id | Delete single position |
| GET | /api/v1/import/importers | List plugins |
| POST | /api/v1/import/upload | Upload CSV/QFX (multipart) |
| POST | /api/v1/import/manual | Manual entry (JSON) |
| GET | /api/v1/import/history | Import history |
| GET | /api/v1/prices | Cached prices |
| POST | /api/v1/prices/refresh | Manual price refresh |
| GET | /api/v1/dashboard | Full dashboard data |
| GET | /api/v1/watchlist | Watchlist with prices |
| GET | /api/v1/watchlist/search?q= | Symbol search |
| GET | /api/v1/watchlist/:ticker/history | 30-day sparkline data |
| POST | /api/v1/watchlist | Add ticker |
| PATCH | /api/v1/watchlist/:ticker | Update notes |
| DELETE | /api/v1/watchlist/:ticker | Remove ticker |

### Route order — watchlist
```javascript
router.get('/search', ...)         // BEFORE /:ticker
router.get('/:ticker/history', ...) // BEFORE /:ticker plain
router.get('/:ticker', ...)
```

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

- [ ] User invite flow (admin invites family by email) ← NEXT
- [ ] Portfolio sharing (view-only access between users) ← NEXT
- [ ] LPL QFX importer
- [ ] Merrill Lynch CSV importer
- [ ] Schwab CSV importer
- [ ] Email template branding
- [ ] OTP password reset code entry
- [ ] Data export endpoint
- [ ] Account deletion with password confirmation
- [ ] Mobile view for Accounts page
- [ ] Profile/settings page
- [ ] Dockerfile for production
- [ ] Production Supabase server
- [ ] ptraker.com DNS

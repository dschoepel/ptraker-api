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
| Price data | yahoo-finance2 v3 (ESM, use `require('yahoo-finance2').default` then `new YahooFinance()`) |
| Scheduler | node-cron |
| File parsing | papaparse (CSV), ofx-js (QFX) |
| Logging | Winston |
| Frontend | React + Vite + Ant Design v5 |

---

## Infrastructure

### Development
- **API:** runs locally on Windows (E:\ptraker\ptraker-api), `npm run dev`, port 5000
- **Supabase dev:** self-hosted Docker on Mercury (10.0.10.60)
  - Kong: port 8100
  - Postgres: port 5434
  - Studio: http://10.0.10.60:3002
  - Public URL: https://pt-api.schoepels.com
- **Earth:** LAN hardware in DMZ, Nginx reverse proxy, proxies pt-api.schoepels.com → Mercury:8100

### Production (planned — not yet deployed)
- **Jupiter VPS** (142.202.190.9, Ubuntu 22.04, 8GB RAM)
  - Runs Swag (SSL termination + Nginx routing via Portainer)
  - ptraker-api → Docker container managed by Portainer
  - ptraker-client → static files served by Swag/Nginx
- **New LAN server** (to be provisioned)
  - Production Supabase slim stack (same pattern as Mercury dev)
  - Ports: Kong 8200, Postgres 5435, Pooler 6545, Studio 3003
- **Earth** — passes ptraker.com and api.ptraker.com through to Jupiter
- **Domain:** ptraker.com (purchased, not yet configured)

### DNS Plan (production)
```
ptraker.com        A  →  Earth public IP  →  Jupiter:443 (Swag)
api.ptraker.com    A  →  Earth public IP  →  Jupiter:443 (Swag)
```

### Swag proxy confs needed (Jupiter)
```
/config/nginx/proxy-confs/ptraker.subdomain.conf      → React static files
/config/nginx/proxy-confs/ptraker-api.subdomain.conf  → ptraker-api:5000
```

---

## Key Architectural Decisions

### Database
- PostgreSQL via self-hosted Supabase (NOT MongoDB)
- All queries go through PostgREST REST API (no direct pg connections)
- Two Supabase clients — both singletons to prevent heap growth:
  - `getAnonClient()` — respects RLS, used for JWT validation only
  - `getAdminClient()` — bypasses RLS, used for all data operations
- Row Level Security enforced on all tables using `(select auth.uid())` pattern for performance

### Auth
- Supabase Auth handles everything — signup, login, JWT, email verify, password reset
- Express middleware validates JWT on every protected route via `supabase.auth.getUser(token)`
- No refresh token handling in Express — client manages refresh via Supabase JS SDK
- Separate `profiles` table extends `auth.users` with display_name, avatar_url, role
- Profile row auto-created by trigger on auth.users insert

### Import Pipeline
- Plugin architecture — each institution has its own parser in `src/importers/`
- All parsers implement the same interface: `parse(buffer) → { positions, skipped, errors }`
- Positions upserted on `UNIQUE(account_id, ticker)` — re-importing same file is safe
- Account matching: last 4 digits of account number from CSV matched to `account_number_last4` in DB

### Yahoo Finance (v3 breaking change)
- v3 is ESM-based, requires instantiation
- Correct usage:
  ```javascript
  const YahooFinance = require('yahoo-finance2').default;
  const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  ```
- CASH ticker always priced at $1.00, never fetched from Yahoo

### Price Refresh
- Nightly cron via node-cron, schedule in `.env` as `PRICE_REFRESH_CRON`
- Default: `0 16 * * 1-5` = 4pm CT weekdays (1 hour after US market close at 3pm CT)
- Prices stored in `price_cache` table, shared across all users
- Manual refresh available via `POST /api/v1/prices/refresh`

---

## Users

- Personal/family app — 2-3 users, each with their own portfolio
- Multi-tenant from day one — all queries scoped by user_id
- Roles: `user` (default) and `admin`
- Family member invite flow — planned for later

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

## Import Plugins — Status

| Plugin | Institution | Format | Status |
|---|---|---|---|
| `lpl_csv` | LPL Financial | CSV | ✅ Complete |
| `lpl_qfx` | LPL Financial | QFX/Quicken | 🔜 Planned |
| `merrill_csv` | Merrill Lynch | CSV | 🔜 Planned |
| `cfcu_csv` | Community First CU | CSV | 🔜 Planned |
| `schwab_csv` | Schwab | CSV | 🔜 Planned |
| `manual` | Any | UI form | 🔜 Planned |

### LPL CSV Notes
- File has UTF-8 BOM — strip bytes 0xEF 0xBB 0xBF before parsing
- Currency values have $, commas, trailing spaces — use parseCurrency() helper
- `----` symbol = bare cash row, skip it
- `9999227` CUSIP = Insured Cash Account, map to CASH ticker
- Security types: `Mutual Fund - Open-end` → mutual_fund, `Mutual Fund - Closed-end` → etf

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
| POST | /api/v1/auth/forgot-password | Password reset email |
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

All route handlers follow this shape — no exceptions:

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

Never use callbacks. Never mix async/await with .then(). Always try/catch around awaits.

---

## Production Deployment (when ready)

1. Add `Dockerfile` and `docker-compose.yml` to ptraker-api
2. Add `Dockerfile` to ptraker-client (or use Nginx to serve static build)
3. Provision new LAN server for production Supabase
4. Run production Supabase slim stack (ports 8200/5435/6545/3003)
5. Configure Earth Nginx to pass ptraker.com → Jupiter
6. Add Swag proxy confs on Jupiter
7. Deploy via Portainer on Jupiter
8. Configure ptraker.com DNS to point to Earth

---

## Known Issues / TODO

- [ ] LPL QFX importer not yet built
- [ ] Merrill Lynch CSV importer not yet built
- [ ] CFCU bank CSV importer not yet built
- [ ] Schwab CSV importer not yet built
- [ ] Manual position entry not yet built
- [ ] Family member invite flow not yet built
- [ ] Frontend (ptraker-client) not yet started
- [ ] Dockerfile + docker-compose for production not yet written
- [ ] Production Supabase server not yet provisioned
- [ ] ptraker.com DNS not yet configured
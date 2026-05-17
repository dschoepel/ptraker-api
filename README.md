# ptraker-api

REST API for **portfolioTraker** — a personal investment portfolio tracker that consolidates holdings across multiple financial institutions into a single dashboard with daily price updates.

## Overview

ptraker-api is an Express/Node.js backend that:

- Authenticates users via Supabase Auth (JWT)
- Accepts CSV/QFX position exports from financial institutions and normalizes them into a common data model
- Fetches daily prices from Yahoo Finance and caches them
- Exposes a single dashboard endpoint that returns net worth, account summaries, and all positions with current values and gain/loss calculations

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ |
| Framework | Express 4 |
| Database | PostgreSQL via Supabase (self-hosted) |
| Auth | Supabase Auth (JWT) |
| Price data | yahoo-finance2 |
| Scheduler | node-cron |
| File parsing | papaparse (CSV), ofx-js (QFX) |
| Logging | Winston |

## Prerequisites

- Node.js 20 or higher
- A running Supabase instance (self-hosted or cloud)
- The ptraker database schema applied (see `Database Setup` below)

## Installation

```bash
git clone https://github.com/dschoepel/ptraker-api
cd ptraker-api
npm install
```

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```env
# Server
PORT=5000
NODE_ENV=development
TZ=America/Chicago

# Supabase
SUPABASE_URL=http://your-supabase-host:8000
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key

# Client (for CORS)
CLIENT_URL=http://localhost:5173

# Price refresh schedule (cron syntax, runs in TZ timezone)
# Default: 4pm CT weekdays — one hour after US markets close
PRICE_REFRESH_CRON=0 16 * * 1-5
```

## Database Setup

Run the schema SQL against your Supabase instance via the Studio SQL editor (`/sql`):

```
docs/schema.sql
```

This creates the following tables and views:

**Tables:** `profiles`, `accounts`, `positions`, `price_cache`, `import_history`

**Views:** `portfolio_summary`, `account_summary`, `net_worth_summary`

Row Level Security (RLS) is enabled on all tables — users can only access their own data.

## Running

```bash
# Development (auto-restarts on file changes)
npm run dev

# Production
npm start
```

Server starts on `http://localhost:5000`. Confirm with:

```
GET http://localhost:5000/health
```

## API Endpoints

All endpoints except `/health` require `Authorization: Bearer <token>` header.

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/auth/login` | Login with email/password |
| POST | `/api/v1/auth/logout` | Logout |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| GET | `/api/v1/auth/profile` | Get current user profile |
| PATCH | `/api/v1/auth/profile` | Update display name / avatar |
| POST | `/api/v1/auth/forgot-password` | Send password reset email |

### Accounts
| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/accounts` | List all accounts |
| GET | `/api/v1/accounts/:id` | Get one account |
| POST | `/api/v1/accounts` | Create account |
| PATCH | `/api/v1/accounts/:id` | Update account |
| DELETE | `/api/v1/accounts/:id` | Delete account |

### Positions
| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/positions` | All positions with current prices |
| GET | `/api/v1/positions?accountId=uuid` | Filter by account |
| GET | `/api/v1/positions/:id` | Get one position |
| DELETE | `/api/v1/positions/:id` | Remove a position |

### Import
| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/import/importers` | List available import plugins |
| POST | `/api/v1/import/upload` | Upload CSV/QFX file (multipart) |
| GET | `/api/v1/import/history` | Import history |

### Prices
| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/prices` | All cached prices |
| POST | `/api/v1/prices/refresh` | Manually trigger price refresh |
| POST | `/api/v1/prices/refresh/tickers` | Refresh specific tickers |

### Dashboard
| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/dashboard` | Full dashboard data in one call |

## Import Plugins

Position data is imported via pluggable parsers in `src/importers/`. Each plugin handles one institution's export format.

| Plugin ID | Institution | Format |
|---|---|---|
| `lpl_csv` | LPL Financial | CSV |

To import a file, POST to `/api/v1/import/upload` with:
- `file` — the CSV or QFX file (multipart)
- `importerId` — the plugin ID (e.g. `lpl_csv`)
- `accountId` — optional, forces all positions into a specific account

If `accountId` is omitted, the importer matches positions to accounts by the last 4 digits of the account number in the export file.

### Adding a New Institution

Create `src/importers/institution-name.csv.js` exporting:

```javascript
module.exports = {
  id: 'institution_csv',
  name: 'Institution Name CSV',
  accepts: ['csv'],
  institution: 'institution',
  description: 'Parses CSV export from Institution Name',
  parse(fileBuffer) {
    // returns { positions, skipped, errors }
  }
};
```

Then register it in `src/importers/index.js`.

## Price Refresh

Prices are fetched from Yahoo Finance and cached in the `price_cache` table. The nightly cron runs automatically on the `PRICE_REFRESH_CRON` schedule. You can also trigger a manual refresh:

```
POST /api/v1/prices/refresh
```

Cash positions (`ticker = 'CASH'`) are always priced at $1.00 and never fetched from Yahoo Finance.

## Project Structure

```
src/
  config/         # (reserved for future config modules)
  controllers/    # Route handlers
  importers/      # Institution-specific CSV/QFX parsers
  lib/
    supabase.js   # Supabase client singletons (anon + admin)
  middleware/
    auth.js       # JWT validation
    errorHandler.js
  models/         # (reserved — schema lives in Supabase)
  routes/         # Express route definitions
  services/
    priceRefresh.js  # Yahoo Finance price fetching
    scheduler.js     # node-cron job
  utils/
    logger.js     # Winston logger
  server.js       # Entry point
```

## Supported Institutions

| Institution | Export Format | Status |
|---|---|---|
| LPL Financial | CSV | ✅ Supported |
| LPL Financial | QFX/Quicken | 🔜 Planned |
| Merrill Lynch | CSV | 🔜 Planned |
| CFCU / Bank | CSV | 🔜 Planned |
| Schwab | CSV | 🔜 Planned |
| Manual entry | — | 🔜 Planned |
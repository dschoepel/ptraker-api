# ptraker-api

Express/Node.js backend for **portfolioTraker** — a personal investment portfolio tracker.

## Overview

Tracks $2M+ across 8 accounts (LPL brokerage/retirement, CFCU bank, NJSD 403b/457).
Multi-user with role-based access (admin/user/viewer), portfolio sharing, and admin notifications.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 23 (dev) / 22 LTS (prod) |
| Framework | Express 4 |
| Database | PostgreSQL via self-hosted Supabase |
| Auth | Supabase Auth (JWT) |
| Price data | yahoo-finance2 v3 |
| Scheduler | node-cron |
| Email | nodemailer |
| Logging | Winston |

## Prerequisites

- Node.js 20+
- Self-hosted Supabase instance (see [supabase/supabase](https://github.com/supabase/supabase))

## Installation

```bash
git clone https://github.com/dschoepel/ptraker-api
cd ptraker-api
npm install
```

## Configuration

```env
# Supabase
SUPABASE_URL=http://your-supabase-host:8100
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Auth
JWT_SECRET=your-jwt-secret
CLIENT_URL=http://localhost:5173
API_EXTERNAL_URL=http://your-supabase-host:8100

# SMTP (nodemailer)
SMTP_HOST=your-smtp-host
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_SENDER_NAME=portfolioTraker
SMTP_FROM_EMAIL=noreply@yourdomain.com
```

## Running

```bash
npm run dev     # nodemon, port 5000
npm start       # production
```

## Features

- JWT authentication via Supabase Auth
- Role-based access control (admin/user/viewer)
- Portfolio sharing between users
- CSV import pipeline (LPL Financial, Community First CU)
- Manual position entry with Yahoo Finance price lookup
- Scheduled daily price refresh via node-cron
- User invite flow via generateLink + nodemailer
- Password reset with OTP code via generateLink + nodemailer
- Admin notifications via Ntfy and email
- Data export endpoint

## Import Plugins

| Plugin | Institution | Format | Status |
|---|---|---|---|
| `lpl_csv` | LPL Financial | CSV | ✅ |
| `cfcu_csv` | Community First CU | CSV | ✅ |
| `manual` | Any | Manual | ✅ |
| `lpl_qfx` | LPL Financial | QFX | 🔜 |
| `merrill_csv` | Merrill Lynch | CSV | 🔜 |
| `schwab_csv` | Schwab | CSV | 🔜 |

## Key Notes

### GoTrue v2.186 Email Bug
GoTrue silently skips all outgoing emails. Both invite and password reset emails
are sent via nodemailer using `generateLink` to get the action URL and OTP code.

### Route Registration Order
Specific routes must come before parameterized routes:
- `/shares/discoverable-users` before `/shares/:ownerId/dashboard`
- `/watchlist/search` before `/watchlist/:ticker`

## Production

Deployed via Docker on Jupiter VPS using Portainer.
See `Dockerfile` (planned) for container configuration.

## Related

- [ptraker-client](https://github.com/dschoepel/ptraker-client) — React frontend

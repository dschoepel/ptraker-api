# ptraker-api

Express/Node.js backend for **portfolioTraker** — personal investment portfolio tracker.

## Tech Stack
| Layer | Technology |
|---|---|
| Runtime | Node.js 23 |
| Framework | Express 4 |
| Database | PostgreSQL via self-hosted Supabase |
| Auth | Supabase Auth (JWT) |
| Price data | yahoo-finance2 v3 |
| Scheduler | node-cron |
| Email | nodemailer |
| Logging | Winston |

## Quick Start
```bash
git clone https://github.com/dschoepel/ptraker-api
cd ptraker-api
npm install
cp .env.example .env   # fill in values
npm run dev            # port 5000
```

## Features
- JWT auth via Supabase, role-based access (admin/user/viewer)
- Portfolio sharing between users
- Generic OFX/QFX importer — investment positions + bank balances, any institution
- LPL Financial CSV multi-account importer
- CFCU transaction CSV importer
- Manual position entry (cash balance or fund/stock by market value)
- Scheduled daily price refresh (Yahoo Finance, weekdays 4pm CT)
- User invite and password reset via generateLink + nodemailer
- Admin notifications via Ntfy push and email
- Data export endpoint

## Import Formats
| Importer | Institution | Format | Notes |
|---|---|---|---|
| `lpl_csv` | LPL Financial | CSV | All accounts in one file |
| `ofx_qfx` | Any | OFX/QFX | Investment positions + bank balances |
| `cfcu_csv` | Community First CU | CSV | Legacy — use OFX instead |
| `manual` | Any | UI form | Cash balance or market value entry |

## Related
- [ptraker-client](https://github.com/dschoepel/ptraker-client) — React frontend
- [ARCHITECTURE.md](./ARCHITECTURE.md) — full system design and developer guide

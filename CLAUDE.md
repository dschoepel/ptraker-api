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
- Multi-user with role-based access (admin/user/viewer)
- Portfolio sharing between users
- Admin notifications via Ntfy and email

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
| Email | nodemailer |
| Logging | Winston |

### yahoo-finance2 v3
```javascript
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
// autoc is decomissioned — use search module
const result = await yahooFinance.search(q);
```

---

## Infrastructure

### Development
- **API:** Windows (E:\ptraker\ptraker-api), `npm run dev`, port 5000
- **Supabase dev:** Mercury (10.0.10.60)
  - Stack: `supabase-ptraker`, containers: `ptraker-supabase-*`
  - Kong: 8100, Postgres: 5434, Studio: http://10.0.10.60:3002
  - Templates: `/data/supabase-ptraker/volumes/templates/` (invite.html, recovery.html)
    These are NOT used — GoTrue v2.186 silently skips emails. We send via nodemailer instead.

### Production (planned)
- **Jupiter VPS** — ptraker-api (Docker/Portainer) + ptraker-client (Swag static)
- **New LAN server** — production Supabase slim stack
- **Domain:** ptraker.com

---

## Database Schema

### Tables
- `profiles` — display_name, role (user/admin/viewer), avatar_url,
  notification_settings JSONB, discoverable BOOLEAN
- `accounts` — institution, type, account_number_last4, is_active
- `positions` — ticker, shares, cost_basis, asset_type, as_of_date
- `price_cache` — shared, ticker PK
- `import_history` — account_id, status, rows, file_format
- `watchlist` — ticker, asset_name, asset_type, notes, added_from
- `user_invites` — invited_by, email, role, status
- `portfolio_shares` — owner_user_id, viewer_user_id, label
- `role_requests` — user_id, requested_role, message, status, reviewed_by

### Views
- `portfolio_summary` — positions + prices + calculations
- `account_summary` — per account rollup + last_imported_at
- `net_worth_summary` — grand totals per user

### RLS Notes
- All tables: `(select auth.uid())` pattern
- `positions` + `accounts`: viewers can read shared data via `portfolio_shares`
- `profiles.role` CHECK: `('user', 'admin', 'viewer')`
- `profiles.discoverable` — controls visibility in sharing dropdown

---

## GoTrue v2.186 Known Issues

**Silently skips ALL outgoing emails** (invite, recovery).
Workaround for both: use `supabase.auth.admin.generateLink()` + nodemailer.

### Password Reset Flow
```javascript
const { data } = await supabase.auth.admin.generateLink({ type: 'recovery', email });
const resetLink = data.properties.action_link.replace(/^https:\/\/10\.0\.10\.60\//, 'http://10.0.10.60:8100/');
const otp = data.properties.email_otp; // 6-digit code shown in email
// Send via nodemailer with both button link and OTP code displayed
```

### Invite Flow
```javascript
const { data } = await supabase.auth.admin.generateLink({
  type: 'invite', email,
  options: { redirectTo: CLIENT_URL/dashboard, data: { intended_role: role } }
});
const inviteLink = data.properties.action_link.replace(/^https:\/\/10\.0\.10\.60\//, 'http://10.0.10.60:8100/');
// Send via nodemailer
```

### Profile trigger — reads intended_role from metadata:
```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'intended_role', 'user')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Notifications Service (`src/services/notifications.js`)

```javascript
// Ntfy headers must be ASCII — sanitize:
const sanitize = (str) => str ? str.replace(/[^\x00-\x7F]/g, '') : str;

// Send to all admins with notifications enabled:
notifyAdmins(supabase, { title, message, subject, html, priority, tags })
```

Email uses nodemailer with env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`SMTP_SENDER_NAME`, `SMTP_FROM_EMAIL`.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | /health | Health check |
| POST | /api/v1/auth/login | Login |
| POST | /api/v1/auth/logout | Logout |
| POST | /api/v1/auth/refresh | Refresh token |
| GET | /api/v1/auth/profile | Get profile |
| PATCH | /api/v1/auth/profile | Update profile (displayName, avatarUrl, discoverable) |
| POST | /api/v1/auth/forgot-password | Send reset email via nodemailer |
| POST | /api/v1/auth/reset-password | Set new password |
| GET | /api/v1/accounts | List accounts |
| POST | /api/v1/accounts | Create account |
| PATCH | /api/v1/accounts/:id | Update account |
| DELETE | /api/v1/accounts/:id | Delete account |
| GET | /api/v1/positions | All positions |
| DELETE | /api/v1/positions/:id | Delete position |
| GET | /api/v1/import/importers | List plugins |
| POST | /api/v1/import/upload | Upload file |
| POST | /api/v1/import/manual | Manual entry |
| GET | /api/v1/import/history | Import history |
| POST | /api/v1/prices/refresh | Refresh prices |
| GET | /api/v1/dashboard | Dashboard data |
| GET | /api/v1/watchlist | Watchlist |
| GET | /api/v1/watchlist/search?q= | Symbol search |
| GET | /api/v1/watchlist/:ticker/history | Sparkline data |
| POST | /api/v1/watchlist | Add ticker |
| PATCH | /api/v1/watchlist/:ticker | Update notes |
| DELETE | /api/v1/watchlist/:ticker | Remove ticker |
| GET | /api/v1/admin/users | List users |
| POST | /api/v1/admin/invite | Invite user |
| PATCH | /api/v1/admin/users/:id | Change role |
| DELETE | /api/v1/admin/users/:id | Delete user |
| GET | /api/v1/admin/role-requests | Pending requests |
| PATCH | /api/v1/admin/role-requests/:id | Approve/deny |
| GET | /api/v1/admin/notification-settings | Get settings |
| PATCH | /api/v1/admin/notification-settings | Save settings |
| POST | /api/v1/admin/notification-settings/test | Test notification |
| GET | /api/v1/shares | Portfolio shares |
| GET | /api/v1/shares/discoverable-users | Users with discoverable=true |
| POST | /api/v1/shares | Create share (viewerId or viewerEmail) |
| DELETE | /api/v1/shares/:id | Remove share |
| GET | /api/v1/shares/:ownerId/dashboard | Shared dashboard data |
| POST | /api/v1/user/request-upgrade | Request role upgrade |
| GET | /api/v1/user/upgrade-request | Check upgrade status |
| GET | /api/v1/user/export | Export all user data as JSON |
| DELETE | /api/v1/user/account | Delete own account |

### Route order — shares
```javascript
router.get('/discoverable-users', ...); // BEFORE /:ownerId
router.get('/:ownerId/dashboard', ...);
```

### Route order — watchlist
```javascript
router.get('/search', ...);            // BEFORE /:ticker
router.get('/:ticker/history', ...);
router.get('/:ticker', ...);
```

---

## Import Plugins

| Plugin | Institution | Status |
|---|---|---|
| `lpl_csv` | LPL Financial | ✅ |
| `cfcu_csv` | Community First CU | ✅ |
| `manual` | Any | ✅ |
| `lpl_qfx` | LPL Financial | 🔜 |
| `merrill_csv` | Merrill Lynch | 🔜 |
| `schwab_csv` | Schwab | 🔜 |

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
| NJSD 403(b) Plan | associated | retirement | 9001 — VTTHX |
| NJSD Deferred Compensation 457 | associated | retirement | 9000 — VTTHX |

NJSD plans: import via Manual Entry → Fund/Stock, quarterly from dashboard screenshot.
Cost basis from "Total net investments" on the plan website chart.

---

## User Role Management

### Last Admin Protection (applies to both delete and demote):
```javascript
const { count } = await supabase
  .from('profiles')
  .select('*', { count: 'exact', head: true })
  .eq('role', 'admin')
  .neq('id', userId);
if (count === 0) return 400 error;
```

### Portfolio Sharing — createShare accepts:
- `viewerId` — existing user ID (from discoverable list)
- `viewerEmail` — new user email (auto-invites as viewer + creates share)

---

## TODO

- [ ] LPL QFX importer
- [ ] Merrill Lynch CSV importer
- [ ] Schwab CSV importer
- [ ] Dockerfile for production
- [ ] Production Supabase server
- [ ] ptraker.com DNS

# Release Notes — v1.1.4

**Date:** 2026-05-21
**Type:** Patch — version endpoint for client footer

## Summary

Adds `GET /api/v1/version` (public, no auth) returning `{ version }` so the
client footer can display the live API version alongside the client version.
Also includes `version` in the existing `/health` response.

## Deployment

```bash
git tag v1.1.4
git push origin main --tags
```

---

# Release Notes — v1.1.3

**Date:** 2026-05-21
**Type:** Patch — manual entry "Account not found" fix

## Summary

Fixes "Account not found" error on manual entry (and single-account CSV upload).
The account lookup was using `getAnonClient()` which has no user JWT attached,
so Supabase RLS blocked the query and returned null. Both lookups now use the
admin client with an explicit `user_id` filter for authorization.

## Deployment

```bash
git tag v1.1.3
git push origin main --tags
```

---

# Release Notes — v1.1.2

**Date:** 2026-05-21
**Type:** Patch — CFCU CSV multi-account rewrite

## Summary

Rewrites the CFCU CSV importer as a multi-account importer (`multiAccount: true`).
It now auto-matches checking and savings accounts by last 4 digits — no account
selection step required. Fixes "accountId is required for CSV imports" error when
uploading a CFCU transaction history CSV.

## Deployment

```bash
git tag v1.1.2
git push origin main --tags
```

---

# Release Notes — v1.1.1

**Date:** 2026-05-21
**Type:** Patch — CFCU CSV import crash fix

## Summary

Fixes a crash when uploading a CFCU transaction history CSV. The importer's `parse()`
returns `{positions, skipped, errors}` but the controller expected a plain array.
Also filters positions to the selected account by last4 digits so uploading a
multi-account CFCU file doesn't dump all balances into one account.

## Deployment

```bash
git tag v1.1.1
git push origin main --tags
```

---

# Release Notes — v1.1.0

**Date:** 2026-05-21
**Type:** Minor — manual entry importer exposed to UI

## Summary

Manual entry importer is now included in `GET /import/importers` response (previously filtered out).
The UI can now display it alongside file-based importers and use the `isManual` flag to render
the manual entry form instead of the file upload step.

Also renames `cfcu.csv.js` → `cfcu_csv.js` to match underscore naming convention used by all
other importers, fixing a potential Linux case-sensitive filesystem issue.

## Deployment

```bash
git tag v1.1.0
git push origin main --tags
```

---

# Release Notes — v1.0.0

**Date:** 2026-05-21
**Type:** Initial production release

## Summary

First production release of the portfolioTraker API. Tracks investment portfolios
across LPL Financial, CFCU, and Associated Bank accounts with Yahoo Finance price
data, import pipeline, watchlist, admin tools, and portfolio sharing.

## Deployment

Deploy via GitHub Actions tag push:
```bash
git tag v1.0.0
git push origin main --tags
```

Then follow the first-deploy bootstrap in `deploy/.env.example` and the
deploy skill (`/deploy`).

## Environment Variables Required

See `deploy/.env.example` for the full list. Key production values:
- `SUPABASE_URL=http://ptraker-supabase-kong:8000`
- `SUPABASE_ANON_KEY` — from Supabase production secrets
- `SUPABASE_SERVICE_KEY` — from Supabase production secrets
- `CLIENT_URL=https://ptraker.com`
- `SMTP_PASS` — SMTP relay password

# Release Notes — v1.6.1

**Date:** 2026-05-27
**Type:** Patch — avatar URL hostname fix

## Summary

Fixes profile photo upload storing the internal Docker hostname
(`ptraker-supabase-kong:8000`) as the public avatar URL, causing
`ERR_NAME_NOT_RESOLVED` in the browser. The URL is now constructed from a
`SUPABASE_PUBLIC_URL` env var so it always points to the externally-reachable
address.

**Required:** add `SUPABASE_PUBLIC_URL=https://supabase.ptraker.com` to the
production `.env` on Jupiter before restarting the API container.

## Deployment

```bash
git tag v1.6.1
git push origin main --tags
```

---

# Release Notes — v1.6.0

**Date:** 2026-05-27
**Type:** Minor — custom profile photo upload

## Summary

Adds profile photo support. Users can upload a JPEG, PNG, WebP, or GIF (max 2 MB)
from the Profile page. The image is stored in a Supabase Storage bucket
(`profile-avatars`) and the public URL is saved to `profiles.avatar_url`. The app
header avatar shows the photo immediately after upload and on every subsequent login.

## DB migration required

Run `docs/schema_avatars.sql` in Studio before deploying:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('profile-avatars', 'profile-avatars', true, 2097152,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO NOTHING;
```

## Deployment

```bash
git tag v1.6.0
git push origin main --tags
```

---

# Release Notes — v1.5.0

**Date:** 2026-05-24
**Type:** Minor — import history retention setting

## Summary

Adds a per-user import history retention limit. Users can choose to keep the
last 10, 25, 50, or 100 imports (or unlimited). The purge logic always preserves
the most-recent import per account so the dashboard's "Last Import" date is never
affected. Auto-purge runs after every import when a limit is set; a manual
"Save & Apply" button on the Profile page triggers an immediate purge.

The `GET /import/history` response now includes `account.institution` so the
client can display the correct financial institution label (e.g. "LPL Financial",
"Community First CU") rather than the import method code.

## DB migration required

Run `docs/schema_history_retention.sql` in Studio before deploying:

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS import_history_limit INTEGER DEFAULT NULL;
```

## Deployment

```bash
git tag v1.5.0
git push origin main --tags
```

---

# Release Notes — v1.3.1

**Date:** 2026-05-22
**Type:** Patch — CFCU CSV file type validation fix

## Summary

Fixes a false rejection when uploading a CFCU CSV file. The `cfcu_csv` importer
declared its accepted file type without the leading dot (`'csv'` instead of
`'.csv'`), so `path.extname()` (which returns `'.csv'`) never matched, and every
valid upload was rejected with "This importer only accepts csv files. You uploaded
'.csv'". All other importers (`lpl_csv`, `ofx_qfx`) already used the dot-prefixed
form. The controller's validation also now normalizes accepted extensions to
dot-prefixed form as a belt-and-suspenders safeguard.

## Deployment

```bash
git tag v1.3.1
git push origin main --tags
```

---

# Release Notes — v1.3.0

**Date:** 2026-05-22
**Type:** Minor — pluggable importer registry

## Summary

Moves importer metadata from hard-coded JavaScript into the database, making the
import pipeline extensible without code changes for configuration.

Admin users can now manage importer names, descriptions, and usage instructions
via a new Importers section on the Admin page. New importers are registered there
after their code module is deployed — no more digging into source files to update
display text.

Users can select which importers appear on their Import page via a new Import
Sources section in Profile settings. Default importers (OFX/QFX and Manual Entry)
are always present. Optional importers (LPL Financial CSV, CFCU CSV, and any future
additions) are toggled per-user.

File type validation is now enforced server-side — uploading a `.csv` to the OFX
importer returns a clear 400 error rather than a confusing parse failure.

Import history now records the importer id (`lpl_csv`, `ofx_qfx`, etc.) in the
`file_format` column instead of a generic category, making history more precise.

## Deployment

**DB migration required before deploying the API.** Run `docs/schema_importers.sql`
in Supabase Studio (production) before pushing the tag:

```
ssh -p 22791 -L 3002:localhost:3002 dschoepel@142.202.190.9
```
Then open http://localhost:3002 → SQL Editor → run `docs/schema_importers.sql`.

```bash
git tag v1.3.0
git push origin main --tags
```

---

# Release Notes — v1.2.0

**Date:** 2026-05-21
**Type:** Minor — private/unlisted stock support + demo seed

## Summary

Adds support for private/unlisted stocks in manual entry. When a `price` field
is included in the `POST /import/manual` request body, Yahoo Finance lookup is
skipped entirely — shares and price are used directly, and the price is upserted
into `price_cache` so the dashboard shows the correct value immediately.

Fixes a silent bug where the `price_cache` upsert used the wrong column name
(`updated_at` vs `last_fetched_at`), causing private stock prices to never appear.

Also adds a demo user seed script (`deploy/seeds/demo-user.sql`) with a ~$1M
sample portfolio for screenshots and demos, and a matching rollback script.

## Deployment

```bash
git tag v1.2.0
git push origin main --tags
```

---

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

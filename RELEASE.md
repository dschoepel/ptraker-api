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

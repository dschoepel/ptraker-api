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

---
status: ready
priority: p1
issue_id: "005"
tags: [incident, compatibility, portfolio]
dependencies: []
---

# Preserve existing pages before portfolio migration

## Problem Statement

Home and Trend fail after the portfolio release reached production, because the
production database has not received the ledger migrations. Existing pages must
remain usable while the new features await their database cutover.

## Findings

Authenticated Home and Trend show the global error screen. Vercel logs for both
routes report Prisma P2022: `User.ledgerAdoptedAt` does not exist. Home reads the
new field before choosing the legacy path. Trend replaced its original market
view with database-dependent insights. Other queries also select new columns or
access new tables before checking adoption. CI tested migrated databases only.

## Proposed Solutions

- Immediately restore the previous production deployment to recover the app.
- Add compatibility at the adoption boundary and preserve the original Trend
  content; validate against both the legacy schema and fully migrated schema.
- Applying production migrations during incident response would require a
  verified baseline and backup; it is not the recovery path selected here.

## Recommended Action

Restore release `78c20c7` via Vercel Instant Rollback, then ship a tested forward
repair. Keep migrations and ledger adoption explicit. Never fall back to legacy
amounts for an adopted owner after an unrelated query failure.

## Acceptance Criteria

- [x] Reproduce Home and Trend failures and capture the exact runtime error.
- [x] Verify recovered production Home and Trend with the authenticated browser.
- [x] Legacy-schema reads, login persistence, and legacy asset operations work.
- [x] New feature pages show setup states before accessing unavailable tables.
- [x] Trend retains market movers/charts independently of personal insights.
- [x] Regression tests exercise a real legacy database and adopted portfolios.
- [ ] Verify the forward fix in the browser and record rollout evidence.

## Work Log

### 2026-09-06

Investigated user-reported production failures. Runtime logs at 23:24Z (Home) and
23:25Z (Trend) confirm the same missing column. Selected previous production
deployment `E6P8dwX8FccmfWS3vNi1pNyB6XQ8`, commit `78c20c7`, for rollback from
`J2jZAnPkf8cmWvj9L1xmeb5vqrvW` (`8ef3cdb`). No production database changes.

### 2026-09-07

Verified the production rollback in the authenticated browser: Home holdings and
all five Trend market charts render. Implemented schema-compatible adoption reads,
legacy field selections and callback persistence, new-feature adoption gates, and
an isolated personal-insights section below the restored market view.

Validation: 157 offline tests; 54 dedicated PostgreSQL checks across the legacy,
opening-balance, manual-transaction, and valuation suites; typecheck, lint,
actionlint, production dependency audit, and environment-free production build.
Synthetic browser checks cover Home editing/detail/history, Trend charts, all
new-page setup states, scoped event not-found, and injected personal-insights
failure. See `docs/verification/legacy-recovery/README.md` for evidence.

GitHub incident #20 tracks the repair. Issues #6 and #17 now record the runtime
failure and recovery, with production migration/adoption still pending.

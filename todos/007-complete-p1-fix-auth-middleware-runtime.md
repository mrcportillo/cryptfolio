---
status: complete
priority: p1
issue_id: "007"
tags: [auth, deployment, portfolio]
dependencies: []
---

# Restore fresh login and the public logo

## Problem Statement

Fresh Auth0 login redirects to `/home?authError=1` when the callback attempts
to persist the session owner. Existing sessions masked the failure during page
verification. The navbar logo also fails to load.

## Findings

The callback runs from middleware and uses Prisma, which rejects the default Edge
runtime. Next.js 15.5 supports stable Node middleware. The valid public PNG is
redirected to login when fetched without a session by the image optimizer.

## Proposed Solutions

- Use Node middleware: a small configuration change preserves the existing
  schema-safe session persistence and Auth0 flow.
- Move persistence outside the callback: a larger authentication redesign with
  more failure paths, unnecessary for this runtime mismatch.

## Recommended Action

Use Node middleware and exclude only the public logo asset. Make production builds
verify the emitted runtime and route matchers, then check a fresh login and the
portfolio pages before completing rollout readiness.

## Acceptance Criteria

- [x] Fresh login succeeds against the adopted Neon rehearsal copy.
- [x] Production build verifies Node runtime and protected/public route matching.
- [x] Public logo returns an image without authentication.
- [x] Home, Trend, Transactions, Reports, and Scenarios pass browser checks.
- [x] CI and Vercel preview pass with the fix.

## Work Log

### 2026-09-09 and 2026-09-10

Reproduced `auth.callback.upsert-user` rejecting the Edge runtime. A fresh Google
login succeeded after explicitly selecting Node, and Home and Trend rendered on
the approved adopted Neon copy. Its one-day expiry completed as planned before
the remaining UI checks; use a disposable local database with synthetic portfolio
data to finish those checks. No production schema or ledger writes occurred.

Confirmed `/images/logo.png` returns an unauthenticated 307. GitHub #24 records
the runtime and image failures; PR #23 is draft until verification completes.


### 2026-09-10 - Production build and browser verification

Commit `9c58550` passed Portfolio CI run `34538284142`, including all database
suites, audit, typecheck, lint, and credential-free build. Vercel preview
`DxRdzbKco94gmb2S7k1W6oKGeU4K` reached Ready; its Resources page confirms
`/_middleware` runs on Node.js 22.x with the expected route matcher.

The local production build completed a fresh Google/Auth0 callback to `/home`
without `authError`. The logo loaded as an image, Home showed both synthetic
holdings, and Trend displayed all five market charts. Browser checks exercised
opening-event inspection, rejected an overspend, recorded a synthetic inbound
transaction and its exact reversal, refreshed complete snapshots, displayed a
reconciled weekly report, rejected a pre-adoption report, and saved/ran a scenario.
Database verification confirmed the two original synthetic quantities and four
expected ledger events remained after scenario execution. No real holdings were
changed.

HTTP checks confirmed protected page redirects, API 401 responses, public logo
`200 image/png`, and cron 401 without a bearer followed by two authorized 200
responses with zero duplicates or incomplete snapshots. Production activation
and hosted post-release checks remain in GitHub #17.

---
status: ready
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
- [ ] Home, Trend, Transactions, Reports, and Scenarios pass browser checks.
- [ ] CI and Vercel preview pass with the fix.

## Work Log

### 2026-09-09 and 2026-09-10

Reproduced `auth.callback.upsert-user` rejecting the Edge runtime. A fresh Google
login succeeded after explicitly selecting Node, and Home and Trend rendered on
the approved adopted Neon copy. Its one-day expiry completed as planned before
the remaining UI checks; use a disposable local database with synthetic portfolio
data to finish those checks. No production schema or ledger writes occurred.

Confirmed `/images/logo.png` returns an unauthenticated 307. GitHub #24 records
the runtime and image failures; PR #23 is draft until verification completes.

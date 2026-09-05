---
status: complete
priority: p2
issue_id: "002"
tags: [portfolio, reports, scenarios]
dependencies: ["001"]
---

# Complete portfolio experiences

## Problem Statement

The verified valuation foundation needs user-facing daily/weekly explanations,
personal market impact and allocation ranges, and saved hypothetical shocks.

## Findings

Issues #11–#14 define the remaining scope. #10 now provides exact calculation,
snapshot revisions, ownership boundaries, and repair. PR #15 holds the integrated branch.

## Proposed Solutions

Use the shared calculation engine and immutable snapshot boundaries for reports.
Keep preferences and scenarios in separate owner-scoped tables. Recomputing past
weeks from provider requests would lose stored evidence and is unnecessary.

## Recommended Action

Deliver daily/weekly reports first, then personal impact/allocation and scenarios,
with each slice tested and committed independently.

## Acceptance Criteria

- [x] #11: live worth, flows/fees/market contribution, ranked contributors, clear quality states, mobile/keyboard access, allocation extension.
- [x] #12: current/prior post-adoption weeks, reconciled totals, coin contribution/allocation changes, explicit missing/stale history.
- [x] #13: owned-coin tremors ranked by material USD impact, saved thresholds, valid per-position ranges, hypothetical drift, no trading.
- [x] #14: create/edit/run/archive named coin shocks, valid percentages, exact hypothetical values, incomplete/stale prices, no ledger/snapshot writes.
- [x] Owner-scoping and mathematical edge cases tested; lint/typecheck/build and visual verification pass.
- [x] Issues and PR evidence updated after each completed slice.

## Work Log

### 2026-09-05

Recovered and completed #10. Continue with the existing architecture; all production
database rollout remains governed by the documented runbooks.

### Completion · 2026-09-05

Delivered reports in `a9d194d` and insights/scenarios in `7dcffd2`. All acceptance
criteria have implementation and verification evidence. Final checks: 157 offline
tests; PostgreSQL 14 valuation/insights, 19 transactions, 15 opening/catalog;
TypeScript, ESLint, and env-free production build. Browser testing found and fixed
form input loss after validation; controlled fields now retain edits. Concurrent
price repair cannot mix snapshot revisions in a current-week report.

Updated GitHub issues #6, #7, #10–#14, and #16; PR #15 is ready for code review.
The known Vercel preview failure is tracked separately in #17 and still blocks
hosted rollout verification. Production operations have not been performed.

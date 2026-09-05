---
status: ready
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

- [ ] #11: live worth, flows/fees/market contribution, ranked contributors, clear quality states, mobile/keyboard access, allocation extension.
- [ ] #12: current/prior post-adoption weeks, reconciled totals, coin contribution/allocation changes, explicit missing/stale history.
- [ ] #13: owned-coin tremors ranked by material USD impact, saved thresholds, valid per-position ranges, hypothetical drift, no trading.
- [ ] #14: create/edit/run/archive named coin shocks, valid percentages, exact hypothetical values, incomplete/stale prices, no ledger/snapshot writes.
- [ ] Owner-scoping and mathematical edge cases tested; lint/typecheck/build and visual verification pass.
- [ ] Issues and PR evidence updated after each completed slice.

## Work Log

### 2026-09-05

Recovered and completed #10. Continue with the existing architecture; all production
database rollout remains governed by the documented runbooks.

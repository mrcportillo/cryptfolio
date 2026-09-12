---
status: complete
priority: p1
issue_id: "006"
tags: [deployment, migration, portfolio]
dependencies: ["005"]
---

# Prepare the deployed legacy schema for adoption

## Problem Statement

The deployed database does not match the assumed Prisma baseline. Recording the
baseline as applied would leave real schema differences unresolved and block
safe activation of the portfolio ledger.

## Findings

Three secondary indexes are missing and two legacy foreign keys use restrictive
instead of cascading deletion. Column definitions match, but column order and
slots left by dropped columns differ. Both preflight and final verification
incorrectly treated those physical details as logical schema drift.

## Proposed Solutions

- Normalize only the five known schema differences in one checked transaction.
  This preserves all existing rows and lets the original migration history stand.
- Rebuild tables to match physical order. This adds unnecessary data movement
  and is rejected because order does not affect the application contract.

## Recommended Action

Use the default read-only preparation preview, rehearse on an isolated copy,
apply the preparation, and require strict preflight before resolving baseline
metadata. Keep production activation separate and retain recovery evidence.

## Acceptance Criteria

- [x] Production preparation preview is enforced read-only and reports five actions.
- [x] Preparation rejects an incorrectly defined same-name index.
- [x] Preparation preserves all rows, is atomic, and retries without further changes.
- [x] Logical catalog checks accept harmless column order and dropped slots.
- [x] Synthetic deployed-schema migration and final adoption verification pass.
- [x] Runbook describes locks, future cascade deletion, baseline, and rollback.
- [x] Complete the approved one-day Neon copy migration/adoption rehearsal.
- [x] CI passes for the proposed change.

## Work Log

### 2026-09-08 and 2026-09-09

Audited the production catalog read-only, verified its connection against Neon,
and retained a recovery snapshot. Added a default-dry-run preparation script and
an exact synthetic structural fixture. PostgreSQL integration covers migration,
adoption, final verification, invalid definitions, unchanged rows, and retry.
157 offline tests, typecheck, and lint passed; database suites passed separately.
Production preparation dry run passed. GitHub #22 tracks this fix; #17 retains
the remaining production rollout and feature activation work.

The user explicitly approved copying production data into a one-day Neon branch
for rehearsal. The copy was created with automatic expiry; all rehearsal writes
are pinned to its distinct endpoint. Private data and credentials remain outside
the repository.

The hosted rehearsal additionally exposed inherited function search paths from
connections without an explicit schema. Added an atomic migration pinning all
21 portfolio routines to their installed schema, preserving bodies and data.
The regression test reproduces inherited configuration, confirms strict rejection,
and proves the corrective migration restores verification.

All 211 tests passed with the disposable database enabled. The approved Neon
copy passed preparation, strict preflight, baseline resolution, every migration,
opening adoption, idempotent retry, and final catalog/fingerprint verification.
All original user, position, and archive rows remained unchanged. Initial pricing
and hosted application/scheduler checks remain in #17.

Code commit `365caea` passed Portfolio CI (run `34351926840`), including all
PostgreSQL suites, audit, typecheck, lint, and credential-free build. The Vercel
preview also succeeded. PR #23 contains the repair. The copy's initial snapshot
was complete, and the actual local cron route returned 401 without authorization
and 200 on two authorized invocations without duplicates. Production remains
unchanged; browser verification and activation are tracked in #17.

---
status: complete
priority: p1
issue_id: "001"
tags: [portfolio, valuation, reconciliation, scheduler, postgresql, security]
dependencies: []
---

# Track Daily Valuation and Price-Driven Movement

## Problem Statement

Cryptfolio has a quantity ledger through GitHub issues #7-#9, but it does not yet preserve stable daily portfolio worth or distinguish market-driven changes from manual external flows and fees. Current valuation must stay live while historical daily values remain reproducible, explainable, and repairable.

This todo records the completed GitHub issue #10 slice. The 2026-09-05 request continues through #11-#14 after this slice.

## Findings

- Baseline branch `feature-personal-portfolio-intelligence` is clean at pushed commit `07cdc57` (`feat: add manual portfolio transactions`).
- Existing holdings were converted into opening balances at adoption; historical execution prices must not be invented and pre-adoption history must not be backfilled.
- Fiat cash is outside the portfolio. Missing USD prices and worth are incomplete/NULL, never zero.
- Reporting uses `America/Argentina/Salta` and needs a deterministic daily cutoff after local midnight.
- Post-adoption holdings are exact movement sums; ledger writers already provide serializable retry, a shared owner lock, tuple-version coordination, immutable events, and owner-safe composite foreign keys.
- The current live-worth reducer silently omits missing prices and can report zero for a wholly unpriced positive portfolio; issue #10 must replace that contract with explicit completeness.
- Vercel Cron requires a production GET route, UTC schedule, duplicate/overlap safety, and a dedicated `CRON_SECRET` bearer check. It performs no automatic retry.
- CoinGecko historical daily data is anchored to UTC rather than Salta midnight. Deterministic snapshot/repair selection must use range observations at or before the persisted cutoff and retain timestamps/provenance.
- No `docs/solutions` or critical-pattern corpus exists; ADR 0001, the implementation plan, both runbooks, schema, and ledger code are the authoritative internal evidence.

## Proposed Solutions

### Option 1: Persisted Daily Snapshots with Derived Period Reconciliation

**Approach:** Persist one idempotent daily snapshot per reporting date and fixed cutoff, including per-coin valuation inputs/status. Derive period external flow, fees, and per-coin market movement from ledger events plus boundary valuations, and explicitly stale/recalculate affected snapshots after corrections.

**Pros:** Stable history, auditable inputs, deterministic repair, live current worth can remain separate.

**Cons:** Requires new schema, recalculation rules, scheduler authentication, and careful decimal/time semantics.

**Effort:** Multi-phase issue implementation.

**Risk:** Medium/High because errors can silently misstate financial history.

### Option 2: Recompute All Historical Worth on Every Read

**Approach:** Store only prices/events and derive all daily history dynamically.

**Pros:** Fewer persisted aggregates.

**Cons:** Historical values can drift as upstream data changes, reads become expensive, repair/audit semantics are weak, and it does not meet stable snapshot requirements.

**Effort:** Medium.

**Risk:** High.

### Option 3: Store Total-Only Daily Worth

**Approach:** Persist one portfolio total per day without per-coin inputs/contributions.

**Pros:** Smallest schema and simplest display.

**Cons:** Cannot explain or reconcile per-coin market contributions and makes incomplete-price diagnosis/repair difficult.

**Effort:** Low/Medium.

**Risk:** High due to insufficient auditability.

## Recommended Action

Implement Option 1, refining the exact model and calculation formulas after reading issue #10 and the existing ledger/valuation contracts. Keep current worth live, make historical snapshots deterministic and repairable, and preserve explicit data-quality provenance.

## Technical Details

Expected areas, subject to repository research:

- Database schema/migrations for snapshot headers, per-coin values/contributions, status/provenance, and staleness.
- Exact-decimal valuation and period reconciliation services with an explicit documented tolerance.
- Deterministic reporting-date/cutoff logic in `America/Argentina/Salta`.
- Dedicated scheduler endpoint authentication independent of browser sessions.
- Manual snapshot/recalculation/repair path for scheduler and CoinGecko failures.
- Ledger correction hooks or stale-range derivation for backdated events.
- Portfolio history/status UI consistent with the existing interface and accessibility patterns.
- Offline unit/integration tests plus disposable, explicitly named loopback PostgreSQL verification.
- Operations runbook, deployment verification queries, rollback, and monitoring guidance.

## Resources

- GitHub issue #10: Track daily valuation and price-driven movement.
- Baseline commit: `07cdc57`.
- Issue-specific implementation plan: `docs/plans/2026-08-28-feat-track-daily-valuation-plan.md`.
- ADR 0001, implementation plan, both ledger runbooks, schema/migrations, CoinGecko services, and #9 ledger implementation were read before design.

## Acceptance Criteria

### Product and valuation

- [x] Current portfolio worth changes when coin prices change without a transaction or asset edit.
- [x] Historical daily worth is stable while current valuation remains live.
- [x] Fiat cash remains outside the portfolio.
- [x] Unknown prices/USD values/worth remain NULL/incomplete and are never coerced to zero.

### Daily snapshot semantics

- [x] Exactly one idempotent daily snapshot is produced for a reporting date at a fixed deterministic cutoff after local midnight.
- [x] All reporting-date and cutoff behavior is explicitly tested for `America/Argentina/Salta`.
- [x] Snapshot inputs and price timestamps/provenance are sufficient to reproduce and audit the stored valuation.
- [x] Scheduled execution uses dedicated authentication and has no browser-session dependency.
- [x] Concurrent scheduler/manual attempts cannot create duplicate or partially written snapshots.

### Reconciliation

- [x] Period total change reconciles exactly, within one documented decimal tolerance, into net external flow, fees, and market movement.
- [x] Fee sign/currency treatment and transfer/deposit/withdrawal/trade classifications are explicit and tested.
- [x] Per-coin market contributions reconcile to total market movement within the same documented tolerance.
- [x] Decimal scale, rounding boundaries, aggregation order, and residual handling are explicit and covered by adversarial tests.

### Data quality and correction

- [x] Fresh, stale, estimated, repaired, and incomplete states are explicit and distinguishable in stored data and user-visible status.
- [x] A partial coin-price failure makes affected worth/reconciliation incomplete without converting missing values to zero.
- [x] Backdated events and corrections safely mark the affected date range stale and deterministically recalculate it.
- [x] Recalculation is idempotent and safe across interrupted, retried, and concurrent runs.
- [x] Manual snapshot and repair operations exist for scheduler or CoinGecko failure and are authenticated/authorized appropriately.
- [x] Repair records enough provenance to distinguish repaired values from originally scheduled values.

### Adoption baseline

- [x] Opening conversion remains no-backfill.
- [x] A valued baseline is produced for the adoption date without inventing opening execution prices.
- [x] No pre-adoption snapshot/history is created.

### UI and operations

- [x] The portfolio UI exposes live, stale, and incomplete worth; historical snapshot/reconciliation state is stored and available to the #11/#12 report slices.
- [x] Empty, loading, incomplete, stale, repaired, and failure states are usable and tested.
- [x] Scheduler/manual repair configuration and dedicated secret requirements are documented without hardcoded credentials.
- [x] Runbooks include safe manual commands, recovery, verification SQL, rollback constraints, and monitoring thresholds.

### Quality gates

- [x] Exact offline tests pass without network or real database access.
- [x] Disposable loopback PostgreSQL tests use explicit safe database names and pass without reading `.env.local`.
- [x] No production snapshot/adoption job is executed during development or verification.
- [x] Env-free production build, typecheck, lint, and relevant test suites pass.
- [x] Data-integrity, security, frontend, race-condition, simplicity, and deployment reviews are completed and all material findings are resolved.
- [x] Only explicit issue #10 paths are committed and pushed to `feature-personal-portfolio-intelligence`.
- [x] GitHub issue #10 is updated with acceptance/evidence and remains open for integration.
- [x] The dependency-ordered continuation is recorded for issues #11-#14.

## Work Log

### 2026-08-28 - Session Start and Scope Capture

**By:** Codex

**Actions:**

- Verified the isolated linked worktree, required branch, clean status, upstream tracking, and baseline commit `07cdc57`.
- Captured all explicit acceptance criteria and implicit correctness, concurrency, data-quality, operations, testing, and scope constraints.
- Selected persisted daily snapshots with auditable per-coin inputs and derived reconciliation as the provisional direction pending required repository research.

**Learnings:**

- The issue is intentionally bounded to daily valuation/reconciliation; later analytics issues remain out of scope.
- Correct NULL propagation, deterministic time semantics, exact decimals, and correction invalidation are core data invariants rather than presentation details.

### 2026-08-28 - Research, Flow Analysis, and Design

**By:** Codex with delegated repository, institutional-learning, official-documentation, and specification-flow reviews

**Actions:**

- Read GitHub issue #10, ADR 0001, the milestone plan, both cutover runbooks, all current migrations/schema, CoinGecko services, and the #9 ledger domain/store/service/integration paths.
- Verified current CoinGecko range semantics/deprecation status and Vercel Cron delivery/authentication behavior against official documentation.
- Analyzed live, scheduled, manual, repair, adoption, correction, and reconciliation flows, including concurrency and provider-failure permutations.
- Wrote the implementation plan with a closed-day Salta boundary, distinct adoption baseline, immutable revisions, orthogonal status/provenance/quality, ledger revision coordination, and exact contribution adjustment rules.

**Learnings:**

- A mid-day adoption baseline and the adoption day's closing snapshot require different logical snapshot kinds.
- Pure interval `quantity × price change` does not equal the required three-bucket residual when actual event value differs from a market reference; persisting an explicit event-valuation adjustment makes both statements auditable and reconcilable.
- Staleness must be triggered transactionally from movement insertion and snapshot activation must recheck ledger state; a post-commit cache refresh alone cannot close the race.

## Notes

- Never read `.env.local` or access a real database.
- Never run production snapshot/adoption jobs.
- Preserve unrelated work and use `apply_patch` for source edits.
- Continue with #16 maintenance and then #11-#14 under the 2026-09-05 user request.

### 2026-09-05 - Recovery and completion

**By:** Codex

- Recovered the prior session's uncommitted implementation in the existing feature worktree; preserved the separate original checkout.
- Fixed incomplete snapshot retries, adoption-baseline retry provenance, gaps before the newest day, chronological repair, stable completed snapshots after unrelated transactions, bounded live fallback, and retry on concurrent ledger or prior-snapshot changes.
- Added database invalidation of later attribution when earlier prices are repaired or missing dates are inserted.
- Extended strict opening-ledger catalog verification and corrected two old fixtures whose default current timestamps exceeded their fixed adoption date.
- Sequentially reviewed ownership/authentication, immutable evidence, decimal reconciliation, capture races, scheduler/CLI failure paths, UI states, and operational recovery.
- Validation: 148 offline tests passed; PostgreSQL valuation 12/12, transactions 19/19, opening/catalog 15/15; TypeScript and ESLint passed. Env-free production build passed; synthetic React screens verified in headless Chrome at 1280px/375px.
- The production dependency audit found 16 existing advisories; #16 tracks their separate patch before PR readiness.
- No production adoption, snapshot, migration, or job was run.

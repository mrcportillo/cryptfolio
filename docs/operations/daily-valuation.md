# Daily valuation operations

This runbook deploys and operates issue #10's live portfolio valuation, stable
daily snapshots, adoption baseline, and exact market-movement reconciliation.
The daily pulse, weekly report, tremors, allocation ranges, and stress scenarios
build on this foundation. Continue with `portfolio-experiences.md` for their
additional migration and verification steps.

## Contract

- Current worth is calculated from current CoinGecko prices on each home read.
  A missing price makes total worth incomplete and remains `NULL`; the known
  subtotal is never presented as a complete zero-valued portfolio.
- Reporting uses `America/Argentina/Salta`. Reporting date `D` is the closed
  local day from `D 00:00` through the exclusive cutoff at local midnight
  starting `D + 1` (`03:00:00Z`). The cron is scheduled at `03:10Z`; delivery
  time never changes the logical cutoff.
- The adoption baseline is a separate snapshot at the exact `ledgerAdoptedAt`
  instant. It values the opening quantities but creates no pre-adoption days
  and does not write or infer execution prices.
- Revisions and their position/contribution evidence are immutable. A repair
  appends and activates the next revision with a required reason.
- Complete daily revisions satisfy:

  ```text
  ending worth = starting worth + net external flow + market movement - fees
  market movement = pure price movement + event valuation adjustment
  ```

  All values use `DECIMAL(65,30)`, one half-away-from-zero rounding boundary per
  quantity-price multiplication, deterministic summation, and a shared
  `0.00000001` USD reconciliation tolerance. Reversal fees and flows retain
  their signed values.

- Each held position stores the provider observation timestamp and one of
  `OBSERVED`, `STALE_FALLBACK`, `HISTORICAL_ESTIMATE`, or `MISSING`. Repair is
  also explicit at revision level. Missing data is never changed to zero.

## Configuration

Configure these server-only production variables. Never expose them through a
`NEXT_PUBLIC_*` variable.

```text
CRON_SECRET=<random value of at least 16 characters>
COIN_API_KEY=<CoinGecko Demo or Pro key>
COIN_API_PLAN=demo
```

Use `COIN_API_PLAN=pro` only with a Pro key. The scheduled provider sends the
key in the corresponding CoinGecko header, never in the URL. Absence of either
the dedicated cron secret or provider credential fails closed. The cron route
accepts only the exact `Authorization: Bearer <CRON_SECRET>` value and never
depends on an Auth0 browser session.

`vercel.json` registers one production GET invocation:

```text
10 3 * * *  /api/cron/portfolio-snapshots
```

Vercel cron does not retry failures, can deliver duplicates or overlaps, and
does not follow redirects. The database unique key, per-owner advisory lock,
captured ledger revision, and immutable active-revision sequence make those
deliveries safe. A deployment updates the schedule; rolling back application
code alone does not restore an older cron configuration.

## Disposable PostgreSQL proof

Create an empty loopback database whose name contains both `cryptfolio` and
`test`, then provide it explicitly:

```bash
CRYPTFOLIO_VALUATION_TEST_DATABASE_URL='postgresql://localhost/cryptfolio_valuation_test' \
  pnpm test:valuation-postgres
```

The harness never reads `.env.local`. It refuses remote/non-PostgreSQL targets
and unsafe database names, forces UTC database sessions, creates one uniquely
named test schema, deploys every migration, verifies an empty Prisma diff, and
removes only that schema. It exercises concurrent publication, fixed Salta
cutoffs, immutable evidence, owner-safe links, NULL prices, signed repairs,
ledger races, and correction invalidation.

## Pre-deploy

Confirm the #7-#9 ledger runbooks are complete and record these read-only
results:

```sql
SHOW TimeZone; -- production database sessions must be UTC

SELECT
  count(*) FILTER (WHERE "ledgerAdoptedAt" IS NULL) AS legacy_users,
  count(*) FILTER (WHERE "ledgerAdoptedAt" IS NOT NULL) AS adopted_users,
  coalesce(sum("ledgerRevision"), 0) AS preexisting_revision_sum
FROM "User";

SELECT count(*) AS movement_count FROM "AssetMovement";

SELECT to_regclass('"PortfolioSnapshot"') AS preexisting_snapshot_table;
```

Before this first migration, `ledgerRevision` and the snapshot tables should
not exist; adapt the first query to omit `ledgerRevision` if necessary. Do not
run any snapshot or adoption apply command during deployment preparation.

## Deploy

1. Take a recoverable database snapshot and retain the pre-deploy counts.
2. Apply and inspect the additive migration:

   ```bash
   pnpm prisma migrate deploy
   pnpm prisma generate
   pnpm prisma migrate status
   ```

3. Deploy the application with `CRON_SECRET`, `COIN_API_KEY`, and the selected
   plan configured. Confirm `/api/cron/portfolio-snapshots` returns `401`
   without the bearer secret and does not redirect to Auth0. Do not paste the
   secret into logs or tickets.
4. Preview the personal owner's baseline and latest closed day. Dry run is the
   default and performs no database writes:

   ```bash
   pnpm valuation:snapshot -- \
     --user-id 'auth0|owner' \
     --adoption-baseline

   pnpm valuation:snapshot -- \
     --user-id 'auth0|owner' \
     --reporting-date '2026-09-01'
   ```

5. Compare cutoff, ledger revision, position coverage, total/known values, and
   status. Apply only after that review:

   ```bash
   pnpm valuation:snapshot -- \
     --user-id 'auth0|owner' \
     --adoption-baseline \
     --apply

   pnpm valuation:snapshot -- \
     --user-id 'auth0|owner' \
     --reporting-date '2026-09-01' \
     --apply
   ```

The first scheduled run creates only the adoption baseline and latest closed
day; it does not backfill the interval since ledger adoption. Once a daily row
exists, later runs fill missed closed days after it in chronological order.

## Failure and repair

Provider failures publish explicit incomplete evidence when a price cannot be
resolved. A missing server credential fails the whole invocation before any
snapshot write. Correcting or reversing a backdated event increments the
owner's ledger revision, marks every affected active snapshot `STALE`, and
coalesces the earliest timestamp in `SnapshotRecalculationRequest`. The next
cron repairs stale rows chronologically.

For an operator repair, use the existing logical target. Repair requires apply
mode and a concise audit reason; it cannot be previewed accidentally as an
apply-less repair:

```bash
pnpm valuation:snapshot -- \
  --user-id 'auth0|owner' \
  --reporting-date '2026-09-01' \
  --repair \
  --reason 'Recalculate after CoinGecko outage' \
  --apply
```

The same command accepts `--adoption-baseline` when corrected opening-time
evidence made the baseline stale. Never edit or delete an older revision.

## Verification

The first query must return no rows. The aggregate queries must report zero
differences outside the shared tolerance.

```sql
-- Active pointers without matching owner-scoped revisions.
SELECT header."id"
FROM "PortfolioSnapshot" header
LEFT JOIN "PortfolioSnapshotRevision" revision
  ON revision."snapshotId" = header."id"
 AND revision."userId" = header."userId"
 AND revision."revision" = header."activeRevisionNumber"
WHERE header."activeRevisionNumber" IS NOT NULL
  AND revision."id" IS NULL;

-- Ledger tuple version seeded and maintained once per movement.
SELECT owner."id", owner."ledgerRevision", count(movement."id") AS movements
FROM "User" owner
LEFT JOIN "AssetMovement" movement ON movement."userId" = owner."id"
GROUP BY owner."id", owner."ledgerRevision"
HAVING owner."ledgerRevision" <> count(movement."id");

-- One logical target and monotonically activated revisions.
SELECT "userId", "kind", "reportingDate", count(*)
FROM "PortfolioSnapshot"
GROUP BY "userId", "kind", "reportingDate"
HAVING count(*) <> 1;

-- Complete per-coin market movement equals the active revision total.
SELECT
  revision."id",
  revision."marketMovementUsd" - coalesce(sum(coin."marketMovementUsd"), 0)
    AS difference
FROM "PortfolioSnapshotRevision" revision
JOIN "PortfolioSnapshot" header
  ON header."id" = revision."snapshotId"
 AND header."userId" = revision."userId"
 AND header."activeRevisionNumber" = revision."revision"
LEFT JOIN "CoinSnapshotContribution" coin
  ON coin."snapshotRevisionId" = revision."id"
WHERE revision."reconciliationStatus" = 'COMPLETE'
GROUP BY revision."id"
HAVING abs(
  revision."marketMovementUsd" - coalesce(sum(coin."marketMovementUsd"), 0)
) > 0.00000001;
```

## Monitoring and rollback

The scheduler interleaves missing dates and stale/incomplete revisions in
chronological order. Each invocation processes at most seven daily targets per
owner (the six oldest pending dates and the latest pending date), plus the
adoption baseline, and stops starting work after four minutes. The route allows
five minutes for the final capture to finish. The repository enables
[Vercel Fluid Compute](https://vercel.com/docs/project-configuration/vercel-json#fluid)
in `vercel.json` so older projects also support this budget. Verify that the
deployment uses Fluid Compute with a 300-second function duration before enabling
cron. A successful Next.js build alone does not verify this: incompatible function
limits can reject the subsequent output deployment.
Further catch-up remains discoverable on the next invocation or through the
manual command. Repairs and newly filled gaps also invalidate later attribution.

Live price fallback holds only public quotes in the current server process for
at most two hours from the provider observation. A cold start has no fallback;
missing prices then display as incomplete. Reused quotes are visibly stale.

For 24 hours after enabling the cron, monitor invocation status/duration,
provider `429`/`5xx` counts, missing-price reasons, incomplete/stale header
counts, oldest repair-request age, duplicate deliveries, and serialization
retries. Alert immediately when the cron fails twice, a stale request survives
the next successful invocation, or a positive portfolio remains incomplete.

Before any rollback, disable the cron schedule and manual snapshot apply path.
Application code can be rolled back while the additive tables remain. Once a
revision exists, do not drop tables, rewind `ledgerRevision`, clear adoption,
or delete immutable evidence. Repair forward with a reviewed migration and an
append-only repair revision. Restoring a database snapshot requires an explicit
incident decision and coordinated ledger write freeze.

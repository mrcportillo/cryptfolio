# Manual-transaction cutover

This runbook deploys the manual cryptocurrency ledger without rewriting legacy
amounts or archives and without inventing USD values. It does not run opening
conversion. Use it together with the opening-balance runbook.

## Contract

- Form quantities and monetary values are positive magnitudes. The server signs
  movements and external flow from the economic intent.
- Buy and transfer-in add one principal movement. Sell and transfer-out subtract
  one. Swap has exactly one outgoing and one incoming principal movement. A fee
  is one negative `FEE` movement.
- Missing actual or fee value stays `NULL`. No fee movement means the known fee
  total is zero. No CoinGecko estimate is written by this slice.
- Reversal exactly negates the original movements and every known monetary
  field at the original timestamp. Correction atomically adds that reversal and
  one same-kind replacement linked through `replacementForEventId`.
- A write is valid only if every affected position stays nonnegative at every
  later event boundary. Events sharing one timestamp form one boundary.
- Buy, transfer-in, and the destination of a swap may atomically create a
  deterministic zero-seeded position. Outgoing, source, and fee legs must use
  an existing position with a positive balance. Retries reuse the same
  position and reject a key reused for another coin or initial alias. The
  immutable initial alias is retained as retry evidence even when the display
  alias is renamed later.
- Timestamp strings must include `Z` or an explicit numeric offset. The server
  normalizes them to UTC and rejects local-time strings without a timezone or
  impossible calendar dates such as February 30.
- Authoritative numeric fields reject PostgreSQL `NaN`, `Infinity`, and
  `-Infinity`. Ledger, adoption, archive, lifecycle, and immutable creation
  timestamps reject PostgreSQL infinite timestamps. Nullable unknown USD
  fields still accept `NULL`.
- `OPENING_BALANCE` is an operator-only event and is never accepted as a manual
  intent.

## Disposable database proof

Use only a loopback database whose name contains both `cryptfolio` and `test`:

```bash
CRYPTFOLIO_LEDGER_TEST_DATABASE_URL='postgresql://localhost/cryptfolio_ledger_test' \
  pnpm test:ledger-postgres

CRYPTFOLIO_LEDGER_TEST_DATABASE_URL='postgresql://localhost/cryptfolio_ledger_test' \
  pnpm test:transactions-postgres
```

The suites create and remove uniquely named schemas. They deploy all migrations,
assert an empty Prisma diff, exercise real deferred constraints, and cover
conversion/writer locking, concurrent spends, correction rollback, lifecycle,
ownership, and immutable history. They never read `.env.local`.

## Pre-deploy checks

If the legacy baseline is not tracked yet, complete step 1 of the opening
runbook first. Then record these read-only counts before migration:

```sql
SELECT
  count(*) FILTER (WHERE "ledgerAdoptedAt" IS NULL) AS legacy_users,
  count(*) FILTER (WHERE "ledgerAdoptedAt" IS NOT NULL) AS adopted_users
FROM "User";

SELECT "kind", count(*)
FROM "PortfolioEvent"
GROUP BY "kind"
ORDER BY "kind";

SELECT count(*) AS movement_count FROM "AssetMovement";
```

Do not deploy application code that can write transactions before migration
`20260820122000_add_manual_transactions` is present. Do not apply opening
conversion until this ledger-aware writer is deployed, unless there is an
explicit write freeze.

## Deploy

```bash
pnpm prisma migrate deploy
pnpm prisma generate
pnpm prisma migrate status
```

The migration is expand-only. It adds manual-event metadata, movement roles,
position archival state, owner-safe replacement links, exact shape checks, a
deferred nonnegative-timeline trigger, an immutable adoption-boundary trigger,
immutable-ledger triggers, and adopted-legacy freeze triggers. It retains
`UserAsset.amount` and `AssetArchive` for pre-adoption reads and rollback
evidence. A position created after adoption must seed the frozen Float amount
as zero; PostgreSQL rejects a nonzero legacy amount even if application code is
bypassed. During adoption PostgreSQL captures each cutover position's initial
alias without changing its amount or archive history. It permits the adoption
marker's initial `NULL` to timestamp transition only after validating the exact
opening set. It permanently rejects clearing or moving that boundary, and
rejects manual events before adoption or before the boundary timestamp.
The database finite-value checks cover event USD fields, movement quantities
and prices, retained legacy amounts, event/movement creation timestamps,
`occurredAt`, `ledgerAdoptedAt`, position timestamps, and archive timestamps.

Every balance writer, including the opening converter and legacy asset actions,
locks the same key:

```text
cryptfolio:opening-balances:<authenticated user id>
```

Manual writers use serializable transactions with three bounded attempts. They
write-lock the authenticated `User` tuple without changing its adoption value,
require `ledgerAdoptedAt`, scope every lookup by `userId`, and explicitly flush
all five deferred ledger constraints before returning. Application timeline
validation runs first for a useful domain error; the database trigger remains
the final invariant against raw SQL. Movement and legacy-write triggers acquire
the same tuple-version guard before their records exist. If a Serializable
writer took an older snapshot while a raw/default-isolation writer held the
guard, PostgreSQL forces the stale writer to abort and retry instead of allowing
both histories to commit.

## Post-deploy verification

Run the opening verifier with the recorded fingerprints. It now catalogs the
manual schema, indexes, owner-safe foreign keys, triggers, and function bodies
as well as the opening ledger, including every finite-value constraint and the
immediate owner-write serialization trigger.

After transactions are enabled, these queries must return no rows:

```sql
-- Cross-owner movement links.
SELECT movement."id"
FROM "AssetMovement" movement
JOIN "PortfolioEvent" event
  ON event."id" = movement."portfolioEventId"
JOIN "UserAsset" position
  ON position."id" = movement."userAssetId"
WHERE movement."userId" <> event."userId"
   OR movement."userId" <> position."userId";

-- Negative position balance at any event-time boundary.
WITH boundary_delta AS (
  SELECT
    movement."userId",
    movement."userAssetId",
    event."occurredAt",
    sum(movement."quantityDelta") AS quantity_delta
  FROM "AssetMovement" movement
  JOIN "PortfolioEvent" event
    ON event."id" = movement."portfolioEventId"
   AND event."userId" = movement."userId"
  GROUP BY movement."userId", movement."userAssetId", event."occurredAt"
), timeline AS (
  SELECT
    *,
    sum(quantity_delta) OVER (
      PARTITION BY "userId", "userAssetId"
      ORDER BY "occurredAt"
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS balance
  FROM boundary_delta
)
SELECT * FROM timeline WHERE balance < 0;

-- Adopted zero/nonzero lifecycle drift.
WITH balances AS (
  SELECT
    position."id",
    position."archivedAt",
    coalesce(sum(movement."quantityDelta"), 0) AS balance,
    count(movement."id") AS movement_count
  FROM "UserAsset" position
  JOIN "User" owner
    ON owner."id" = position."userId"
   AND owner."ledgerAdoptedAt" IS NOT NULL
  LEFT JOIN "AssetMovement" movement
    ON movement."userAssetId" = position."id"
   AND movement."userId" = position."userId"
  GROUP BY position."id", position."archivedAt"
)
SELECT *
FROM balances
WHERE movement_count > 0
  AND (
    (balance = 0 AND "archivedAt" IS NULL)
    OR (balance > 0 AND "archivedAt" IS NOT NULL)
  );
```

For the personal owner, compare the home holdings with exact database sums. The
home assets, coin IDs, holdings, and adoption state are read in one
`REPEATABLE READ` snapshot. Prisma decimals are projected with `toFixed()` into
plain decimal strings, including minimum-scale values, and stay exact through
the asset, holding, history, and transaction read models. JavaScript-number
approximation is permitted only at the explicitly named external market/chart
rendering boundary; the authoritative sum remains numeric in PostgreSQL.
Transaction forms use a separate owner-scoped catalog that includes zero and
archived positions with exact decimal balances.

## Rollback

- Before adoption, roll application code back. The additive migration and
  protection triggers may remain; legacy writers still work for users whose
  `ledgerAdoptedAt` is `NULL`.
- After adoption, disable transaction entry and ledger reads together and use
  the retained legacy projection only for incident diagnosis. Do not clear the
  adoption timestamp, mutate events, delete movements, or resume legacy amount
  writes.
- A failed record, swap, reversal, or correction transaction leaves no partial
  event, movement, or lifecycle update.
- Repair forward with a reviewed migration or an auditable reversal. Restore a
  pre-cutover snapshot only under an explicit incident decision.

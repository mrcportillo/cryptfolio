# Opening-balance cutover

This runbook introduces Prisma migration tracking and the additive portfolio
ledger without rewriting `UserAsset.amount` or `AssetArchive`. The opening
converter is read-only by default. Do not use apply mode until the manual
transaction write path is deployed or legacy balance writes are frozen.

All commands must use an explicitly supplied direct PostgreSQL connection. Do
not point the procedure at a pooled URL. Take a recoverable database snapshot
before beginning and record every fingerprint in the deployment log.

## Disposable PostgreSQL integration check

Before preparing a deployment, run the real migrations, CLI, locking,
constraint, retry, rollback, and catalog checks against a disposable local
database:

```bash
CRYPTFOLIO_LEDGER_TEST_DATABASE_URL='postgresql://localhost/cryptfolio_ledger_test' \
  pnpm test:ledger-postgres

CRYPTFOLIO_LEDGER_TEST_DATABASE_URL='postgresql://localhost/cryptfolio_ledger_test' \
  pnpm test:transactions-postgres
```

The harness never reads `.env.local`. It refuses non-loopback hosts and database
names that do not contain both `cryptfolio` and `test`, and it creates and
removes only uniquely named `cryptfolio_ledger_test_*` schemas. Create the empty
test database separately if it does not exist. Never substitute a production
or shared database.

## 1. Verify and baseline the existing schema

Run the read-only preflight against the existing database for the one personal
portfolio owner:

```bash
psql "$POSTGRES_URL_NON_POOLING" \
  -v user_id='auth0|owner' \
  -f scripts/portfolio-ledger/preflight.sql
```

The script aborts on baseline drift, missing ownership objects, negative,
non-finite, rounded, or unrepresentable quantities, and oversized idempotency
keys. Record the reported legacy and archive fingerprints and row counts.

Only after the schema matches the baseline exactly, mark the baseline migration
as already applied:

```bash
pnpm prisma migrate resolve --applied 20260820120000_legacy_baseline
pnpm prisma migrate status
```

This resolve command writes migration metadata only. It must replace, not
precede, execution of the baseline `CREATE TABLE` statements on an existing
database. A new empty database applies both migrations normally.

## 2. Deploy the additive ledger schema

```bash
pnpm prisma migrate deploy
pnpm prisma generate
```

Deploy application code with ledger reads and writes disabled. The expand-only
migration retains the legacy amounts and archives, and its foreign keys prevent
an event or movement from joining records owned by different users.
Deferred database constraints require every opening event to finish its
transaction with exactly one movement for the opening position. Ledger history
also restricts ordinary user deletion; adopted-account erasure requires a
future explicit, audited workflow.

Prisma 5.10 does not reliably surface an error raised only by a deferred
constraint at interactive-transaction commit. The opening converter and every
manual ledger writer therefore execute an awaited `SET CONSTRAINTS ...
IMMEDIATE` for both opening constraints, both manual-event constraints, and the
nonnegative-timeline constraint before returning the Prisma transaction
callback.

Opening events write explicit zero flow and fees. Their movement role is
`PRINCIPAL`; role is deliberately excluded from the v1 opening fingerprint, so
the new default does not rewrite or invalidate cutover evidence. Other ledger
events preserve omitted monetary values as unknown `NULL`, never an implied
zero. Correction writes a linked `REVERSAL` plus a replacement event of the
original kind.

Before proceeding, follow the manual-transaction deployment checks in
[`manual-transactions-cutover.md`](manual-transactions-cutover.md). All legacy
writers and the opening converter must use the same per-user advisory lock.

## 3. Dry-run the personal portfolio

Choose one fixed UTC adoption timestamp. It is a reporting boundary, not a
reconstruction of prior trades. The dry run performs no writes:

```bash
pnpm ledger:opening-balances -- \
  --user-id 'auth0|owner' \
  --adoption-at '2026-08-21T03:00:00.000Z'
```

Compare its counts with preflight and record `legacyFingerprint`. Do not proceed
if legacy writers remain enabled, quantities changed, or the database snapshot
is unavailable.

## 4. Apply once, inside the write freeze

```bash
pnpm ledger:opening-balances -- \
  --user-id 'auth0|owner' \
  --apply \
  --adoption-at '2026-08-21T03:00:00.000Z' \
  --expected-fingerprint '<legacyFingerprint>'
```

Apply mode uses a serializable transaction, a transaction-scoped advisory lock,
and a tuple-version write lock on the user row. A concurrent raw legacy writer
therefore forces the stale conversion attempt to abort and retry before it can
adopt an incomplete snapshot. Apply locks the user's legacy positions, checks
the dry-run fingerprint, inserts one exact decimal opening movement per
positive position, verifies all openings, and sets `ledgerAdoptedAt` last. A
database trigger validates that exact opening set during the initial adoption
transition, then makes the non-null boundary permanently immutable. Any error
rolls back the whole conversion. Zero balances create no event. No JavaScript
number is used for quantity conversion. Database checks reject non-finite
legacy amounts and all infinite cutover timestamps.

## 5. Verify and prove retry stability

Run verification with the fingerprints recorded before apply:

```bash
psql "$POSTGRES_URL_NON_POOLING" \
  -v user_id='auth0|owner' \
  -v adoption_at='2026-08-21T03:00:00.000Z' \
  -v expected_legacy_fingerprint='<legacyFingerprint>' \
  -v expected_archive_fingerprint='<archiveFingerprint>' \
  -f scripts/portfolio-ledger/verify.sql
```

Record the emitted `opening_fingerprint`. Repeat the same apply command. It must
report `alreadyApplied: true`. Then repeat verification with
`-v expected_opening_fingerprint='<openingFingerprint>'`; any duplicate or
changed event fails verification.

Retry verification reads opening events and opening movements only. Valid buys,
sells, swaps, or fees recorded after adoption do not change the v1 opening
fingerprint or opening quantities. Alias-only edits use the immutable initial
alias captured at adoption, so they do not invalidate cutover evidence either.
Current-ledger health is a separate check in the manual-transaction runbook.

Only after these checks pass may ledger reads be enabled. Post-adoption reads
must derive quantities and history from exact movement sums; they must never
fall back to `UserAsset.amount` or `AssetArchive`. The valued USD baseline is
created by the daily-valuation slice, not by this converter.

## Rollback

- Before conversion, roll application code back and leave the additive tables
  unused. Do not drop them during an incident.
- A failed apply transaction leaves no openings and no adoption boundary.
- After a successful conversion, disable ledger reads/writes while
  investigating. The database will not permit returning to the retained legacy
  projection by clearing `ledgerAdoptedAt`; do not delete events or edit
  financial history manually.
- Restore the pre-cutover database snapshot only under an explicit incident
  decision. Otherwise repair forward with an audited migration or reversal.

`AssetArchive` is never converted or written by the opening tool. Its preflight
fingerprint must remain identical after conversion.

# Preserve Home and Trend during portfolio rollout

The original PostgreSQL schema must continue to support login persistence, Home,
asset detail/history, and legacy asset editing. New portfolio features show setup
states until the owner has adopted the ledger. Trend always retains its market
movers and charts; a personal-insights error is contained within that section.

## Incident: 2026-09-06

Release `8ef3cdb` built and deployed successfully but authenticated Home and Trend
rendered the global error screen. Vercel runtime logs at 23:24Z and 23:25Z reported
Prisma P2022: `User.ledgerAdoptedAt` did not exist. The production database still
used the original schema. Tests covered migrated databases only.

Vercel Instant Rollback restored release `78c20c7`, deployment
`E6P8dwX8FccmfWS3vNi1pNyB6XQ8`. Authenticated Home displayed holdings again, and
Trend displayed all five market movers and charts. No production database or
holding was changed as part of recovery.

## Compatibility repair

- Read the adoption marker using a parameterized row-to-JSON query. An absent
  additive column yields NULL; unrelated database errors still propagate.
- Select original asset columns before adoption, including mutation return values.
- Persist Auth0 session users with explicit original columns. Prisma's generated
  upsert would insert the new defaulted `ledgerRevision` field even with a narrow
  return selection. Signing in must preserve an existing adoption marker.
- Gate new tables behind adoption. Adopted owners must never fall back to legacy
  balances when their ledger fails.
- Retain the original Trend market view with a separate personal-insights section.

`pnpm test:legacy-postgres` creates a private schema with only the original
baseline. It reproduces P2022, exercises the repaired reads and edits, and verifies
that adoption is recognized immediately without restarting. The other three
PostgreSQL suites exercise fully migrated, adopted portfolios. All four run in CI.

## Before promoting the repair

1. Require Portfolio CI and Vercel preview deployment to pass on the proposed
   commit. Check authenticated Home and Trend in the target environment.
2. Confirm Home shows current holdings, the asset editor saves in an isolated test
   database, and detail/history remains readable. Never edit production holdings
   merely to test deployment.
3. Confirm Trend shows market movers/charts. On the original schema, Transactions,
   weekly reports, Scenarios, and personal insights should show their setup states.
4. Inspect rendered content and runtime logs: Next.js streaming errors can return
   HTTP 200. A Ready deployment or a successful HTTP probe alone is insufficient.
5. After Vercel Instant Rollback, automatic production promotion is disabled.
   Explicitly promote the verified repair through the dashboard's supported flow;
   do not restore the known-broken deployment just to clear rollback state.
6. Verify authenticated Home and Trend on the production domain after promotion.
   If either regresses, restore the recorded working deployment and inspect logs.

Database baselining, additive migrations, ledger adoption, and snapshot activation
remain the separate staged rollout in issue #17 and the linked cutover runbooks.

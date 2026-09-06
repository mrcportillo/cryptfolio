# Cryptfolio

Cryptfolio is a Next.js application for tracking cryptocurrency holdings. It uses Auth0 for authentication, Prisma/Postgres for user data, and CoinGecko for market data.

## Requirements

- Node.js 24 (used by CI)
- pnpm 11
- PostgreSQL
- Auth0 Regular Web Application
- CoinGecko API key

## Environment

Create `.env.local` with server-only values:

```env
APP_BASE_URL=http://localhost:3000
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
AUTH0_SECRET=...
COIN_API_KEY=...
COIN_API_PLAN=demo
CRON_SECRET=...
POSTGRES_PRISMA_URL=...
POSTGRES_URL_NON_POOLING=...
```

`AUTH0_ISSUER_BASE_URL` and `AUTH0_BASE_URL` are still accepted for compatibility with the previous SDK configuration. Never expose secrets through `NEXT_PUBLIC_*` variables or commit `.env.local`.

Register these Auth0 URLs for local development:

- Callback: `http://localhost:3000/api/auth/callback`
- Logout: `http://localhost:3000`

## Development

```bash
pnpm install
pnpm dev
```

The application requires an authenticated Auth0 session. Authentication is handled by the middleware boundary and is checked again inside Server Actions, route handlers, and the data-access layer.

## Scripts

- `pnpm dev` — start the development server
- `pnpm build` — create a production build
- `pnpm start` — start the production server
- `pnpm lint` — run ESLint
- `pnpm test` — run the offline ownership, ledger, valuation, report, and insight tests
- `pnpm test:ledger-postgres` — run opt-in ledger integration tests against an explicitly supplied disposable local PostgreSQL database
- `pnpm test:transactions-postgres` — run opt-in manual-transaction, concurrency, and cutover tests against that disposable database
- `pnpm run audit` — audit production dependencies
- `pnpm ledger:opening-balances -- --help` — inspect the dry-run-first opening-balance cutover command
- `pnpm valuation:snapshot -- --help` — preview/apply a daily snapshot or append a documented repair revision
- `pnpm test:valuation-postgres` — run opt-in valuation, idempotency, and correction-invalidation checks against an explicitly supplied disposable local PostgreSQL database

Run `pnpm run audit` to check current production advisories. Keep dependency fixes
within the supported framework version and update the lockfile deliberately.

## Continuous integration

The `Portfolio CI` workflow runs on pull requests, pushes to `main`, and manual
dispatch. It installs the locked dependencies with the pnpm version declared in
`package.json`, then runs offline tests, all three PostgreSQL suites, typecheck,
lint, the production dependency audit, and a production build without application
credentials. Official setup actions are pinned to commits.

Database checks use a disposable PostgreSQL 15 service and uniquely named schemas.
The workflow passes only local test URLs to those steps; it does not need Auth0,
CoinGecko, Vercel, or production database secrets. The separate PostgreSQL commands
require their test databases and fail instead of silently skipping.

Open the failed step in GitHub Actions to inspect its diagnostics. A green CI run
verifies code and database invariants; hosted Auth0 callbacks, deployment settings,
and the controlled production cutover still require their runbook checks. Vercel's
deployment check remains separate.

## Data model and database changes

The Prisma schema includes ownership indexes and cascading archive deletion. Apply schema changes through the normal Prisma migration workflow in each environment; do not use `db push` against production.

```bash
pnpm prisma migrate dev --name add_asset_indexes_and_archive_cascade
pnpm prisma generate
```

The repository now contains a legacy baseline migration because the deployed
schema predates Prisma migration tracking. Do not run that baseline against an
existing database. Follow the checked, staged procedure in
[`docs/operations/opening-balance-cutover.md`](docs/operations/opening-balance-cutover.md),
including baseline verification and `prisma migrate resolve`, before deploying
the additive ledger migrations. Opening-balance apply mode remains deferred
until the transaction-aware application build is deployed or legacy writes are
explicitly frozen. The manual-event contract and verification queries are in
[`docs/operations/manual-transactions-cutover.md`](docs/operations/manual-transactions-cutover.md).
Daily snapshot configuration, manual repair, reconciliation checks, and
forward-only rollback are documented in
[`docs/operations/daily-valuation.md`](docs/operations/daily-valuation.md).
Daily/weekly reports, personal impact, allocation ranges, and hypothetical
scenarios are covered by
[`docs/operations/portfolio-experiences.md`](docs/operations/portfolio-experiences.md).

The PostgreSQL ledger integration suite never reads `.env.local`. Supply
`CRYPTFOLIO_LEDGER_TEST_DATABASE_URL` explicitly; the harness refuses
non-loopback hosts and database names that do not contain both `cryptfolio` and
`test`, then creates and removes only uniquely named test schemas.
The valuation suite uses `CRYPTFOLIO_VALUATION_TEST_DATABASE_URL` with the same
loopback and safe-name requirements and forces UTC database sessions.

## Architecture notes

- `src/lib/auth0.ts` owns the Auth0 v4 client and callback user upsert.
- `src/lib/auth.ts` provides the authenticated-user boundary.
- `src/utils/db-api.ts` scopes asset access by Auth0 subject and paginates lists.
- CoinGecko market data is batched and cached with bounded retries and timeouts.
- User-specific portfolio data is not publicly cached.
- Asset mutations validate input and update history atomically.
- `/transactions` is the authenticated manual journal for buys, sells,
  transfers, swaps, and crypto fees. Financial inputs remain exact decimal
  strings from the form through the ledger service.
- Transaction times are entered in `America/Argentina/Salta` and submitted
  with an explicit `-03:00` offset. Unknown USD amounts stay `NULL` and are
  displayed as unvalued rather than zero.
- Corrections retain the original event and atomically write its exact reversal
  plus a complete same-kind replacement.
- Current portfolio worth is live and explicitly incomplete when a positive
  holding lacks a USD price. Stable daily snapshots close at Salta local
  midnight and retain immutable price-quality and reconciliation evidence.

## Operational monitoring

Monitor authentication callback failures, `asset.*` structured error operations, CoinGecko `429`/`5xx` responses, request latency, rate-limit responses, and database transaction failures. A sustained increase in any of these signals should trigger rollback or disabling the affected upstream-dependent flow.

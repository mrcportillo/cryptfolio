---
title: Transaction ledger and portfolio valuation
status: accepted
date: 2026-08-20
owners: [marcos]
---

# ADR 0001: Transaction ledger and portfolio valuation

## Context

Cryptfolio currently stores one mutable amount per `UserAsset` and copies the old amount into `AssetArchive` when that amount is edited. Live CoinGecko prices produce the current total worth, but the application cannot distinguish money or assets added by the user from gains and losses caused by price movement.

The personal portfolio should support:

- Manual transactions from the adoption date forward.
- Existing holdings as the opening balance, without historical backfill.
- Daily and weekly worth history even when no holding is edited.
- Separate reporting for external flows, fees, and market-driven movement.
- Per-coin contribution, personalized movement signals, allocation ranges, and stress scenarios.

## Decision

### 1. Establish an explicit opening boundary

At rollout, create one `OPENING_BALANCE` event for every existing `UserAsset` with a positive quantity. The event timestamp is the adoption timestamp and its quantity must equal the existing amount.

Opening balances establish the first performance baseline. They are not deposits, gains, or historical purchases. Reports must not claim performance before this boundary.

The conversion must be idempotent and verified before the legacy amount or archive fields are retired. Existing `AssetArchive` rows remain read-only during the transition and are not converted into transactions. The additive schema and dry-run tooling ship before conversion; apply mode is used only after transaction-aware writes replace the legacy balance mutation path, or during an explicit write freeze.

The adoption boundary and exact opening quantities are ledger data. The USD-valued baseline snapshot is a separate valuation concern and is introduced with daily valuation; opening conversion must not invent prices.

### 2. Make the transaction ledger the source of truth

Future holdings are the sum of immutable, signed asset movements grouped into portfolio events. `UserAsset` remains the named position that connects an alias to a CoinGecko coin ID, but its mutable `amount` is no longer authoritative once the ledger is enabled.

Supported event intents are:

- `OPENING_BALANCE`
- `BUY`
- `SELL`
- `TRANSFER_IN`
- `TRANSFER_OUT`
- `SWAP`
- `FEE`
- `REVERSAL`

A swap contains at least two asset movements under one event. A fee paid in a tracked coin is another negative movement on the same event. Correction is an operation, not an event kind: it creates a durable `REVERSAL` linked to the incorrect event, then creates a replacement event of the original intent. The replacement link and cross-event semantic validation belong to the manual-transaction service.

Quantities and money use database decimal types, never binary floating point. A transaction cannot leave a position below zero unless a future ADR explicitly introduces borrowing or short positions.

### 3. Track the portfolio boundary separately from trades

Each event records its USD external-flow effect:

- Money or assets entering the tracked portfolio are positive external flow.
- Money or assets leaving the tracked portfolio are negative external flow.
- Swaps between tracked positions have zero external flow.
- Opening balances establish the baseline and have zero reportable external flow.
- Fees are reported separately from external flow and market movement.

For manual events, the user may enter the actual USD total and fee. Omitted monetary values remain `NULL` and mean unknown, never zero. If Cryptfolio later estimates a value from CoinGecko, it must persist and label that estimate explicitly rather than silently changing unknown to zero.

### 4. Use hybrid valuation history

USD is the initial and only reporting currency. The personal reporting timezone is `America/Argentina/Salta`.

Cryptfolio stores one immutable daily portfolio snapshot for each local calendar day. A snapshot contains the total plus position-level quantity, USD price, and USD value lines. Snapshot creation is:

- Scheduled once per day after local midnight.
- Idempotent for `(user, reporting date)`.
- Authenticated independently from interactive user sessions.
- Calculated against a fixed cutoff so a concurrent transaction cannot be half-included.

The current dashboard point uses live CoinGecko prices and derived current holdings. If a scheduled snapshot is missing, a repair path reconstructs it from the ledger and CoinGecko historical prices, marking repaired price lines as estimated.

This hybrid keeps historical reports stable while allowing the latest worth to move without any asset update.

### 5. Reconcile flows and performance

For any reporting period:

```text
ending worth = starting worth + net external flow + market movement - fees
```

Market movement is the residual after external flows and fees are removed from the total worth change. Per-coin contribution is calculated over price intervals using the quantity held during each interval, splitting an interval at transaction timestamps when necessary.

Every complete report must reconcile within the configured decimal tolerance. If a required price is unavailable, the report is explicitly incomplete rather than silently substituting zero.

### 6. Enforce ownership at every data boundary

Every position, event, movement, snapshot, allocation target, and scenario read or mutation is scoped by the authenticated user ID. Knowing another record ID must never be enough to read or change it.

### 7. Preserve history

Positions with ledger history are archived when no longer active; they are not hard-deleted. Events and completed snapshots are immutable except through explicit repair or reversal workflows that retain an audit trail. A user with ledger history cannot be deleted through ordinary cascading deletion; account erasure requires a future explicit, audited workflow that defines how financial history is removed.

Opening-event completeness is enforced by deferred database constraints so an event and movement can be created in either order. Prisma 5.10 ledger writers must explicitly flush those named constraints with an awaited `SET CONSTRAINTS ... IMMEDIATE` before returning the interactive transaction callback; otherwise a commit-time constraint error may not be surfaced to application code.

## Consequences

### Positive

- Portfolio worth changes with coin prices even when the user does nothing.
- Deposits and withdrawals no longer masquerade as investment performance.
- Daily and weekly reports share one calculation model.
- Per-coin contribution, allocation drift, personal signals, and stress scenarios become derivable from the same ledger.
- Historical reports remain reproducible if external API results later change.

### Costs and constraints

- Transaction entry is more structured than directly editing an amount.
- Snapshot scheduling, repair, idempotency, and API failure states require explicit handling.
- Decimal conversion and the legacy-data cutover need verification before old fields can be removed.
- Historical prices are external estimates, not exchange execution records.

## Alternatives considered

### Continue archiving edited balances

Rejected because it records only user edits and cannot distinguish external flow from price movement.

### Reconstruct every report from CoinGecko on demand

Rejected as the sole mechanism because reports would depend on API availability, retention, granularity, and future revisions every time they are viewed.

### Store snapshots without a transaction ledger

Rejected because snapshots alone cannot explain whether worth changed due to contributions, withdrawals, fees, or the market.

### Backfill historical transactions

Rejected for this personal rollout. Existing holdings become the opening baseline and trustworthy performance begins there.

## Follow-up decisions deferred

- Additional reporting currencies.
- Wallet or exchange synchronization.
- Tax-lot accounting methods.
- Borrowing, staking rewards, derivatives, and short positions.
- Automated trade execution.

## References

- [CoinGecko historical market chart range](https://docs.coingecko.com/reference/coins-id-market-chart-range)
- [CoinGecko historical data by date](https://docs.coingecko.com/reference/coins-id-history)
- [Vercel Cron Jobs quickstart](https://examples.vercel.com/docs/cron-jobs/quickstart)

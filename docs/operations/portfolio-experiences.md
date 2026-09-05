# Portfolio reports, preferences, and scenarios

Issues #11–#14 add read-only daily/weekly explanations plus saved preferences
and hypothetical scenarios. Deploy after the opening-balance, manual-transaction,
and daily-valuation runbooks. No production migration or adoption was performed
as part of implementation.

## Reporting contract

- Home shows live worth, net external flow, fees, market movement, and material
  positive/negative coin contributions since the latest usable snapshot.
- Weekly reports use Monday-to-Monday weeks in America/Argentina/Salta. The
  adoption week begins at the adoption instant. Earlier and future weeks are
  unavailable. Completed weeks read immutable stored price evidence; the current
  week appends a live period using the same decimal reconciliation service.
- Missing or stale history is explicitly incomplete. Repair it with the manual
  snapshot command in `daily-valuation.md`. Report reads do not repair or write
  history. A concurrent repair that changes the live starting revision also
  makes the current-week report incomplete until refreshed.
- Reference-price estimates, repairs, and stale current prices are labeled in
  plain language. Unknown totals remain unavailable, with known subtotals labeled.

## Preferences and scenarios

- Tremors include positive current holdings only. The estimated 24-hour USD
  impact holds today's quantity constant at both prices, using
  `current value × percentage change / (100 + percentage change)`. It is not
  transaction-adjusted performance. The saved minimum absolute impact defaults
  to USD 10. Missing or unusable changes are omitted.
- Allocation ranges are per named position, including distinct positions in
  the same coin. Bounds satisfy `0 ≤ minimum ≤ maximum ≤ 100`. Drift requires
  fresh complete prices and a positive total. The signed USD adjustment moves
  the position to the nearest boundary while holding total portfolio value
  constant; it does not model an external deposit or withdrawal.
- Scenarios have a trimmed 1–80 character name and 1–20 unique coin IDs. Shocks
  accept up to two decimal places from −100% to +1,000%. Unshocked holdings keep
  their current value; unheld coins have no impact. Missing/stale prices produce
  incomplete results and a labeled known subtotal.
- Create, edit, and archive are owner-scoped writes to scenario tables only.
  Running a scenario performs no writes. Repeated saves from the same new form
  reuse its creation key; use “Clear form and create another” for a new scenario.
  Archive removes a scenario from the active list without deleting its records.
- These features never place or initiate trades.

## Additive migration and verification

Deploy `20260905190000_add_portfolio_insights` with the normal Prisma migration
process before serving the new routes. It creates PortfolioPreference,
AllocationTarget, StressScenario, and ScenarioShock without transforming ledger
or valuation data. Generate the Prisma client from the same schema revision.

The database enforces owner-safe composite foreign keys, allocation/impact/shock
bounds, finite dates, and valid coin IDs. Server validation additionally enforces
scenario cardinality and decimal precision before writes.

In the approved staging environment, use two test owners to verify:

1. Save and reload a threshold and allocation range; a foreign position ID fails.
2. Create, edit, run, and archive a scenario; a foreign ID returns unavailable.
3. Compare portfolio event, movement, snapshot revision, and derived quantity
   records before/after the scenario lifecycle; they remain identical.
4. Inspect current and prior weekly reports, the adoption week, and a missing
   snapshot. Verify repaired history becomes available after repair and refresh.
5. Exercise keyboard navigation and mobile forms, including invalid ranges,
   duplicate coin IDs, and missing-price results.

## Post-deploy monitoring

The repository maintainer owns the first 24 hours of verification. Watch errors
and latency for `/home`, `/reports/weekly`, `/trend`, and `/scenarios`, alongside
the daily snapshot/provider metrics in the valuation runbook. Healthy saves
persist only for the current owner; reports reconcile; scenario runs leave
financial records unchanged. Repeated “Unable to save” responses or unavailable
reports with otherwise complete snapshots require investigation of migration
state, database connectivity, and price availability.

If owner scoping or reconciliation fails, stop rollout and revert the application
to the last verified revision while retaining the additive tables and immutable
financial evidence. Do not delete history to clear an error.

Local validation uses disposable PostgreSQL and synthetic browser fixtures.
Full Auth0 and deployed-environment verification remains a rollout check. The
Vercel preview was failing on `a9d194d`; the available CLI login could not access
its configured account, so its build logs could not be inspected in this session.

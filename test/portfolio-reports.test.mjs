import assert from "node:assert/strict";
import test from "node:test";
import {
  allocationPercent,
  combineReportPeriods,
  weekWindow,
} from "../src/services/portfolio-valuation/report-domain.ts";
import { formatValuationUsd } from "../src/lib/valuation-ui.ts";

const start = {
  kind: "DAILY",
  cutoffAt: new Date("2026-08-24T03:00:00Z"),
  totalValueUsd: "100",
  positions: [{ assetId: "bitcoin", valueUsd: "100" }],
};
const period = (value, flow, fees, price) => ({
  lifecycleStatus: "COMPLETE",
  reconciliationStatus: "COMPLETE",
  totalValueUsd: value,
  netExternalFlowUsd: flow,
  feesUsd: fees,
  positions: [{ assetId: "bitcoin", valueUsd: value }],
  contributions: [
    {
      assetId: "bitcoin",
      externalFlowUsd: flow,
      feesUsd: fees,
      priceMovementUsd: price,
    },
  ],
});

test("daily and weekly use the same reconciliation without counting deposits as gains", () => {
  const report = combineReportPeriods(start, [
    period("220", "100", "0", "20"),
    period("250", "0", "5", "35"),
  ]);
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.marketMovementUsd, "55");
  assert.equal(report.netExternalFlowUsd, "100");
  assert.equal(report.feesUsd, "5");
  assert.equal(report.totalChangeUsd, "150");
  assert.equal(report.coins[0].marketMovementUsd, "55");
  assert.equal(report.coins[0].endingAllocation, "100.00");
});

test("unknown values and stale snapshots cannot become complete performance", () => {
  assert.equal(
    combineReportPeriods(start, [period("220", null, "0", "20")]).status,
    "INCOMPLETE",
  );
  assert.equal(
    combineReportPeriods(start, [
      { ...period("220", "100", "0", "20"), lifecycleStatus: "STALE" },
    ]).status,
    "INCOMPLETE",
  );
  assert.equal(allocationPercent("10", null), null);
  assert.equal(allocationPercent("0", "0"), null);
  assert.equal(allocationPercent("2", "3"), "66.67");
});

test("week boundaries use Salta Mondays and limit the first adoption week", () => {
  const now = new Date("2026-09-07T02:59:00Z");
  const adopted = new Date("2026-09-02T18:00:00Z");
  const window = weekWindow(undefined, now, adopted);
  assert.equal(window.firstDate, "2026-08-31");
  assert.equal(window.limited, true);
  assert.equal(window.effectiveStart.toISOString(), adopted.toISOString());
  assert.equal(
    weekWindow(undefined, new Date("2026-09-07T03:00:00Z"), adopted).firstDate,
    "2026-09-07",
  );
  assert.throws(() => weekWindow("2026-08-01", now, adopted));
  assert.throws(() => weekWindow("2026-09-20", now, adopted));
  assert.throws(() => weekWindow("2026-02-30", now, adopted));
});

test("USD display rounds exact large decimals and communicates signed losses", () => {
  assert.equal(
    formatValuationUsd("12345678901234567890.005"),
    "$12,345,678,901,234,567,890.01",
  );
  assert.equal(formatValuationUsd("-10.005", true), "−$10.01");
  assert.equal(formatValuationUsd(null), "Unavailable");
});

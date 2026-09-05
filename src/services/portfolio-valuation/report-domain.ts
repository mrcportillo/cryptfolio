import {
  addDecimals,
  compareDecimals,
  decimalToUnits,
  subtractDecimals,
  sumDecimals,
  unitsToDecimal,
} from "../portfolio-transactions/decimal.ts";
import {
  calculatePeriodReconciliation,
  cutoffAtForReportingDate,
  reportingDateForInstant,
} from "./domain.ts";
import type { PreviousSnapshotState, SnapshotDraft } from "./service.ts";

const DAY = 86_400_000;
export function shiftDate(date: string, days: number) {
  cutoffAtForReportingDate(date);
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);
}

export function weekWindow(
  selection: string | undefined,
  now: Date,
  adoptedAt: Date,
) {
  const today = reportingDateForInstant(now);
  const selected = selection ?? today;
  cutoffAtForReportingDate(selected);
  const weekday = new Date(`${selected}T00:00:00Z`).getUTCDay();
  const firstDate = shiftDate(selected, -((weekday + 6) % 7));
  const nextDate = shiftDate(firstDate, 7);
  const startsAt = new Date(
    Date.parse(`${firstDate}T00:00:00Z`) + 3 * 60 * 60 * 1000,
  );
  const closesAt = new Date(startsAt.getTime() + 7 * DAY);
  if (startsAt > now || closesAt <= adoptedAt)
    throw new Error(
      "Choose a week on or after portfolio adoption and no later than this week.",
    );
  return {
    firstDate,
    nextDate,
    startsAt,
    endsAt: closesAt > now ? now : closesAt,
    current: closesAt > now,
    limited: adoptedAt > startsAt,
    effectiveStart: adoptedAt > startsAt ? adoptedAt : startsAt,
  };
}

export function allocationPercent(
  value: string | null,
  total: string | null,
): string | null {
  if (value === null || total === null || compareDecimals(total, "0") === 0)
    return null;
  // Percentage rounded to two decimal places for display only.
  const numerator = decimalToUnits(value) * BigInt(10000);
  const denominator = decimalToUnits(total);
  const hundredths = (numerator + denominator / BigInt(2)) / denominator;
  return (
    (hundredths / BigInt(100)).toString() +
    "." +
    (hundredths % BigInt(100)).toString().padStart(2, "0")
  );
}

export function coinValues(
  positions: readonly { assetId: string; valueUsd: string | null }[],
) {
  const result = new Map<string, string | null>();
  for (const position of positions) {
    const previous = result.get(position.assetId) ?? "0";
    result.set(
      position.assetId,
      (result.has(position.assetId) && result.get(position.assetId) === null) ||
        position.valueUsd === null
        ? null
        : addDecimals(previous, position.valueUsd),
    );
  }
  return result;
}

export function combineReportPeriods(
  start: PreviousSnapshotState,
  periods: readonly SnapshotDraft[],
) {
  const ending = periods.at(-1);
  const startValues = coinValues(start.positions);
  const endValues = coinValues(ending?.positions ?? []);
  const ids = new Set([
    ...startValues.keys(),
    ...endValues.keys(),
    ...periods.flatMap((period) =>
      period.contributions.map((coin) => coin.assetId),
    ),
  ]);
  const knownSum = (values: (string | null)[]) =>
    values.some((value) => value === null)
      ? null
      : sumDecimals(values as string[]);
  const reconciliation = calculatePeriodReconciliation({
    startingValueUsd: start.totalValueUsd,
    endingValueUsd: ending?.totalValueUsd ?? null,
    netExternalFlowUsd: knownSum(
      periods.map((period) => period.netExternalFlowUsd),
    ),
    feesUsd: knownSum(periods.map((period) => period.feesUsd)),
    coins: [...ids].sort().map((assetId) => ({
      assetId,
      startingValueUsd: startValues.has(assetId)
        ? startValues.get(assetId)!
        : "0",
      endingValueUsd: endValues.has(assetId) ? endValues.get(assetId)! : "0",
      externalFlowUsd: knownSum(
        periods.map(
          (period) =>
            period.contributions.find((coin) => coin.assetId === assetId)
              ?.externalFlowUsd ??
            (period.reconciliationStatus === "COMPLETE" ? "0" : null),
        ),
      ),
      feesUsd: knownSum(
        periods.map(
          (period) =>
            period.contributions.find((coin) => coin.assetId === assetId)
              ?.feesUsd ??
            (period.reconciliationStatus === "COMPLETE" ? "0" : null),
        ),
      ),
      priceMovementUsd: knownSum(
        periods.map(
          (period) =>
            period.contributions.find((coin) => coin.assetId === assetId)
              ?.priceMovementUsd ??
            (period.reconciliationStatus === "COMPLETE" ? "0" : null),
        ),
      ),
    })),
  });
  const complete =
    periods.length > 0 &&
    periods.every((period) => period.lifecycleStatus === "COMPLETE") &&
    reconciliation.status === "COMPLETE";
  return {
    ...reconciliation,
    status: complete ? ("COMPLETE" as const) : ("INCOMPLETE" as const),
    totalChangeUsd:
      ending?.totalValueUsd != null && start.totalValueUsd != null
        ? subtractDecimals(ending.totalValueUsd, start.totalValueUsd)
        : null,
    startingValueUsd: start.totalValueUsd,
    endingValueUsd: ending?.totalValueUsd ?? null,
    coins: reconciliation.contributions
      .map((coin) => ({
        ...coin,
        startingAllocation: allocationPercent(
          startValues.has(coin.assetId) ? startValues.get(coin.assetId)! : "0",
          start.totalValueUsd,
        ),
        endingAllocation: allocationPercent(
          endValues.has(coin.assetId) ? endValues.get(coin.assetId)! : "0",
          ending?.totalValueUsd ?? null,
        ),
      }))
      .sort((left, right) => {
        const magnitude = (value: string | null) => {
          const units = decimalToUnits(value ?? "0");
          return units < BigInt(0) ? -units : units;
        };
        return compareDecimals(
          unitsToDecimal(magnitude(right.marketMovementUsd)),
          unitsToDecimal(magnitude(left.marketMovementUsd)),
        );
      }),
  };
}

export type ReportCalculation = ReturnType<typeof combineReportPeriods>;

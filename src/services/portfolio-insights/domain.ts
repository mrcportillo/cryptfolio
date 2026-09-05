import {
  absoluteDifference,
  addDecimals,
  canonicalDecimal,
  compareDecimals,
  divideDecimals,
  multiplyDecimals,
  normalizeFiniteNumber,
  subtractDecimals,
  sumDecimals,
} from "../portfolio-transactions/decimal.ts";
import type { LiveValuation } from "../portfolio-valuation/domain.ts";
import type { CoinMarketItem } from "../coin/types.ts";
import {
  coinValues,
  allocationPercent,
} from "../portfolio-valuation/report-domain.ts";

export function boundedDecimal(
  value: unknown,
  label: string,
  minimum: string,
  maximum: string,
) {
  if (typeof value !== "string" || !/^-?(0|[1-9]\d*)(\.\d{1,2})?$/.test(value))
    throw new Error(
      `${label} must be a decimal with at most two decimal places.`,
    );
  const decimal = canonicalDecimal(value);
  if (
    compareDecimals(decimal, minimum) < 0 ||
    compareDecimals(decimal, maximum) > 0
  )
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  return decimal;
}

export function validateAllocation(minimum: unknown, maximum: unknown) {
  const minimumPct = boundedDecimal(minimum, "Minimum percentage", "0", "100");
  const maximumPct = boundedDecimal(maximum, "Maximum percentage", "0", "100");
  if (compareDecimals(minimumPct, maximumPct) > 0)
    throw new Error("Minimum percentage must not exceed maximum percentage.");
  return { minimumPct, maximumPct };
}

export type Shock = { assetId: string; percent: string };
export function validateScenario(
  name: unknown,
  shocks: unknown,
): { name: string; shocks: Shock[] } {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80)
    throw new Error("Name must contain 1 to 80 characters.");
  if (!Array.isArray(shocks) || shocks.length < 1 || shocks.length > 20)
    throw new Error("Choose between 1 and 20 coin shocks.");
  const seen = new Set<string>();
  return {
    name: name.trim(),
    shocks: shocks.map((shock) => {
      if (
        !shock ||
        typeof shock.assetId !== "string" ||
        shock.assetId.length > 160 ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shock.assetId) ||
        seen.has(shock.assetId)
      )
        throw new Error("Each shock needs a unique valid coin ID.");
      seen.add(shock.assetId);
      return {
        assetId: shock.assetId,
        percent: boundedDecimal(
          shock.percent,
          "Shock percentage",
          "-100",
          "1000",
        ),
      };
    }),
  };
}

export function allocationDrift(
  valuation: LiveValuation,
  targets: readonly {
    userAssetId: string;
    minimumPct: string;
    maximumPct: string;
  }[],
) {
  const complete =
    valuation.valuationStatus === "COMPLETE" &&
    valuation.totalValueUsd !== null &&
    compareDecimals(valuation.totalValueUsd, "0") > 0;
  return targets.map((target) => {
    const position = valuation.positions.find(
      (position) => position.positionId === target.userAssetId,
    );
    const value = position?.valueUsd ?? null;
    if (!complete || value === null)
      return {
        ...target,
        assetId: position?.assetId,
        status: "INCOMPLETE" as const,
        allocation: null,
        adjustmentUsd: null,
      };
    const minimum = multiplyDecimals(
      valuation.totalValueUsd!,
      multiplyDecimals(target.minimumPct, "0.01"),
    );
    const maximum = multiplyDecimals(
      valuation.totalValueUsd!,
      multiplyDecimals(target.maximumPct, "0.01"),
    );
    const status =
      compareDecimals(value, minimum) < 0
        ? ("BELOW" as const)
        : compareDecimals(value, maximum) > 0
          ? ("ABOVE" as const)
          : ("IN_RANGE" as const);
    return {
      ...target,
      assetId: position?.assetId,
      status,
      allocation: allocationPercent(value, valuation.totalValueUsd),
      adjustmentUsd:
        status === "BELOW"
          ? subtractDecimals(minimum, value)
          : status === "ABOVE"
            ? subtractDecimals(maximum, value)
            : "0",
    };
  });
}

export function personalTremors(
  valuation: LiveValuation,
  markets: readonly CoinMarketItem[],
  minimumImpactUsd: string,
) {
  const values = coinValues(
    valuation.positions.filter(
      (position) => compareDecimals(position.quantity, "0") > 0,
    ),
  );
  return [...values.entries()]
    .flatMap(([assetId, value]) => {
      const market = markets.find((market) => market.id === assetId);
      const change = market?.price_change_percentage_24h;
      if (
        value === null ||
        typeof change !== "number" ||
        !Number.isFinite(change) ||
        change <= -100
      )
        return [];
      let percent: string;
      try {
        percent = normalizeFiniteNumber(change);
      } catch {
        return [];
      }
      const impactUsd = divideDecimals(
        multiplyDecimals(value, percent),
        addDecimals("100", percent),
      );
      if (
        compareDecimals(absoluteDifference(impactUsd, "0"), minimumImpactUsd) <
        0
      )
        return [];
      return [{ assetId, percent, impactUsd }];
    })
    .sort((left, right) =>
      compareDecimals(
        absoluteDifference(right.impactUsd, "0"),
        absoluteDifference(left.impactUsd, "0"),
      ),
    );
}

export function runStressScenario(
  valuation: LiveValuation,
  shocks: readonly Shock[],
) {
  const values = coinValues(
    valuation.positions.filter(
      (position) => compareDecimals(position.quantity, "0") > 0,
    ),
  );
  const byCoin = new Map(shocks.map((shock) => [shock.assetId, shock.percent]));
  const coins = [...new Set([...values.keys(), ...byCoin.keys()])]
    .sort()
    .map((assetId) => {
      const valueUsd = values.has(assetId) ? values.get(assetId)! : "0";
      const percent = byCoin.get(assetId) ?? "0";
      const impactUsd =
        valueUsd === null
          ? null
          : multiplyDecimals(valueUsd, multiplyDecimals(percent, "0.01"));
      return {
        assetId,
        percent,
        held: values.has(assetId),
        valueUsd,
        impactUsd,
        projectedValueUsd:
          valueUsd === null || impactUsd === null
            ? null
            : addDecimals(valueUsd, impactUsd),
      };
    });
  const complete =
    valuation.valuationStatus === "COMPLETE" &&
    coins.every((coin) => coin.projectedValueUsd !== null);
  return {
    status: complete ? ("COMPLETE" as const) : ("INCOMPLETE" as const),
    currentValueUsd: complete ? valuation.totalValueUsd : null,
    projectedValueUsd: complete
      ? sumDecimals(coins.map((coin) => coin.projectedValueUsd!))
      : null,
    impactUsd: complete
      ? sumDecimals(coins.map((coin) => coin.impactUsd!))
      : null,
    knownProjectedValueUsd: sumDecimals(
      coins.flatMap((coin) =>
        coin.projectedValueUsd === null ? [] : [coin.projectedValueUsd],
      ),
    ),
    coins,
  };
}

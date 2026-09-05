import {
  addDecimals,
  canonicalDecimal,
  compareDecimals,
  isWithinDecimalTolerance,
  multiplyDecimals,
  normalizeFiniteNumber,
  subtractDecimals,
  sumDecimals,
} from "../portfolio-transactions/decimal.ts";

export const REPORTING_TIME_ZONE = "America/Argentina/Salta";
export const REPORTING_UTC_OFFSET_MINUTES = -3 * 60;
export const MAX_PRICE_OBSERVATION_AGE_MS = 2 * 60 * 60 * 1000;
export const FRESH_PRICE_MAX_AGE_MS = 15 * 60 * 1000;
export const RECONCILIATION_TOLERANCE_USD = "0.00000001";

const DAY_MS = 24 * 60 * 60 * 1000;
const REPORTING_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ValuationStatus = "COMPLETE" | "STALE" | "INCOMPLETE";
export type PriceQuality =
  | "OBSERVED"
  | "STALE_FALLBACK"
  | "HISTORICAL_ESTIMATE"
  | "MISSING";
export type PriceMissingReason =
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "UNKNOWN_COIN"
  | "INVALID_RESPONSE"
  | "NO_ACCEPTABLE_OBSERVATION"
  | "NOT_REQUIRED_ZERO_QUANTITY";

export class PortfolioValuationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortfolioValuationError";
  }
}

function nonnegativeDecimal(value: string, field: string): string {
  const normalized = canonicalDecimal(value);
  if (compareDecimals(normalized, "0") < 0) {
    throw new PortfolioValuationError(`${field} cannot be negative.`);
  }
  return normalized;
}

function validDate(value: Date, field: string): Date {
  const copy = new Date(value.getTime());
  if (Number.isNaN(copy.getTime())) {
    throw new PortfolioValuationError(`${field} must be a valid timestamp.`);
  }
  return copy;
}

function reportingDateStartUtc(reportingDate: string): number {
  if (!REPORTING_DATE_PATTERN.test(reportingDate)) {
    throw new PortfolioValuationError(
      "Reporting date must use the YYYY-MM-DD format.",
    );
  }

  const timestamp = Date.parse(`${reportingDate}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== reportingDate
  ) {
    throw new PortfolioValuationError("Reporting date must be a real date.");
  }
  return timestamp;
}

export function reportingDateForInstant(instant: Date): string {
  const timestamp = validDate(instant, "Instant").getTime();
  return new Date(timestamp + REPORTING_UTC_OFFSET_MINUTES * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** The immutable UTC cutoff at local midnight starting the following day. */
export function cutoffAtForReportingDate(reportingDate: string): Date {
  const localNextMidnight = reportingDateStartUtc(reportingDate) + DAY_MS;
  const cutoff = new Date(
    localNextMidnight - REPORTING_UTC_OFFSET_MINUTES * 60 * 1000,
  );
  if (Number.isNaN(cutoff.getTime())) {
    throw new PortfolioValuationError("Reporting cutoff is outside range.");
  }
  return cutoff;
}

export function latestClosedReportingDate(now = new Date()): string {
  const currentLocalDate = reportingDateForInstant(now);
  return new Date(reportingDateStartUtc(currentLocalDate) - DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function isClosedReportingDate(
  reportingDate: string,
  now = new Date(),
): boolean {
  return (
    cutoffAtForReportingDate(reportingDate).getTime() <=
    validDate(now, "Now").getTime()
  );
}

export type PriceObservationInput = {
  observedAt: Date | number;
  priceUsd: string | number;
};

export type SelectedPriceObservation = {
  observedAt: Date;
  priceUsd: string;
  ageMs: number;
  inputIndex: number;
};

function observationTimestamp(value: Date | number): number {
  const timestamp =
    value instanceof Date
      ? validDate(value, "Observation timestamp").getTime()
      : value;
  if (!Number.isFinite(timestamp)) {
    throw new PortfolioValuationError(
      "Observation timestamp must be a finite epoch timestamp.",
    );
  }
  return timestamp;
}

function observationPrice(value: string | number): string {
  const normalized =
    typeof value === "number"
      ? normalizeFiniteNumber(value)
      : canonicalDecimal(value);
  if (compareDecimals(normalized, "0") <= 0) {
    throw new PortfolioValuationError(
      "Observation price must be greater than zero.",
    );
  }
  return normalized;
}

/**
 * Selects the latest point at or before the target. Equal timestamps retain
 * their first input occurrence, making the provider array order the tie-break.
 */
export function selectPriceObservation(
  observations: readonly PriceObservationInput[],
  requestedAt: Date,
  maximumAgeMs = MAX_PRICE_OBSERVATION_AGE_MS,
): SelectedPriceObservation | null {
  const targetMs = validDate(requestedAt, "Requested instant").getTime();
  if (!Number.isFinite(maximumAgeMs) || maximumAgeMs < 0) {
    throw new PortfolioValuationError(
      "Maximum observation age must be nonnegative.",
    );
  }

  let selected:
    | { timestamp: number; priceUsd: string; inputIndex: number }
    | undefined;
  observations.forEach((observation, inputIndex) => {
    const timestamp = observationTimestamp(observation.observedAt);
    const priceUsd = observationPrice(observation.priceUsd);
    if (timestamp > targetMs) return;
    if (!selected || timestamp > selected.timestamp) {
      selected = { timestamp, priceUsd, inputIndex };
    }
  });

  if (!selected || targetMs - selected.timestamp > maximumAgeMs) return null;
  return {
    observedAt: new Date(selected.timestamp),
    priceUsd: selected.priceUsd,
    ageMs: targetMs - selected.timestamp,
    inputIndex: selected.inputIndex,
  };
}

export function priceQualityForObservation(
  observation: Pick<SelectedPriceObservation, "ageMs">,
  provenance: "SCHEDULED" | "MANUAL" | "REPAIR" | "ADOPTION_BASELINE",
): Exclude<PriceQuality, "MISSING"> {
  if (provenance !== "SCHEDULED") return "HISTORICAL_ESTIMATE";
  return observation.ageMs <= FRESH_PRICE_MAX_AGE_MS
    ? "OBSERVED"
    : "STALE_FALLBACK";
}

export type LiveValuationPositionInput = {
  positionId: string;
  assetId: string;
  quantity: string;
  priceUsd: string | null;
  priceObservedAt: Date | null;
  missingReason?: PriceMissingReason | null;
};

export type LiveValuationPosition = {
  positionId: string;
  assetId: string;
  quantity: string;
  priceUsd: string | null;
  valueUsd: string | null;
  priceObservedAt: Date | null;
  priceQuality: PriceQuality;
  missingReason: PriceMissingReason | null;
};

export type LiveValuation = {
  valuationStatus: ValuationStatus;
  totalValueUsd: string | null;
  knownValueUsd: string;
  positions: LiveValuationPosition[];
};

export function calculateLiveValuation(
  inputs: readonly LiveValuationPositionInput[],
  now = new Date(),
  staleAfterMs = FRESH_PRICE_MAX_AGE_MS,
): LiveValuation {
  const nowMs = validDate(now, "Now").getTime();
  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 0) {
    throw new PortfolioValuationError("Stale age must be nonnegative.");
  }

  let incomplete = false;
  let stale = false;
  const positions = inputs.map((input): LiveValuationPosition => {
    const quantity = canonicalDecimal(input.quantity);
    if (compareDecimals(quantity, "0") < 0) {
      throw new PortfolioValuationError(
        `Position ${input.positionId} cannot have a negative quantity.`,
      );
    }
    const zeroQuantity = compareDecimals(quantity, "0") === 0;

    if (input.priceUsd == null) {
      if (!zeroQuantity && !input.missingReason) {
        throw new PortfolioValuationError(
          `Position ${input.positionId} needs an explicit missing-price reason.`,
        );
      }
      if (!zeroQuantity) incomplete = true;
      return {
        positionId: input.positionId,
        assetId: input.assetId,
        quantity,
        priceUsd: null,
        valueUsd: zeroQuantity ? "0" : null,
        priceObservedAt: null,
        priceQuality: "MISSING",
        missingReason: zeroQuantity
          ? "NOT_REQUIRED_ZERO_QUANTITY"
          : input.missingReason ?? null,
      };
    }

    if (input.priceObservedAt == null) {
      throw new PortfolioValuationError(
        `Position ${input.positionId} needs the price observation timestamp.`,
      );
    }
    const priceUsd = canonicalDecimal(input.priceUsd);
    if (compareDecimals(priceUsd, "0") <= 0) {
      throw new PortfolioValuationError(
        `Position ${input.positionId} price must be greater than zero.`,
      );
    }
    const priceObservedAt = validDate(
      input.priceObservedAt,
      "Price observation timestamp",
    );
    const ageMs = nowMs - priceObservedAt.getTime();
    if (ageMs < 0 || ageMs > MAX_PRICE_OBSERVATION_AGE_MS) {
      if (!zeroQuantity) incomplete = true;
      return {
        positionId: input.positionId,
        assetId: input.assetId,
        quantity,
        priceUsd: null,
        valueUsd: zeroQuantity ? "0" : null,
        priceObservedAt: null,
        priceQuality: "MISSING",
        missingReason: "NO_ACCEPTABLE_OBSERVATION",
      };
    }
    const priceQuality = ageMs > staleAfterMs ? "STALE_FALLBACK" : "OBSERVED";
    if (!zeroQuantity && priceQuality === "STALE_FALLBACK") stale = true;

    return {
      positionId: input.positionId,
      assetId: input.assetId,
      quantity,
      priceUsd,
      valueUsd: multiplyDecimals(quantity, priceUsd),
      priceObservedAt,
      priceQuality,
      missingReason: null,
    };
  });

  const knownValueUsd = sumDecimals(
    [...positions]
      .sort(
        (left, right) =>
          left.assetId.localeCompare(right.assetId) ||
          left.positionId.localeCompare(right.positionId),
      )
      .flatMap((position) =>
        position.valueUsd == null ? [] : [position.valueUsd],
      ),
  );
  const valuationStatus: ValuationStatus = incomplete
    ? "INCOMPLETE"
    : stale
      ? "STALE"
      : "COMPLETE";

  return {
    valuationStatus,
    totalValueUsd: incomplete ? null : knownValueUsd,
    knownValueUsd,
    positions,
  };
}

export type PriceMovementBoundary = {
  eventId: string;
  occurredAt: Date;
  quantityDelta: string;
  priceUsd: string;
};

export type PriceMovementInterval = {
  startedAt: Date;
  endedAt: Date;
  quantity: string;
  startingPriceUsd: string;
  endingPriceUsd: string;
  movementUsd: string;
};

export type PriceMovementResult = {
  endingQuantity: string;
  priceMovementUsd: string;
  intervals: PriceMovementInterval[];
};

export function calculatePriceMovement(input: {
  startedAt: Date;
  endedAt: Date;
  startingQuantity: string;
  startingPriceUsd: string;
  endingPriceUsd: string;
  boundaries: readonly PriceMovementBoundary[];
}): PriceMovementResult {
  const startedAt = validDate(input.startedAt, "Period start");
  const endedAt = validDate(input.endedAt, "Period end");
  if (startedAt.getTime() >= endedAt.getTime()) {
    throw new PortfolioValuationError("Period end must be after period start.");
  }

  let quantity = canonicalDecimal(input.startingQuantity);
  if (compareDecimals(quantity, "0") < 0) {
    throw new PortfolioValuationError("Starting quantity cannot be negative.");
  }
  let intervalPrice = canonicalDecimal(input.startingPriceUsd);
  const endingPriceUsd = canonicalDecimal(input.endingPriceUsd);
  if (
    compareDecimals(intervalPrice, "0") <= 0 ||
    compareDecimals(endingPriceUsd, "0") <= 0
  ) {
    throw new PortfolioValuationError(
      "Period prices must be greater than zero.",
    );
  }

  const boundaries = [...input.boundaries]
    .map((boundary) => ({
      ...boundary,
      occurredAt: validDate(boundary.occurredAt, "Event timestamp"),
      quantityDelta: canonicalDecimal(boundary.quantityDelta),
      priceUsd: canonicalDecimal(boundary.priceUsd),
    }))
    .sort(
      (left, right) =>
        left.occurredAt.getTime() - right.occurredAt.getTime() ||
        left.eventId.localeCompare(right.eventId),
    );

  const intervals: PriceMovementInterval[] = [];
  let intervalStart = startedAt;
  let index = 0;
  while (index < boundaries.length) {
    const timestamp = boundaries[index].occurredAt.getTime();
    if (timestamp < startedAt.getTime() || timestamp >= endedAt.getTime()) {
      throw new PortfolioValuationError(
        "Price-movement boundaries must be inside the half-open period.",
      );
    }

    const boundaryPrice = boundaries[index].priceUsd;
    if (compareDecimals(boundaryPrice, "0") <= 0) {
      throw new PortfolioValuationError(
        "Boundary price must be greater than zero.",
      );
    }
    let boundaryDelta = "0";
    while (
      index < boundaries.length &&
      boundaries[index].occurredAt.getTime() === timestamp
    ) {
      if (compareDecimals(boundaries[index].priceUsd, boundaryPrice) !== 0) {
        throw new PortfolioValuationError(
          "One asset must use one price at an event timestamp.",
        );
      }
      boundaryDelta = addDecimals(
        boundaryDelta,
        boundaries[index].quantityDelta,
      );
      index += 1;
    }

    const movementUsd = multiplyDecimals(
      quantity,
      subtractDecimals(boundaryPrice, intervalPrice),
    );
    intervals.push({
      startedAt: new Date(intervalStart),
      endedAt: new Date(timestamp),
      quantity,
      startingPriceUsd: intervalPrice,
      endingPriceUsd: boundaryPrice,
      movementUsd,
    });
    quantity = addDecimals(quantity, boundaryDelta);
    if (compareDecimals(quantity, "0") < 0) {
      throw new PortfolioValuationError(
        "An event boundary makes the asset quantity negative.",
      );
    }
    intervalStart = new Date(timestamp);
    intervalPrice = boundaryPrice;
  }

  const finalMovementUsd = multiplyDecimals(
    quantity,
    subtractDecimals(endingPriceUsd, intervalPrice),
  );
  intervals.push({
    startedAt: new Date(intervalStart),
    endedAt: new Date(endedAt),
    quantity,
    startingPriceUsd: intervalPrice,
    endingPriceUsd,
    movementUsd: finalMovementUsd,
  });

  return {
    endingQuantity: quantity,
    priceMovementUsd: sumDecimals(
      intervals.map((interval) => interval.movementUsd),
    ),
    intervals,
  };
}

export type PeriodEventInput = {
  eventId: string;
  occurredAt: Date;
  externalFlowUsd: string | null;
  feeUsd: string | null;
  movements: readonly {
    userAssetId: string;
    assetId: string;
    role: "PRINCIPAL" | "FEE";
    quantityDelta: string;
  }[];
};

export type PeriodAssetAllocation = {
  assetId: string;
  externalFlowUsd: string;
  feesUsd: string;
};

export type PeriodEventAllocationResult = {
  status: "COMPLETE" | "INCOMPLETE";
  netExternalFlowUsd: string | null;
  feesUsd: string | null;
  assets: PeriodAssetAllocation[];
  issues: string[];
};

export function allocatePeriodEvents(
  events: readonly PeriodEventInput[],
): PeriodEventAllocationResult {
  const allocations = new Map<
    string,
    { externalFlowUsd: string[]; feesUsd: string[] }
  >();
  const knownFlows: string[] = [];
  const knownFees: string[] = [];
  const issues: string[] = [];

  const allocate = (
    assetId: string,
    field: "externalFlowUsd" | "feesUsd",
    value: string,
  ) => {
    const current = allocations.get(assetId) ?? {
      externalFlowUsd: [],
      feesUsd: [],
    };
    current[field].push(value);
    allocations.set(assetId, current);
  };

  for (const event of [...events].sort(
    (left, right) =>
      validDate(left.occurredAt, "Event timestamp").getTime() -
        validDate(right.occurredAt, "Event timestamp").getTime() ||
      left.eventId.localeCompare(right.eventId),
  )) {
    for (const movement of event.movements) {
      canonicalDecimal(movement.quantityDelta);
    }

    if (event.externalFlowUsd == null) {
      issues.push(`Event ${event.eventId} has unknown external flow.`);
    } else {
      const externalFlowUsd = canonicalDecimal(event.externalFlowUsd);
      knownFlows.push(externalFlowUsd);
      if (compareDecimals(externalFlowUsd, "0") !== 0) {
        const principalAssets = [
          ...new Set(
            event.movements
              .filter((movement) => movement.role === "PRINCIPAL")
              .map((movement) => movement.assetId),
          ),
        ];
        if (principalAssets.length !== 1) {
          issues.push(
            `Event ${event.eventId} cannot allocate nonzero external flow to one asset.`,
          );
        } else {
          allocate(principalAssets[0], "externalFlowUsd", externalFlowUsd);
        }
      }
    }

    if (event.feeUsd == null) {
      issues.push(`Event ${event.eventId} has unknown fees.`);
    } else {
      const feeUsd = canonicalDecimal(event.feeUsd);
      knownFees.push(feeUsd);
      if (compareDecimals(feeUsd, "0") !== 0) {
        const feeAssets = [
          ...new Set(
            event.movements
              .filter((movement) => movement.role === "FEE")
              .map((movement) => movement.assetId),
          ),
        ];
        if (feeAssets.length !== 1) {
          issues.push(
            `Event ${event.eventId} cannot allocate nonzero fees to one asset.`,
          );
        } else {
          allocate(feeAssets[0], "feesUsd", feeUsd);
        }
      }
    }
  }

  const assets = [...allocations.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([assetId, values]) => ({
      assetId,
      externalFlowUsd: sumDecimals(values.externalFlowUsd),
      feesUsd: sumDecimals(values.feesUsd),
    }));
  const status = issues.length === 0 ? "COMPLETE" : "INCOMPLETE";
  return {
    status,
    netExternalFlowUsd: status === "COMPLETE" ? sumDecimals(knownFlows) : null,
    feesUsd: status === "COMPLETE" ? sumDecimals(knownFees) : null,
    assets,
    issues,
  };
}

export type CoinContributionInput = {
  assetId: string;
  startingValueUsd: string | null;
  endingValueUsd: string | null;
  externalFlowUsd: string | null;
  feesUsd: string | null;
  priceMovementUsd: string | null;
};

export type CoinContribution = CoinContributionInput & {
  marketMovementUsd: string | null;
  eventValuationAdjustmentUsd: string | null;
};

export type PeriodReconciliation = {
  status: "COMPLETE" | "INCOMPLETE";
  reconciliationStatus: "RECONCILED" | "OUT_OF_TOLERANCE" | "INCOMPLETE";
  startingValueUsd: string | null;
  endingValueUsd: string | null;
  netExternalFlowUsd: string | null;
  feesUsd: string | null;
  priceMovementUsd: string | null;
  eventValuationAdjustmentUsd: string | null;
  marketMovementUsd: string | null;
  reconciliationDifferenceUsd: string | null;
  contributions: CoinContribution[];
  issues: string[];
};

function sumNullableField<Field extends string>(
  rows: readonly { [Key in Field]: string | null }[],
  field: Field,
): string | null {
  const values = rows.map((row) => row[field]);
  return values.some((value) => value == null)
    ? null
    : sumDecimals(values as string[]);
}

export function calculatePeriodReconciliation(input: {
  startingValueUsd: string | null;
  endingValueUsd: string | null;
  netExternalFlowUsd: string | null;
  feesUsd: string | null;
  coins: readonly CoinContributionInput[];
  toleranceUsd?: string;
}): PeriodReconciliation {
  const toleranceUsd = canonicalDecimal(
    input.toleranceUsd ?? RECONCILIATION_TOLERANCE_USD,
  );
  if (compareDecimals(toleranceUsd, "0") < 0) {
    throw new PortfolioValuationError(
      "Reconciliation tolerance cannot be negative.",
    );
  }

  const grouped = new Map<string, CoinContributionInput[]>();
  for (const coin of input.coins) {
    const rows = grouped.get(coin.assetId) ?? [];
    rows.push(coin);
    grouped.set(coin.assetId, rows);
  }

  const contributions: CoinContribution[] = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([assetId, rows]) => {
      const normalizedRows = rows.map((row) => ({
        startingValueUsd:
          row.startingValueUsd == null
            ? null
            : nonnegativeDecimal(
                row.startingValueUsd,
                `${assetId} starting value`,
              ),
        endingValueUsd:
          row.endingValueUsd == null
            ? null
            : nonnegativeDecimal(row.endingValueUsd, `${assetId} ending value`),
        externalFlowUsd:
          row.externalFlowUsd == null
            ? null
            : canonicalDecimal(row.externalFlowUsd),
        feesUsd: row.feesUsd == null ? null : canonicalDecimal(row.feesUsd),
        priceMovementUsd:
          row.priceMovementUsd == null
            ? null
            : canonicalDecimal(row.priceMovementUsd),
      }));
      const startingValueUsd = sumNullableField(
        normalizedRows,
        "startingValueUsd",
      );
      const endingValueUsd = sumNullableField(normalizedRows, "endingValueUsd");
      const externalFlowUsd = sumNullableField(
        normalizedRows,
        "externalFlowUsd",
      );
      const feesUsd = sumNullableField(normalizedRows, "feesUsd");
      const priceMovementUsd = sumNullableField(
        normalizedRows,
        "priceMovementUsd",
      );
      const complete =
        startingValueUsd != null &&
        endingValueUsd != null &&
        externalFlowUsd != null &&
        feesUsd != null &&
        priceMovementUsd != null;
      const marketMovementUsd = complete
        ? canonicalDecimal(
            addDecimals(
              subtractDecimals(
                subtractDecimals(endingValueUsd, startingValueUsd),
                externalFlowUsd,
              ),
              feesUsd,
            ),
          )
        : null;
      const eventValuationAdjustmentUsd =
        marketMovementUsd == null || priceMovementUsd == null
          ? null
          : canonicalDecimal(
              subtractDecimals(marketMovementUsd, priceMovementUsd),
            );
      return {
        assetId,
        startingValueUsd,
        endingValueUsd,
        externalFlowUsd,
        feesUsd,
        priceMovementUsd,
        marketMovementUsd,
        eventValuationAdjustmentUsd,
      };
    });

  const startingValueUsd =
    input.startingValueUsd == null
      ? null
      : nonnegativeDecimal(input.startingValueUsd, "Portfolio starting value");
  const endingValueUsd =
    input.endingValueUsd == null
      ? null
      : nonnegativeDecimal(input.endingValueUsd, "Portfolio ending value");
  const netExternalFlowUsd =
    input.netExternalFlowUsd == null
      ? null
      : canonicalDecimal(input.netExternalFlowUsd);
  const feesUsd =
    input.feesUsd == null ? null : canonicalDecimal(input.feesUsd);
  const headerComplete =
    startingValueUsd != null &&
    endingValueUsd != null &&
    netExternalFlowUsd != null &&
    feesUsd != null;
  const marketMovementUsd = headerComplete
    ? canonicalDecimal(
        addDecimals(
          subtractDecimals(
            subtractDecimals(endingValueUsd, startingValueUsd),
            netExternalFlowUsd,
          ),
          feesUsd,
        ),
      )
    : null;

  const issues: string[] = [];
  if (!headerComplete)
    issues.push("Portfolio reconciliation inputs are incomplete.");
  if (
    contributions.some(
      (coin) =>
        coin.marketMovementUsd == null ||
        coin.eventValuationAdjustmentUsd == null,
    )
  ) {
    issues.push("One or more coin contributions are incomplete.");
  }

  const contributionFields = {
    startingValueUsd: sumNullableField(contributions, "startingValueUsd"),
    endingValueUsd: sumNullableField(contributions, "endingValueUsd"),
    externalFlowUsd: sumNullableField(contributions, "externalFlowUsd"),
    feesUsd: sumNullableField(contributions, "feesUsd"),
    priceMovementUsd: sumNullableField(contributions, "priceMovementUsd"),
    marketMovementUsd: sumNullableField(contributions, "marketMovementUsd"),
    eventValuationAdjustmentUsd: sumNullableField(
      contributions,
      "eventValuationAdjustmentUsd",
    ),
  };

  const compare = (
    label: string,
    header: string | null,
    contribution: string | null,
  ) => {
    if (header == null || contribution == null) return;
    if (!isWithinDecimalTolerance(header, contribution, toleranceUsd)) {
      issues.push(`${label} does not reconcile to coin contributions.`);
    }
  };
  compare(
    "Starting value",
    startingValueUsd,
    contributionFields.startingValueUsd,
  );
  compare("Ending value", endingValueUsd, contributionFields.endingValueUsd);
  compare(
    "External flow",
    netExternalFlowUsd,
    contributionFields.externalFlowUsd,
  );
  compare("Fees", feesUsd, contributionFields.feesUsd);
  compare(
    "Market movement",
    marketMovementUsd,
    contributionFields.marketMovementUsd,
  );

  const reconstruction =
    startingValueUsd == null ||
    netExternalFlowUsd == null ||
    marketMovementUsd == null ||
    feesUsd == null
      ? null
      : subtractDecimals(
          addDecimals(
            addDecimals(startingValueUsd, netExternalFlowUsd),
            marketMovementUsd,
          ),
          feesUsd,
        );
  const reconciliationDifferenceUsd =
    endingValueUsd == null || reconstruction == null
      ? null
      : subtractDecimals(endingValueUsd, reconstruction);
  if (
    reconciliationDifferenceUsd != null &&
    !isWithinDecimalTolerance(reconciliationDifferenceUsd, "0", toleranceUsd)
  ) {
    issues.push("Portfolio equation is outside reconciliation tolerance.");
  }

  const incomplete =
    !headerComplete ||
    contributions.some((coin) => coin.marketMovementUsd == null);
  const reconciliationStatus = incomplete
    ? "INCOMPLETE"
    : issues.length > 0
      ? "OUT_OF_TOLERANCE"
      : "RECONCILED";

  return {
    status: reconciliationStatus === "RECONCILED" ? "COMPLETE" : "INCOMPLETE",
    reconciliationStatus,
    startingValueUsd,
    endingValueUsd,
    netExternalFlowUsd,
    feesUsd,
    priceMovementUsd: contributionFields.priceMovementUsd,
    eventValuationAdjustmentUsd: contributionFields.eventValuationAdjustmentUsd,
    marketMovementUsd,
    reconciliationDifferenceUsd,
    contributions,
    issues,
  };
}

import {
  compareDecimals,
  sumDecimals,
} from "../portfolio-transactions/decimal.ts";
import {
  allocatePeriodEvents,
  calculateLiveValuation,
  calculatePeriodReconciliation,
  calculatePriceMovement,
  cutoffAtForReportingDate,
  priceQualityForObservation,
  reportingDateForInstant,
  type PeriodEventInput,
  type PriceMissingReason,
  type PriceQuality,
} from "./domain.ts";

export type SnapshotKind = "DAILY" | "ADOPTION_BASELINE";
export type SnapshotProvenance =
  | "SCHEDULED"
  | "MANUAL"
  | "REPAIR"
  | "ADOPTION_BASELINE";

export type SnapshotTarget = {
  kind: SnapshotKind;
  reportingDate: string;
  cutoffAt: Date;
};

export type SnapshotPositionState = {
  userAssetId: string;
  assetId: string;
  quantity: string;
};

export type PreviousSnapshotPosition = SnapshotPositionState & {
  priceUsd: string | null;
  valueUsd: string | null;
};

export type PreviousSnapshotState = {
  revisionId?: string;
  kind: SnapshotKind;
  cutoffAt: Date;
  totalValueUsd: string | null;
  positions: PreviousSnapshotPosition[];
};

export type SnapshotEventState = PeriodEventInput & {
  movements: readonly {
    userAssetId: string;
    assetId: string;
    role: "PRINCIPAL" | "FEE";
    quantityDelta: string;
  }[];
};

export type SnapshotCaptureState = {
  userId: string;
  ledgerAdoptedAt: Date;
  ledgerRevision: bigint;
  activeRevisionNumber: number | null;
  activeLedgerRevision: bigint | null;
  activeLifecycleStatus: "COMPLETE" | "INCOMPLETE" | "STALE" | null;
  positions: SnapshotPositionState[];
  previous: PreviousSnapshotState | null;
  events: SnapshotEventState[];
};

export type SnapshotPriceResolution =
  | { observation: { observedAt: Date; priceUsd: string } }
  | {
      observation: null;
      missingReason: Exclude<PriceMissingReason, "NOT_REQUIRED_ZERO_QUANTITY">;
    };

export type SnapshotPositionDraft = SnapshotPositionState & {
  priceUsd: string | null;
  valueUsd: string | null;
  priceObservedAt: Date | null;
  priceQuality: PriceQuality;
  missingReason: Exclude<
    PriceMissingReason,
    "NOT_REQUIRED_ZERO_QUANTITY"
  > | null;
};

export type SnapshotContributionDraft = {
  assetId: string;
  externalFlowUsd: string | null;
  feesUsd: string | null;
  priceMovementUsd: string | null;
  eventValuationAdjustmentUsd: string | null;
  marketMovementUsd: string | null;
};

export type SnapshotDraft = {
  expectedPreviousRevisionId?: string | null;
  userId: string;
  target: SnapshotTarget;
  ledgerRevision: bigint;
  expectedActiveRevisionNumber: number | null;
  provenance: SnapshotProvenance;
  actor: string;
  reason: string | null;
  priceRetrievedAt: Date;
  lifecycleStatus: "COMPLETE" | "INCOMPLETE";
  valuationStatus: "COMPLETE" | "INCOMPLETE";
  reconciliationStatus: "COMPLETE" | "INCOMPLETE" | "NOT_APPLICABLE";
  totalValueUsd: string | null;
  knownValueUsd: string;
  netExternalFlowUsd: string | null;
  feesUsd: string | null;
  priceMovementUsd: string | null;
  eventValuationAdjustmentUsd: string | null;
  marketMovementUsd: string | null;
  positions: SnapshotPositionDraft[];
  contributions: SnapshotContributionDraft[];
};

export type PublishedSnapshot = {
  snapshotId: string;
  revision: number;
  created: boolean;
  lifecycleStatus: "COMPLETE" | "INCOMPLETE" | "STALE";
};

export interface PortfolioSnapshotStore {
  readCaptureState(
    userId: string,
    target: SnapshotTarget,
  ): Promise<SnapshotCaptureState>;
  publish(draft: SnapshotDraft): Promise<PublishedSnapshot>;
}

export interface SnapshotPriceSource {
  resolve(assetId: string, requestedAt: Date): Promise<SnapshotPriceResolution>;
}

export class SnapshotCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotCaptureError";
  }
}

export class SnapshotCaptureConflict extends SnapshotCaptureError {}

function dateCopy(value: Date) {
  const copy = new Date(value.getTime());
  if (Number.isNaN(copy.getTime())) {
    throw new SnapshotCaptureError("Snapshot timestamps must be valid.");
  }
  return copy;
}

export function dailySnapshotTarget(reportingDate: string): SnapshotTarget {
  return {
    kind: "DAILY",
    reportingDate,
    cutoffAt: cutoffAtForReportingDate(reportingDate),
  };
}

export function adoptionSnapshotTarget(adoptedAt: Date): SnapshotTarget {
  const cutoffAt = dateCopy(adoptedAt);
  return {
    kind: "ADOPTION_BASELINE",
    reportingDate: reportingDateForInstant(cutoffAt),
    cutoffAt,
  };
}

function targetKey(assetId: string, instant: Date) {
  return `${assetId}\u0000${instant.toISOString()}`;
}

function uniquePriceTargets(
  state: SnapshotCaptureState,
  target: SnapshotTarget,
) {
  const targets = new Map<string, { assetId: string; requestedAt: Date }>();
  const add = (assetId: string, requestedAt: Date) => {
    targets.set(targetKey(assetId, requestedAt), { assetId, requestedAt });
  };

  state.positions.forEach((position) => add(position.assetId, target.cutoffAt));
  if (target.kind === "DAILY" && state.previous) {
    state.events.forEach((event) =>
      event.movements.forEach((movement) =>
        add(movement.assetId, event.occurredAt),
      ),
    );
  }
  return [...targets.values()].sort(
    (left, right) =>
      left.assetId.localeCompare(right.assetId) ||
      left.requestedAt.getTime() - right.requestedAt.getTime(),
  );
}

async function resolvePrices(
  source: SnapshotPriceSource,
  targets: readonly { assetId: string; requestedAt: Date }[],
) {
  const entries = await Promise.all(
    targets.map(
      async (target) =>
        [
          targetKey(target.assetId, target.requestedAt),
          await source.resolve(target.assetId, target.requestedAt),
        ] as const,
    ),
  );
  return new Map(entries);
}

function sumKnown(values: readonly (string | null)[]): string | null {
  return values.some((value) => value == null)
    ? null
    : sumDecimals(values as string[]);
}

function valuesByAsset(
  positions: readonly { assetId: string; valueUsd: string | null }[],
) {
  const grouped = new Map<string, (string | null)[]>();
  positions.forEach((position) => {
    const values = grouped.get(position.assetId) ?? [];
    values.push(position.valueUsd);
    grouped.set(position.assetId, values);
  });
  return new Map(
    [...grouped.entries()].map(([assetId, values]) => [
      assetId,
      sumKnown(values),
    ]),
  );
}

function quantitiesByPosition<T extends SnapshotPositionState>(
  positions: readonly T[],
) {
  return new Map(positions.map((position) => [position.userAssetId, position]));
}

function priceMovementByAsset(
  state: SnapshotCaptureState,
  target: SnapshotTarget,
  endingPositions: readonly SnapshotPositionDraft[],
  prices: ReadonlyMap<string, SnapshotPriceResolution>,
): Map<string, string | null> {
  if (!state.previous) return new Map();

  const starting = quantitiesByPosition(state.previous.positions);
  const ending = quantitiesByPosition(endingPositions);
  const movements = new Map<
    string,
    Array<{
      eventId: string;
      occurredAt: Date;
      assetId: string;
      quantityDelta: string;
    }>
  >();
  state.events.forEach((event) =>
    event.movements.forEach((movement) => {
      const rows = movements.get(movement.userAssetId) ?? [];
      rows.push({
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        assetId: movement.assetId,
        quantityDelta: movement.quantityDelta,
      });
      movements.set(movement.userAssetId, rows);
    }),
  );

  const positionIds = new Set([
    ...starting.keys(),
    ...ending.keys(),
    ...movements.keys(),
  ]);
  const assetParts = new Map<string, Array<string | null>>();
  [...positionIds].sort().forEach((positionId) => {
    const start = starting.get(positionId);
    const end = ending.get(positionId);
    const boundaries = (movements.get(positionId) ?? []).sort(
      (left, right) =>
        left.occurredAt.getTime() - right.occurredAt.getTime() ||
        left.eventId.localeCompare(right.eventId),
    );
    const assetId = start?.assetId ?? end?.assetId ?? boundaries[0]?.assetId;
    if (!assetId) return;
    const parts = assetParts.get(assetId) ?? [];

    const boundaryRows = boundaries.map((boundary) => {
      const resolved = prices.get(targetKey(assetId, boundary.occurredAt));
      return resolved?.observation
        ? {
            eventId: boundary.eventId,
            occurredAt: boundary.occurredAt,
            quantityDelta: boundary.quantityDelta,
            priceUsd: resolved.observation.priceUsd,
          }
        : null;
    });
    const startingQuantity = start?.quantity ?? "0";
    const endingQuantity = end?.quantity ?? "0";
    const firstBoundaryPrice = boundaryRows.find((row) => row)?.priceUsd;
    const lastBoundaryPrice = [...boundaryRows]
      .reverse()
      .find((row) => row)?.priceUsd;
    const startingPrice =
      start && compareDecimals(startingQuantity, "0") > 0
        ? state.previous?.positions.find(
            (position) => position.userAssetId === positionId,
          )?.priceUsd
        : firstBoundaryPrice ??
          (end && compareDecimals(endingQuantity, "0") > 0
            ? end.priceUsd
            : "0");
    const endingPrice =
      end && compareDecimals(endingQuantity, "0") > 0
        ? end.priceUsd
        : lastBoundaryPrice ?? startingPrice;

    if (
      startingPrice == null ||
      endingPrice == null ||
      boundaryRows.some((row) => row == null)
    ) {
      parts.push(null);
    } else {
      const result = calculatePriceMovement({
        startedAt: state.previous.cutoffAt,
        endedAt: target.cutoffAt,
        startingQuantity,
        startingPriceUsd: startingPrice,
        endingPriceUsd: endingPrice,
        boundaries: boundaryRows.filter((row) => row != null),
      });
      parts.push(
        compareDecimals(result.endingQuantity, endingQuantity) === 0
          ? result.priceMovementUsd
          : null,
      );
    }
    assetParts.set(assetId, parts);
  });

  return new Map(
    [...assetParts.entries()].map(([assetId, parts]) => [
      assetId,
      sumKnown(parts),
    ]),
  );
}

export type CaptureSnapshotInput = {
  userId: string;
  target: SnapshotTarget;
  provenance: SnapshotProvenance;
  actor: string;
  reason?: string | null;
  apply?: boolean;
  now?: Date;
};

export type CaptureSnapshotResult = {
  draft: SnapshotDraft;
  published: PublishedSnapshot | null;
};

export async function capturePortfolioSnapshot(
  store: PortfolioSnapshotStore,
  priceSource: SnapshotPriceSource,
  input: CaptureSnapshotInput,
): Promise<CaptureSnapshotResult> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await captureOnce(store, priceSource, input);
    } catch (error) {
      if (!(error instanceof SnapshotCaptureConflict) || attempt >= 2)
        throw error;
    }
  }
}

async function captureOnce(
  store: PortfolioSnapshotStore,
  priceSource: SnapshotPriceSource,
  input: CaptureSnapshotInput,
): Promise<CaptureSnapshotResult> {
  if (!input.userId.trim()) throw new SnapshotCaptureError("User is required.");
  if (!input.actor.trim() || input.actor.length > 160) {
    throw new SnapshotCaptureError("Actor must contain 1 to 160 characters.");
  }
  const reason = input.reason?.trim() || null;
  if (
    (input.provenance === "REPAIR" && (!reason || reason.length > 500)) ||
    (input.provenance !== "REPAIR" && reason)
  ) {
    throw new SnapshotCaptureError(
      "Only repairs require a reason containing 1 to 500 characters.",
    );
  }
  if (
    (input.target.kind === "ADOPTION_BASELINE" &&
      !["ADOPTION_BASELINE", "REPAIR"].includes(input.provenance)) ||
    (input.target.kind === "DAILY" && input.provenance === "ADOPTION_BASELINE")
  ) {
    throw new SnapshotCaptureError(
      "Snapshot target and revision provenance do not match.",
    );
  }

  const now = dateCopy(input.now ?? new Date());
  const state = await store.readCaptureState(input.userId, input.target);
  if (
    input.target.kind === "DAILY" &&
    (input.target.cutoffAt.getTime() !==
      cutoffAtForReportingDate(input.target.reportingDate).getTime() ||
      input.target.cutoffAt.getTime() === state.ledgerAdoptedAt.getTime())
  ) {
    throw new SnapshotCaptureError(
      "Daily snapshots require the closed Salta day after adoption.",
    );
  }
  if (input.target.cutoffAt.getTime() > now.getTime()) {
    throw new SnapshotCaptureError(
      "Cannot capture a snapshot before its cutoff.",
    );
  }
  if (input.target.cutoffAt.getTime() < state.ledgerAdoptedAt.getTime()) {
    throw new SnapshotCaptureError(
      "Cannot create pre-adoption valuation history.",
    );
  }
  if (
    input.target.kind === "ADOPTION_BASELINE" &&
    input.target.cutoffAt.getTime() !== state.ledgerAdoptedAt.getTime()
  ) {
    throw new SnapshotCaptureError(
      "The adoption baseline must use the ledger adoption instant.",
    );
  }

  const priceRetrievedAt = new Date(now);
  const prices = await resolvePrices(
    priceSource,
    uniquePriceTargets(state, input.target),
  );
  const live = calculateLiveValuation(
    state.positions.map((position) => {
      const resolved = prices.get(
        targetKey(position.assetId, input.target.cutoffAt),
      );
      return {
        positionId: position.userAssetId,
        assetId: position.assetId,
        quantity: position.quantity,
        priceUsd: resolved?.observation?.priceUsd ?? null,
        priceObservedAt: resolved?.observation?.observedAt ?? null,
        missingReason:
          resolved && "missingReason" in resolved
            ? resolved.missingReason
            : resolved == null
              ? "NO_ACCEPTABLE_OBSERVATION"
              : null,
      };
    }),
    input.target.cutoffAt,
  );
  const positions: SnapshotPositionDraft[] = live.positions.map((position) => ({
    userAssetId: position.positionId,
    assetId: position.assetId,
    quantity: position.quantity,
    priceUsd: position.priceUsd,
    valueUsd: position.valueUsd,
    priceObservedAt: position.priceObservedAt,
    priceQuality:
      position.priceObservedAt && position.priceUsd
        ? priceQualityForObservation(
            {
              ageMs:
                input.target.cutoffAt.getTime() -
                position.priceObservedAt.getTime(),
            },
            input.provenance,
          )
        : "MISSING",
    missingReason:
      position.missingReason === "NOT_REQUIRED_ZERO_QUANTITY"
        ? null
        : position.missingReason,
  }));

  let reconciliationStatus: SnapshotDraft["reconciliationStatus"] =
    "NOT_APPLICABLE";
  let netExternalFlowUsd: string | null = null;
  let feesUsd: string | null = null;
  let priceMovementUsd: string | null = null;
  let eventValuationAdjustmentUsd: string | null = null;
  let marketMovementUsd: string | null = null;
  let contributions: SnapshotContributionDraft[] = [];

  if (input.target.kind === "DAILY") {
    if (!state.previous) {
      reconciliationStatus = "INCOMPLETE";
    } else {
      const allocations = allocatePeriodEvents(state.events);
      const allocationByAsset = new Map(
        allocations.assets.map((row) => [row.assetId, row]),
      );
      const startingValues = valuesByAsset(state.previous.positions);
      const endingValues = valuesByAsset(positions);
      const priceMovements = priceMovementByAsset(
        state,
        input.target,
        positions,
        prices,
      );
      const assetIds = new Set([
        ...startingValues.keys(),
        ...endingValues.keys(),
        ...allocationByAsset.keys(),
        ...priceMovements.keys(),
      ]);
      const reconciliation = calculatePeriodReconciliation({
        startingValueUsd: state.previous.totalValueUsd,
        endingValueUsd: live.totalValueUsd,
        netExternalFlowUsd: allocations.netExternalFlowUsd,
        feesUsd: allocations.feesUsd,
        coins: [...assetIds].sort().map((assetId) => ({
          assetId,
          startingValueUsd: startingValues.has(assetId)
            ? startingValues.get(assetId) ?? null
            : "0",
          endingValueUsd: endingValues.has(assetId)
            ? endingValues.get(assetId) ?? null
            : "0",
          externalFlowUsd:
            allocations.status === "COMPLETE"
              ? allocationByAsset.get(assetId)?.externalFlowUsd ?? "0"
              : null,
          feesUsd:
            allocations.status === "COMPLETE"
              ? allocationByAsset.get(assetId)?.feesUsd ?? "0"
              : null,
          priceMovementUsd: priceMovements.get(assetId) ?? null,
        })),
      });
      reconciliationStatus =
        reconciliation.status === "COMPLETE" ? "COMPLETE" : "INCOMPLETE";
      netExternalFlowUsd = reconciliation.netExternalFlowUsd;
      feesUsd = reconciliation.feesUsd;
      priceMovementUsd = reconciliation.priceMovementUsd;
      eventValuationAdjustmentUsd = reconciliation.eventValuationAdjustmentUsd;
      marketMovementUsd = reconciliation.marketMovementUsd;
      contributions = reconciliation.contributions.map((coin) => ({
        assetId: coin.assetId,
        externalFlowUsd: coin.externalFlowUsd,
        feesUsd: coin.feesUsd,
        priceMovementUsd: coin.priceMovementUsd,
        eventValuationAdjustmentUsd: coin.eventValuationAdjustmentUsd,
        marketMovementUsd: coin.marketMovementUsd,
      }));
    }
  }

  const valuationStatus =
    live.valuationStatus === "INCOMPLETE" ? "INCOMPLETE" : "COMPLETE";
  const lifecycleStatus =
    valuationStatus === "COMPLETE" && reconciliationStatus !== "INCOMPLETE"
      ? "COMPLETE"
      : "INCOMPLETE";
  const draft: SnapshotDraft = {
    expectedPreviousRevisionId: state.previous?.revisionId ?? null,
    userId: state.userId,
    target: {
      ...input.target,
      cutoffAt: dateCopy(input.target.cutoffAt),
    },
    ledgerRevision: state.ledgerRevision,
    expectedActiveRevisionNumber: state.activeRevisionNumber,
    provenance: input.provenance,
    actor: input.actor.trim(),
    reason,
    priceRetrievedAt,
    lifecycleStatus,
    valuationStatus,
    reconciliationStatus,
    totalValueUsd: live.totalValueUsd,
    knownValueUsd: live.knownValueUsd,
    netExternalFlowUsd,
    feesUsd,
    priceMovementUsd,
    eventValuationAdjustmentUsd,
    marketMovementUsd,
    positions,
    contributions,
  };

  return {
    draft,
    published: input.apply === false ? null : await store.publish(draft),
  };
}

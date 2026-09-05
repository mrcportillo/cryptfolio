import { Prisma, type PrismaClient } from "@prisma/client";
import { databaseDecimalToPlain } from "../portfolio-transactions/decimal.ts";
import { calculateLivePortfolioWorth } from "./live.ts";
import { reportingDateForInstant, type LiveValuation } from "./domain.ts";
import { createPostgresSnapshotStore } from "./postgres.ts";
import {
  buildValuationDraft,
  type PreviousSnapshotState,
  type SnapshotDraft,
  type SnapshotPriceSource,
} from "./service.ts";
import {
  combineReportPeriods,
  shiftDate,
  weekWindow,
  type ReportCalculation,
} from "./report-domain.ts";
import type { createValuationMarketLoader } from "./market-cache.ts";

type MarketLoader = ReturnType<typeof createValuationMarketLoader>;
export type PortfolioReport = {
  startedAt: Date | null;
  endedAt: Date;
  calculation: ReportCalculation | null;
  quality: string[];
  message: string | null;
  valuation?: LiveValuation;
  draft?: SnapshotDraft;
};

export async function readDailyReport(
  client: PrismaClient,
  userId: string,
  now: Date,
  markets: MarketLoader,
  historical: SnapshotPriceSource,
): Promise<PortfolioReport> {
  const store = createPostgresSnapshotStore(client);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const target = {
      kind: "DAILY" as const,
      reportingDate: reportingDateForInstant(now),
      cutoffAt: now,
    };
    const state = await store.readCaptureState(userId, target);
    const prices = await markets(
      [...new Set(state.positions.map((position) => position.assetId))],
      now,
    );
    const valuation = calculateLivePortfolioWorth(
      state.positions.map((position) => ({
        assetId: position.assetId,
        amount: position.quantity,
      })),
      prices.markets,
      { requestedAt: now, providerFailed: prices.providerFailed },
    );
    if (prices.usedFallback && valuation.valuationStatus === "COMPLETE")
      valuation.valuationStatus = "STALE";
    const liveByCoin = new Map(
      valuation.positions.map((position) => [position.assetId, position]),
    );
    const draft = await buildValuationDraft(
      state,
      {
        resolve: (assetId, at) => {
          if (at.getTime() !== now.getTime())
            return historical.resolve(assetId, at);
          const quote = liveByCoin.get(assetId);
          return Promise.resolve(
            quote?.priceUsd != null && quote.priceObservedAt
              ? {
                  observation: {
                    priceUsd: quote.priceUsd,
                    observedAt: quote.priceObservedAt,
                  },
                }
              : {
                  observation: null,
                  missingReason: "NO_ACCEPTABLE_OBSERVATION",
                },
          );
        },
      },
      {
        userId,
        target,
        provenance: "MANUAL",
        actor: "live-report",
        now,
        apply: false,
      },
    );
    const freshState = await store.readCaptureState(userId, target);
    if (
      freshState.ledgerRevision !== state.ledgerRevision ||
      freshState.previous?.revisionId !== state.previous?.revisionId
    )
      continue;
    const quality: string[] = [];
    if (valuation.valuationStatus === "STALE")
      quality.push("Stale current prices");
    if (state.previous?.estimated || state.events.length)
      quality.push("Includes estimated reference prices");
    if (state.previous?.provenance === "REPAIR")
      quality.push("Repaired starting snapshot");
    const calculation = state.previous
      ? combineReportPeriods(state.previous, [draft])
      : null;
    return {
      startedAt: state.previous?.cutoffAt ?? null,
      endedAt: now,
      calculation,
      quality,
      valuation,
      draft,
      message: !state.previous
        ? "History begins once the adoption baseline has been valued. Your current holdings are still shown."
        : calculation?.status !== "COMPLETE"
          ? "Performance is incomplete because a required price, transaction value, or fee value is unavailable."
          : null,
    };
  }
  return {
    startedAt: null,
    endedAt: now,
    calculation: null,
    quality: [],
    message:
      "The portfolio changed while this report was loading. Refresh to calculate against the latest records.",
  };
}

type SnapshotRow = Prisma.PortfolioSnapshotGetPayload<{
  include: {
    activeRevision: { include: { positions: true; contributions: true } };
  };
}>;
const plain = (value: Prisma.Decimal | null) =>
  value === null ? null : databaseDecimalToPlain(value);

function previousFromRow(row: SnapshotRow): PreviousSnapshotState | null {
  const revision = row.activeRevision;
  if (!revision || row.lifecycleStatus !== "COMPLETE") return null;
  return {
    kind: row.kind,
    cutoffAt: revision.cutoffAt,
    revisionId: revision.id,
    totalValueUsd: plain(revision.totalValueUsd),
    positions: revision.positions.map((position) => ({
      userAssetId: position.userAssetId,
      assetId: position.assetId,
      quantity: plain(position.quantity)!,
      priceUsd: plain(position.priceUsd),
      valueUsd: plain(position.valueUsd),
    })),
  };
}

function periodFromRow(row: SnapshotRow): SnapshotDraft | null {
  const revision = row.activeRevision;
  const previous = previousFromRow(row);
  if (!revision || !previous) return null;
  return {
    userId: row.userId,
    target: {
      kind: row.kind,
      reportingDate: row.reportingDate.toISOString().slice(0, 10),
      cutoffAt: revision.cutoffAt,
    },
    ledgerRevision: revision.ledgerRevision,
    expectedActiveRevisionNumber: row.activeRevisionNumber,
    provenance: revision.provenance,
    actor: revision.actor,
    reason: revision.reason,
    priceRetrievedAt: revision.priceRetrievedAt,
    lifecycleStatus: "COMPLETE",
    valuationStatus: revision.valuationStatus,
    reconciliationStatus: revision.reconciliationStatus,
    totalValueUsd: plain(revision.totalValueUsd),
    knownValueUsd: plain(revision.knownValueUsd)!,
    netExternalFlowUsd: plain(revision.netExternalFlowUsd),
    feesUsd: plain(revision.feesUsd),
    priceMovementUsd: plain(revision.priceMovementUsd),
    eventValuationAdjustmentUsd: plain(revision.eventValuationAdjustmentUsd),
    marketMovementUsd: plain(revision.marketMovementUsd),
    positions: revision.positions.map((position) => ({
      ...position,
      quantity: plain(position.quantity)!,
      priceUsd: plain(position.priceUsd),
      valueUsd: plain(position.valueUsd),
    })),
    contributions: revision.contributions.map((coin) => ({
      assetId: coin.assetId,
      externalFlowUsd: plain(coin.externalFlowUsd),
      feesUsd: plain(coin.feesUsd),
      priceMovementUsd: plain(coin.priceMovementUsd),
      eventValuationAdjustmentUsd: plain(coin.eventValuationAdjustmentUsd),
      marketMovementUsd: plain(coin.marketMovementUsd),
    })),
  };
}

export async function readWeeklyReport(
  client: PrismaClient,
  userId: string,
  selection: string | undefined,
  now: Date,
  markets: MarketLoader,
  historical: SnapshotPriceSource,
) {
  const data = await client.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { ledgerAdoptedAt: true, ledgerRevision: true },
      });
      if (!user?.ledgerAdoptedAt) return null;
      const window = weekWindow(selection, now, user.ledgerAdoptedAt);
      const rows = await tx.portfolioSnapshot.findMany({
        where: {
          userId,
          OR: [
            { kind: "ADOPTION_BASELINE" },
            {
              reportingDate: {
                gte: new Date(shiftDate(window.firstDate, -1)),
                lt: new Date(window.nextDate),
              },
            },
          ],
        },
        include: {
          activeRevision: { include: { positions: true, contributions: true } },
        },
        orderBy: { reportingDate: "asc" },
      });
      return { user, window, rows };
    },
    { isolationLevel: "RepeatableRead" },
  );
  if (!data) return null;
  const { user, window, rows } = data;
  const startRow = rows.find(
    (row) =>
      row.activeRevision?.cutoffAt.getTime() ===
        window.effectiveStart.getTime() &&
      (window.effectiveStart.getTime() === user.ledgerAdoptedAt!.getTime()
        ? row.kind === "ADOPTION_BASELINE"
        : row.kind === "DAILY"),
  );
  const start = startRow && previousFromRow(startRow);
  const missing: string[] = [];
  const periods: SnapshotDraft[] = [];
  for (
    let date = reportingDateForInstant(window.effectiveStart);
    date < reportingDateForInstant(window.endsAt);
    date = shiftDate(date, 1)
  ) {
    const row = rows.find(
      (candidate) =>
        candidate.kind === "DAILY" &&
        candidate.reportingDate.toISOString().slice(0, 10) === date,
    );
    const period = row && periodFromRow(row);
    if (period) periods.push(period);
    else missing.push(date);
  }
  const live = window.current
    ? await readDailyReport(client, userId, now, markets, historical)
    : null;
  if (live?.draft) {
    const expectedStart =
      periods.at(-1)?.target.cutoffAt ?? window.effectiveStart;
    const expectedRevisionId = periods.length
      ? rows.find(
          (row) =>
            row.kind === "DAILY" &&
            row.activeRevision?.cutoffAt.getTime() === expectedStart.getTime(),
        )?.activeRevision?.id
      : start?.revisionId;
    if (
      live.startedAt?.getTime() === expectedStart.getTime() &&
      live.draft.ledgerRevision === user.ledgerRevision &&
      live.draft.expectedPreviousRevisionId === expectedRevisionId
    )
      periods.push(live.draft);
    else missing.push("current period");
  } else if (window.current) missing.push("current period");
  const quality = [...(live?.quality ?? [])];
  if (window.limited) quality.push("Limited to the adoption boundary");
  if (rows.some((row) => row.activeRevision?.provenance === "REPAIR"))
    quality.push("Includes repaired snapshots");
  if (
    rows.some((row) =>
      row.activeRevision?.positions.some(
        (position) => position.priceQuality !== "OBSERVED",
      ),
    )
  )
    quality.push("Includes estimated or stale historical prices");
  const report: PortfolioReport = {
    startedAt: window.effectiveStart,
    endedAt: window.endsAt,
    calculation:
      start && missing.length === 0
        ? combineReportPeriods(start, periods)
        : null,
    quality: [...new Set(quality)],
    message: !start
      ? "The starting snapshot is missing, stale, or incomplete. History is unavailable until it is repaired."
      : missing.length
        ? `History is incomplete for ${missing.join(", ")}. These dates need snapshot repair before the week can be reconciled.`
        : live?.message ?? null,
  };
  return { window, report, adoptedAt: user.ledgerAdoptedAt! };
}

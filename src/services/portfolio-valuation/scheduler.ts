import type { PrismaClient } from "@prisma/client";
import { latestClosedReportingDate } from "./domain.ts";
import {
  createPostgresSnapshotStore,
  listScheduledDailyTargets,
  listScheduledSnapshotUsers,
  listStaleSnapshotTargets,
  type ScheduledSnapshotUser,
} from "./postgres.ts";
import {
  adoptionSnapshotTarget,
  capturePortfolioSnapshot,
  type CaptureSnapshotInput,
  type CaptureSnapshotResult,
  type SnapshotPriceSource,
  type SnapshotTarget,
} from "./service.ts";
import type { ScheduledValuationSummary } from "./cron-handler.ts";

export type PortfolioSnapshotSchedulerDependencies = {
  listUsers(): Promise<ScheduledSnapshotUser[]>;
  listStaleTargets(userId: string): Promise<SnapshotTarget[]>;
  listDailyTargets(
    userId: string,
    latestReportingDate: string,
  ): Promise<SnapshotTarget[]>;
  capture(input: CaptureSnapshotInput): Promise<CaptureSnapshotResult>;
};

function orderTargets(targets: readonly SnapshotTarget[]) {
  return [...targets].sort(
    (left, right) =>
      left.cutoffAt.getTime() - right.cutoffAt.getTime() ||
      left.kind.localeCompare(right.kind),
  );
}

export async function runPortfolioSnapshotScheduler(
  dependencies: PortfolioSnapshotSchedulerDependencies,
  now: Date,
): Promise<ScheduledValuationSummary> {
  const deadline = Date.now() + 240_000;
  const latestReportingDate = latestClosedReportingDate(now);
  const summary: ScheduledValuationSummary = {
    usersProcessed: 0,
    snapshotsCreated: 0,
    snapshotsIncomplete: 0,
    snapshotsSkipped: 0,
  };

  const record = (result: CaptureSnapshotResult) => {
    if (
      (result.published?.lifecycleStatus ?? result.draft.lifecycleStatus) ===
      "INCOMPLETE"
    ) {
      summary.snapshotsIncomplete += 1;
    }
    if (result.published?.created) summary.snapshotsCreated += 1;
    else summary.snapshotsSkipped += 1;
  };

  for (const user of await dependencies.listUsers()) {
    if (Date.now() >= deadline) break;
    summary.usersProcessed += 1;
    const staleTargets = orderTargets(
      await dependencies.listStaleTargets(user.userId),
    );
    const staleBaseline = staleTargets.find(
      (target) => target.kind === "ADOPTION_BASELINE",
    );
    if (staleBaseline) {
      record(
        await dependencies.capture({
          userId: user.userId,
          target: staleBaseline,
          provenance: "REPAIR",
          actor: "portfolio-snapshot-cron",
          reason: "Automatic recalculation after a ledger correction.",
          apply: true,
          now,
        }),
      );
    } else if (!user.hasCompleteAdoptionBaseline) {
      record(
        await dependencies.capture({
          userId: user.userId,
          target: adoptionSnapshotTarget(user.ledgerAdoptedAt),
          provenance: "ADOPTION_BASELINE",
          actor: "portfolio-snapshot-cron",
          apply: true,
          now,
        }),
      );
    }

    // A repaired baseline can invalidate later snapshots. Read the repair
    // queue again and interleave gaps chronologically with existing work.
    const repairs = (await dependencies.listStaleTargets(user.userId)).filter(
      (target) => target.kind === "DAILY",
    );
    const missing = await dependencies.listDailyTargets(
      user.userId,
      latestReportingDate,
    );
    const repairDates = new Set(repairs.map((target) => target.reportingDate));
    const pending = orderTargets([
      ...repairs,
      ...missing.filter((target) => !repairDates.has(target.reportingDate)),
    ]);
    // Bound catch-up work while always including the latest pending day.
    const targets =
      pending.length > 7
        ? [...pending.slice(0, 6), pending[pending.length - 1]]
        : pending;
    for (const target of targets) {
      if (Date.now() >= deadline) break;
      if (target.cutoffAt.getTime() <= user.ledgerAdoptedAt.getTime()) {
        summary.snapshotsSkipped += 1;
        continue;
      }
      record(
        await dependencies.capture({
          userId: user.userId,
          target,
          provenance: repairDates.has(target.reportingDate)
            ? "REPAIR"
            : target.reportingDate === latestReportingDate
              ? "SCHEDULED"
              : "MANUAL",
          reason: repairDates.has(target.reportingDate)
            ? "Automatic retry of stale or incomplete valuation."
            : undefined,
          actor: "portfolio-snapshot-cron",
          apply: true,
          now,
        }),
      );
    }
  }
  return summary;
}

export function createPostgresPortfolioSnapshotScheduler(
  client: PrismaClient,
  priceSource: SnapshotPriceSource,
) {
  const store = createPostgresSnapshotStore(client);
  return (now: Date) =>
    runPortfolioSnapshotScheduler(
      {
        listUsers: () => listScheduledSnapshotUsers(client),
        listStaleTargets: (userId) => listStaleSnapshotTargets(client, userId),
        listDailyTargets: (userId, reportingDate) =>
          listScheduledDailyTargets(client, userId, reportingDate),
        capture: (input) => capturePortfolioSnapshot(store, priceSource, input),
      },
      now,
    );
}

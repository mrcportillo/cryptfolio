import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { databaseDecimalToPlain } from "../portfolio-transactions/decimal.ts";
import {
  SnapshotCaptureError,
  SnapshotCaptureConflict,
  dailySnapshotTarget,
  type PortfolioSnapshotStore,
  type PreviousSnapshotState,
  type PublishedSnapshot,
  type SnapshotCaptureState,
  type SnapshotDraft,
  type SnapshotEventState,
  type SnapshotPositionState,
  type SnapshotTarget,
} from "./service.ts";
import { reportingDateForInstant } from "./domain.ts";

const USER_LOCK_NAMESPACE = "cryptfolio:opening-balances";
const MAX_SERIALIZABLE_ATTEMPTS = 3;

function decimal(value: Prisma.Decimal | null): string | null {
  return value == null ? null : databaseDecimalToPlain(value);
}

function reportingDateValue(reportingDate: string) {
  return new Date(`${reportingDate}T00:00:00.000Z`);
}

function isSerializationFailure(error: unknown) {
  const prismaError = error as { code?: string; meta?: { code?: string } };
  return (
    prismaError.code === "P2034" ||
    (prismaError.code === "P2010" &&
      ["40001", "40P01"].includes(prismaError.meta?.code ?? ""))
  );
}

async function runSerializable<T>(
  client: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: "Serializable",
        maxWait: 10_000,
        timeout: 30_000,
      });
    } catch (error) {
      if (
        !isSerializationFailure(error) ||
        attempt === MAX_SERIALIZABLE_ATTEMPTS
      ) {
        throw error;
      }
    }
  }
  throw new Error("Serializable snapshot retry loop exhausted.");
}

async function lockOwner(
  transaction: Prisma.TransactionClient,
  userId: string,
) {
  await transaction.$queryRawUnsafe(
    `SELECT 1::integer AS "locked"
     FROM pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
    `${USER_LOCK_NAMESPACE}:${userId}`,
  );
  const users = await transaction.$queryRaw<
    Array<{
      id: string;
      ledgerAdoptedAt: Date | null;
      ledgerRevision: bigint;
    }>
  >`
    UPDATE "User"
    SET "ledgerAdoptedAt" = "ledgerAdoptedAt"
    WHERE "id" = ${userId}
    RETURNING "id", "ledgerAdoptedAt", "ledgerRevision"
  `;
  return users[0] ?? null;
}

async function readPositions(
  transaction: Prisma.TransactionClient,
  userId: string,
  target: SnapshotTarget,
): Promise<SnapshotPositionState[]> {
  const occurrenceBoundary =
    target.kind === "ADOPTION_BASELINE"
      ? { lte: target.cutoffAt }
      : { lt: target.cutoffAt };
  const quantities = await transaction.assetMovement.groupBy({
    by: ["userAssetId"],
    where: {
      userId,
      portfolioEvent: { occurredAt: occurrenceBoundary },
    },
    _sum: { quantityDelta: true },
  });
  const positive = quantities.filter(
    (row) => row._sum.quantityDelta?.greaterThan(0) ?? false,
  );
  if (positive.length === 0) return [];

  const assets = await transaction.userAsset.findMany({
    where: { userId, id: { in: positive.map((row) => row.userAssetId) } },
    select: { id: true, assetId: true },
  });
  const byId = new Map(assets.map((asset) => [asset.id, asset.assetId]));
  return positive
    .flatMap((row) => {
      const assetId = byId.get(row.userAssetId);
      const quantity = row._sum.quantityDelta;
      return assetId && quantity
        ? [
            {
              userAssetId: row.userAssetId,
              assetId,
              quantity: databaseDecimalToPlain(quantity),
            },
          ]
        : [];
    })
    .sort(
      (left, right) =>
        left.assetId.localeCompare(right.assetId) ||
        left.userAssetId.localeCompare(right.userAssetId),
    );
}

async function readPrevious(
  transaction: Prisma.TransactionClient,
  userId: string,
  target: SnapshotTarget,
): Promise<PreviousSnapshotState | null> {
  const previous = await transaction.portfolioSnapshot.findFirst({
    where: {
      userId,
      lifecycleStatus: "COMPLETE",
      activeRevisionNumber: { not: null },
      activeRevision: { cutoffAt: { lt: target.cutoffAt } },
    },
    include: {
      activeRevision: {
        include: { positions: true },
      },
    },
    orderBy: [{ activeRevision: { cutoffAt: "desc" } }, { id: "desc" }],
  });
  if (!previous?.activeRevision) return null;
  return {
    revisionId: previous.activeRevision.id,
    provenance: previous.activeRevision.provenance,
    estimated: previous.activeRevision.positions.some(
      (position) => position.priceQuality !== "OBSERVED",
    ),
    kind: previous.kind,
    cutoffAt: previous.activeRevision.cutoffAt,
    totalValueUsd: decimal(previous.activeRevision.totalValueUsd),
    positions: previous.activeRevision.positions
      .map((position) => ({
        userAssetId: position.userAssetId,
        assetId: position.assetId,
        quantity: databaseDecimalToPlain(position.quantity),
        priceUsd: decimal(position.priceUsd),
        valueUsd: decimal(position.valueUsd),
      }))
      .sort(
        (left, right) =>
          left.assetId.localeCompare(right.assetId) ||
          left.userAssetId.localeCompare(right.userAssetId),
      ),
  };
}

async function readEvents(
  transaction: Prisma.TransactionClient,
  userId: string,
  previous: PreviousSnapshotState | null,
  target: SnapshotTarget,
): Promise<SnapshotEventState[]> {
  if (!previous || target.kind !== "DAILY") return [];
  const events = await transaction.portfolioEvent.findMany({
    where: {
      userId,
      occurredAt: {
        ...(previous.kind === "ADOPTION_BASELINE"
          ? { gt: previous.cutoffAt }
          : { gte: previous.cutoffAt }),
        lt: target.cutoffAt,
      },
    },
    include: {
      movements: {
        include: { userAsset: { select: { assetId: true } } },
      },
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
  return events.map((event) => ({
    eventId: event.id,
    occurredAt: event.occurredAt,
    externalFlowUsd: decimal(event.externalFlowUsd),
    feeUsd: decimal(event.feeUsd),
    movements: event.movements.map((movement) => ({
      userAssetId: movement.userAssetId,
      assetId: movement.userAsset.assetId,
      role: movement.role,
      quantityDelta: databaseDecimalToPlain(movement.quantityDelta),
    })),
  }));
}

async function readCaptureState(
  client: PrismaClient,
  userId: string,
  target: SnapshotTarget,
): Promise<SnapshotCaptureState> {
  return client.$transaction(
    async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          ledgerAdoptedAt: true,
          ledgerRevision: true,
        },
      });
      if (!user?.ledgerAdoptedAt) {
        throw new SnapshotCaptureError(
          "Portfolio valuation requires an adopted transaction ledger.",
        );
      }
      const active = await transaction.portfolioSnapshot.findUnique({
        where: {
          userId_kind_reportingDate: {
            userId,
            kind: target.kind,
            reportingDate: reportingDateValue(target.reportingDate),
          },
        },
        include: { activeRevision: true },
      });
      const [positions, previous] = await Promise.all([
        readPositions(transaction, userId, target),
        target.kind === "DAILY"
          ? readPrevious(transaction, userId, target)
          : Promise.resolve(null),
      ]);
      const events = await readEvents(transaction, userId, previous, target);
      return {
        userId: user.id,
        ledgerAdoptedAt: user.ledgerAdoptedAt,
        ledgerRevision: user.ledgerRevision,
        activeRevisionNumber: active?.activeRevisionNumber ?? null,
        activeLedgerRevision: active?.activeRevision?.ledgerRevision ?? null,
        activeLifecycleStatus: active?.lifecycleStatus ?? null,
        positions,
        previous,
        events,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

async function publish(
  client: PrismaClient,
  draft: SnapshotDraft,
): Promise<PublishedSnapshot> {
  return runSerializable(client, async (transaction) => {
    const owner = await lockOwner(transaction, draft.userId);
    if (!owner?.ledgerAdoptedAt) {
      throw new SnapshotCaptureError(
        "Portfolio valuation requires an adopted transaction ledger.",
      );
    }
    if (owner.ledgerRevision !== draft.ledgerRevision) {
      throw new SnapshotCaptureConflict(
        "The ledger changed while prices were being captured; retry safely.",
      );
    }

    const reportingDate = reportingDateValue(draft.target.reportingDate);
    let header = await transaction.portfolioSnapshot.findUnique({
      where: {
        userId_kind_reportingDate: {
          userId: draft.userId,
          kind: draft.target.kind,
          reportingDate,
        },
      },
      include: { activeRevision: true },
    });
    if (!header) {
      header = await transaction.portfolioSnapshot.create({
        data: {
          id: randomUUID(),
          userId: draft.userId,
          kind: draft.target.kind,
          reportingDate,
          lifecycleStatus: "INCOMPLETE",
        },
        include: { activeRevision: true },
      });
    }

    if (
      header.activeRevisionNumber !== draft.expectedActiveRevisionNumber ||
      (draft.provenance !== "REPAIR" && header.lifecycleStatus === "COMPLETE")
    ) {
      return {
        snapshotId: header.id,
        revision: header.activeRevisionNumber ?? 0,
        created: false,
        lifecycleStatus: header.lifecycleStatus,
      };
    }

    if (draft.target.kind === "DAILY") {
      const previous = await readPrevious(
        transaction,
        draft.userId,
        draft.target,
      );
      if (draft.expectedPreviousRevisionId !== (previous?.revisionId ?? null)) {
        throw new SnapshotCaptureConflict(
          "The preceding valuation changed; recapture against its current revision.",
        );
      }
    }

    const revision = (header.activeRevisionNumber ?? 0) + 1;
    const revisionId = randomUUID();
    await transaction.portfolioSnapshotRevision.create({
      data: {
        id: revisionId,
        snapshotId: header.id,
        userId: draft.userId,
        revision,
        cutoffAt: draft.target.cutoffAt,
        ledgerRevision: draft.ledgerRevision,
        provenance: draft.provenance,
        valuationStatus: draft.valuationStatus,
        reconciliationStatus: draft.reconciliationStatus,
        totalValueUsd: draft.totalValueUsd,
        knownValueUsd: draft.knownValueUsd,
        netExternalFlowUsd: draft.netExternalFlowUsd,
        feesUsd: draft.feesUsd,
        priceMovementUsd: draft.priceMovementUsd,
        eventValuationAdjustmentUsd: draft.eventValuationAdjustmentUsd,
        marketMovementUsd: draft.marketMovementUsd,
        actor: draft.actor,
        reason: draft.reason,
        priceRetrievedAt: draft.priceRetrievedAt,
      },
    });
    if (draft.positions.length > 0) {
      await transaction.positionSnapshot.createMany({
        data: draft.positions.map((position) => ({
          id: randomUUID(),
          snapshotRevisionId: revisionId,
          userId: draft.userId,
          userAssetId: position.userAssetId,
          assetId: position.assetId,
          quantity: position.quantity,
          priceUsd: position.priceUsd,
          valueUsd: position.valueUsd,
          priceObservedAt: position.priceObservedAt,
          priceQuality: position.priceQuality,
          missingReason: position.missingReason,
        })),
      });
    }
    if (draft.contributions.length > 0) {
      await transaction.coinSnapshotContribution.createMany({
        data: draft.contributions.map((contribution) => ({
          id: randomUUID(),
          snapshotRevisionId: revisionId,
          userId: draft.userId,
          assetId: contribution.assetId,
          externalFlowUsd: contribution.externalFlowUsd,
          feesUsd: contribution.feesUsd,
          priceMovementUsd: contribution.priceMovementUsd,
          eventValuationAdjustmentUsd: contribution.eventValuationAdjustmentUsd,
          marketMovementUsd: contribution.marketMovementUsd,
        })),
      });
    }
    header = await transaction.portfolioSnapshot.update({
      where: { id_userId: { id: header.id, userId: draft.userId } },
      data: {
        activeRevisionNumber: revision,
        lifecycleStatus: draft.lifecycleStatus,
        staleAt: null,
      },
      include: { activeRevision: true },
    });

    await transaction.$executeRawUnsafe(`
      SET CONSTRAINTS
        "PortfolioSnapshot_id_userId_activeRevisionNumber_fkey",
        "PortfolioSnapshotRevision_activation_check",
        "PortfolioSnapshot_active_revision_integrity_check"
      IMMEDIATE
    `);
    const staleCount = await transaction.portfolioSnapshot.count({
      where: { userId: draft.userId, lifecycleStatus: "STALE" },
    });
    if (staleCount === 0) {
      await transaction.snapshotRecalculationRequest.deleteMany({
        where: { userId: draft.userId },
      });
    }
    return {
      snapshotId: header.id,
      revision,
      created: true,
      lifecycleStatus: draft.lifecycleStatus,
    };
  });
}

export function createPostgresSnapshotStore(
  client: PrismaClient,
): PortfolioSnapshotStore {
  return {
    readCaptureState: (userId, target) =>
      readCaptureState(client, userId, target),
    publish: (draft) => publish(client, draft),
  };
}

export type ScheduledSnapshotUser = {
  userId: string;
  ledgerAdoptedAt: Date;
  hasCompleteAdoptionBaseline: boolean;
};

export async function listScheduledSnapshotUsers(
  client: PrismaClient,
): Promise<ScheduledSnapshotUser[]> {
  const users = await client.user.findMany({
    where: { ledgerAdoptedAt: { not: null } },
    select: {
      id: true,
      ledgerAdoptedAt: true,
      portfolioSnapshots: {
        where: {
          kind: "ADOPTION_BASELINE",
          lifecycleStatus: "COMPLETE",
        },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { id: "asc" },
  });
  return users.flatMap((user) =>
    user.ledgerAdoptedAt
      ? [
          {
            userId: user.id,
            ledgerAdoptedAt: user.ledgerAdoptedAt,
            hasCompleteAdoptionBaseline: user.portfolioSnapshots.length > 0,
          },
        ]
      : [],
  );
}

export async function listStaleSnapshotTargets(
  client: PrismaClient,
  userId: string,
): Promise<SnapshotTarget[]> {
  const rows = await client.portfolioSnapshot.findMany({
    where: { userId, lifecycleStatus: { in: ["STALE", "INCOMPLETE"] } },
    include: { activeRevision: { select: { cutoffAt: true } } },
    orderBy: [{ reportingDate: "asc" }, { kind: "asc" }],
  });
  return rows.flatMap((row) =>
    row.activeRevision
      ? [
          {
            kind: row.kind,
            reportingDate: row.reportingDate.toISOString().slice(0, 10),
            cutoffAt: row.activeRevision.cutoffAt,
          },
        ]
      : [],
  );
}

export async function listScheduledDailyTargets(
  client: PrismaClient,
  userId: string,
  latestReportingDate: string,
): Promise<SnapshotTarget[]> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { ledgerAdoptedAt: true },
  });
  if (!user?.ledgerAdoptedAt) return [];
  const existing = await client.portfolioSnapshot.findMany({
    where: { userId, kind: "DAILY" },
    select: { reportingDate: true },
  });
  const dates = new Set(
    existing.map((row) => row.reportingDate.toISOString().slice(0, 10)),
  );
  const results: SnapshotTarget[] = [];
  let timestamp = Date.parse(
    `${reportingDateForInstant(user.ledgerAdoptedAt)}T00:00:00.000Z`,
  );
  const finalTimestamp = Date.parse(`${latestReportingDate}T00:00:00.000Z`);
  while (timestamp <= finalTimestamp) {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    if (!dates.has(date)) results.push(dailySnapshotTarget(date));
    timestamp += 86_400_000;
  }
  return results;
}

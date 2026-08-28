import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  LedgerEventDraft,
  LedgerMovementDraft,
  StoredLedgerEvent,
  TimelineMovement,
} from "./domain.ts";
import { databaseDecimalToPlain } from "./decimal.ts";
import type {
  LedgerPosition,
  LedgerUser,
  PortfolioTransactionStore,
} from "./service.ts";

const MAX_SERIALIZABLE_ATTEMPTS = 3;
const USER_LOCK_NAMESPACE = "cryptfolio:opening-balances";

function isSerializationFailure(error: unknown) {
  const prismaError = error as { code?: string; meta?: { code?: string } };
  return (
    prismaError.code === "P2034" ||
    (prismaError.code === "P2010" &&
      ["40001", "40P01"].includes(prismaError.meta?.code ?? ""))
  );
}

type EventWithMovements = Prisma.PortfolioEventGetPayload<{
  include: { movements: true };
}>;

function decimal(value: { toFixed(): string } | null): string | null {
  return value == null ? null : databaseDecimalToPlain(value);
}

function toStoredEvent(event: EventWithMovements): StoredLedgerEvent {
  return {
    id: event.id,
    userId: event.userId,
    kind: event.kind,
    occurredAt: event.occurredAt,
    actualValueUsd: decimal(event.actualValueUsd),
    externalFlowUsd: decimal(event.externalFlowUsd),
    feeUsd: decimal(event.feeUsd),
    note: event.note,
    idempotencyKey: event.idempotencyKey,
    reversalOfEventId: event.reversalOfEventId,
    replacementForEventId: event.replacementForEventId,
    movements: event.movements.map(
      (movement): LedgerMovementDraft => ({
        userAssetId: movement.userAssetId,
        role: movement.role,
        quantityDelta: databaseDecimalToPlain(movement.quantityDelta),
        unitPriceUsd: decimal(movement.unitPriceUsd),
        priceEstimated: movement.priceEstimated,
      }),
    ),
    createdAt: event.createdAt,
  };
}

export function createPostgresTransactionStore(
  client: PrismaClient,
): PortfolioTransactionStore<Prisma.TransactionClient> {
  return {
    async runSerializable(operation) {
      for (
        let attempt = 1;
        attempt <= MAX_SERIALIZABLE_ATTEMPTS;
        attempt += 1
      ) {
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
      throw new Error("Serializable transaction retry loop exhausted.");
    },

    async lockUser(transaction, userId): Promise<LedgerUser | null> {
      await transaction.$queryRawUnsafe(
        `SELECT 1::integer AS "locked"
         FROM pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
        `${USER_LOCK_NAMESPACE}:${userId}`,
      );
      const users = await transaction.$queryRaw<Array<LedgerUser>>`
        UPDATE "User"
        SET "ledgerAdoptedAt" = "ledgerAdoptedAt"
        WHERE "id" = ${userId}
        RETURNING "id", "ledgerAdoptedAt"
      `;
      return users[0] ?? null;
    },

    findOwnedPositions(transaction, userId, ids): Promise<LedgerPosition[]> {
      return transaction.userAsset.findMany({
        where: { userId, id: { in: ids } },
        select: {
          id: true,
          userId: true,
          assetId: true,
          assetName: true,
          ledgerInitialAssetName: true,
          archivedAt: true,
        },
      });
    },

    createPosition(transaction, { userId, seed, archivedAt }) {
      return transaction.userAsset.create({
        data: {
          id: seed.id,
          userId,
          assetId: seed.assetId,
          assetName: seed.assetName,
          ledgerInitialAssetName: seed.assetName,
          amount: 0,
          archivedAt,
        },
        select: {
          id: true,
          userId: true,
          assetId: true,
          assetName: true,
          ledgerInitialAssetName: true,
          archivedAt: true,
        },
      });
    },

    async findOwnedEvent(transaction, userId, eventId) {
      const event = await transaction.portfolioEvent.findFirst({
        where: { id: eventId, userId },
        include: { movements: true },
      });
      return event ? toStoredEvent(event) : null;
    },

    async findOwnedEventByKey(transaction, userId, idempotencyKey) {
      const event = await transaction.portfolioEvent.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        include: { movements: true },
      });
      return event ? toStoredEvent(event) : null;
    },

    async findReversalFor(transaction, userId, eventId) {
      const event = await transaction.portfolioEvent.findUnique({
        where: {
          reversalOfEventId_userId: {
            reversalOfEventId: eventId,
            userId,
          },
        },
        include: { movements: true },
      });
      return event ? toStoredEvent(event) : null;
    },

    async createEvent(transaction, { userId, idempotencyKey, event }) {
      const created = await transaction.portfolioEvent.create({
        data: {
          id: randomUUID(),
          userId,
          kind: event.kind,
          occurredAt: event.occurredAt,
          actualValueUsd: event.actualValueUsd,
          externalFlowUsd: event.externalFlowUsd,
          feeUsd: event.feeUsd,
          note: event.note,
          idempotencyKey,
          reversalOfEventId: event.reversalOfEventId,
          replacementForEventId: event.replacementForEventId,
          movements: {
            create: event.movements.map((movement) => ({
              id: randomUUID(),
              userAssetId: movement.userAssetId,
              role: movement.role,
              quantityDelta: movement.quantityDelta,
              unitPriceUsd: movement.unitPriceUsd,
              priceEstimated: movement.priceEstimated,
            })),
          },
        },
        include: { movements: true },
      });
      return toStoredEvent(created);
    },

    async getTimeline(transaction, userId, positionIds) {
      const rows = await transaction.assetMovement.findMany({
        where: { userId, userAssetId: { in: positionIds } },
        select: {
          portfolioEventId: true,
          userAssetId: true,
          quantityDelta: true,
          portfolioEvent: { select: { occurredAt: true } },
        },
        orderBy: [
          { portfolioEvent: { occurredAt: "asc" } },
          { portfolioEventId: "asc" },
        ],
      });
      return rows.map(
        (row): TimelineMovement => ({
          eventId: row.portfolioEventId,
          userAssetId: row.userAssetId,
          occurredAt: row.portfolioEvent.occurredAt,
          quantityDelta: databaseDecimalToPlain(row.quantityDelta),
        }),
      );
    },

    async setArchivedAt(transaction, userId, positionId, archivedAt) {
      await transaction.userAsset.update({
        where: { id_userId: { id: positionId, userId } },
        data: { archivedAt },
      });
    },

    async flushLedgerConstraints(transaction) {
      await transaction.$executeRawUnsafe(`
        SET CONSTRAINTS
          "PortfolioEvent_exactly_one_opening_movement_check",
          "AssetMovement_exactly_one_opening_movement_check",
          "PortfolioEvent_manual_semantics_check",
          "AssetMovement_manual_semantics_check",
          "AssetMovement_nonnegative_timeline_check"
        IMMEDIATE
      `);
    },
  };
}

import { Prisma, type PrismaClient } from "@prisma/client";
import { LedgerValidationError, type StoredLedgerEvent } from "./domain.ts";
import { databaseDecimalToPlain } from "./decimal.ts";
import { readLedgerAdoption } from "./adoption.ts";

type TransactionQueryClient = Pick<PrismaClient, "portfolioEvent">;
const MAX_PRISMA_SKIP = 2_147_483_647;

export type TransactionPositionCatalogItem = {
  id: string;
  assetId: string;
  assetName: string;
  balance: string;
  archivedAt: Date | null;
  canSpend: boolean;
};

export type TransactionPositionCatalog = {
  ledgerAdopted: boolean;
  positions: TransactionPositionCatalogItem[];
};

type EventWithMovements = Prisma.PortfolioEventGetPayload<{
  include: {
    movements: true;
    reversedBy: { select: { id: true } };
    replacedBy: { select: { id: true } };
  };
}>;

export type TransactionEventReadModel = StoredLedgerEvent & {
  reversedByEventId: string | null;
  replacedByEventId: string | null;
};

const eventRelations = {
  movements: true,
  reversedBy: { select: { id: true } },
  replacedBy: { select: { id: true } },
} as const;

function toEvent(event: EventWithMovements): TransactionEventReadModel {
  return {
    id: event.id,
    userId: event.userId,
    kind: event.kind,
    occurredAt: event.occurredAt,
    actualValueUsd: event.actualValueUsd
      ? databaseDecimalToPlain(event.actualValueUsd)
      : null,
    externalFlowUsd: event.externalFlowUsd
      ? databaseDecimalToPlain(event.externalFlowUsd)
      : null,
    feeUsd: event.feeUsd ? databaseDecimalToPlain(event.feeUsd) : null,
    note: event.note,
    idempotencyKey: event.idempotencyKey,
    reversalOfEventId: event.reversalOfEventId,
    replacementForEventId: event.replacementForEventId,
    reversedByEventId: event.reversedBy?.id ?? null,
    replacedByEventId: event.replacedBy?.id ?? null,
    movements: event.movements.map((movement) => ({
      userAssetId: movement.userAssetId,
      role: movement.role,
      quantityDelta: databaseDecimalToPlain(movement.quantityDelta),
      unitPriceUsd: movement.unitPriceUsd
        ? databaseDecimalToPlain(movement.unitPriceUsd)
        : null,
      priceEstimated: movement.priceEstimated,
    })),
    createdAt: event.createdAt,
  };
}

export async function findOwnedPortfolioEvent(
  client: TransactionQueryClient,
  userId: string,
  eventId: string,
): Promise<TransactionEventReadModel | null> {
  const event = await client.portfolioEvent.findFirst({
    where: { id: eventId, userId },
    include: eventRelations,
  });
  return event ? toEvent(event) : null;
}

export async function listOwnedPortfolioEvents(
  client: TransactionQueryClient,
  userId: string,
  options: { page: number; pageSize: number },
): Promise<{ events: TransactionEventReadModel[]; hasMore: boolean }> {
  if (
    !Number.isSafeInteger(options.page) ||
    options.page < 1 ||
    !Number.isSafeInteger(options.pageSize) ||
    options.pageSize < 1 ||
    options.pageSize > 100
  ) {
    throw new LedgerValidationError(
      "Choose a valid page and a page size between 1 and 100.",
      "INVALID_INPUT",
    );
  }
  const skip = (options.page - 1) * options.pageSize;
  if (!Number.isSafeInteger(skip) || skip > MAX_PRISMA_SKIP) {
    throw new LedgerValidationError(
      "That transaction page is outside the supported range.",
      "INVALID_INPUT",
    );
  }
  const events = await client.portfolioEvent.findMany({
    where: { userId },
    include: eventRelations,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    skip,
    take: options.pageSize + 1,
  });
  return {
    events: events.slice(0, options.pageSize).map(toEvent),
    hasMore: events.length > options.pageSize,
  };
}

export async function listOwnedTransactionPositions(
  client: PrismaClient,
  userId: string,
): Promise<TransactionPositionCatalog> {
  return client.$transaction(
    async (transaction) => {
      if (!(await readLedgerAdoption(transaction, userId))) {
        return { ledgerAdopted: false, positions: [] };
      }

      const [positions, sums] = await Promise.all([
        transaction.userAsset.findMany({
          where: { userId },
          select: {
            id: true,
            assetId: true,
            assetName: true,
            archivedAt: true,
          },
          orderBy: [{ assetId: "asc" }, { assetName: "asc" }, { id: "asc" }],
        }),
        transaction.assetMovement.groupBy({
          by: ["userAssetId"],
          where: { userId },
          _sum: { quantityDelta: true },
        }),
      ]);
      const balances = new Map(
        sums.map((row) => [
          row.userAssetId,
          row._sum.quantityDelta ?? new Prisma.Decimal(0),
        ]),
      );

      return {
        ledgerAdopted: true,
        positions: positions.map((position) => {
          const balance = balances.get(position.id) ?? new Prisma.Decimal(0);
          return {
            ...position,
            balance: databaseDecimalToPlain(balance),
            canSpend: balance.greaterThan(0) && position.archivedAt === null,
          };
        }),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

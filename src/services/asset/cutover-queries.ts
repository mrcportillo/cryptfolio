import { Prisma, type PrismaClient, type UserAsset } from "@prisma/client";
import {
  addDecimals,
  databaseDecimalToPlain,
} from "../portfolio-transactions/decimal.ts";

export type AssetReadModel = Omit<UserAsset, "amount"> & { amount: string };

export type AssetSummaryReadModel = Pick<
  AssetReadModel,
  "id" | "assetId" | "assetName" | "amount" | "date"
>;

export type AssetHistoryPoint = {
  id: string;
  userAssetId: string;
  amount: string;
  date: Date;
};

export type PortfolioHomeReadModel = {
  assetsPage: {
    assets: AssetSummaryReadModel[];
    total: number;
    ledgerAdopted: boolean;
  };
  coinIds: string[];
  holdings: Array<{ assetId: string; amount: string }>;
  ledgerAdoptedAt: Date | null;
};

type PositionQuantity = {
  position: UserAsset;
  quantity: Prisma.Decimal;
};

function legacyAmountToPlain(amount: number): string {
  return databaseDecimalToPlain(new Prisma.Decimal(amount.toString()));
}

async function readConsistently<T>(
  client: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(operation, { isolationLevel: "RepeatableRead" });
}

async function ledgerAdoptedAt(
  transaction: Prisma.TransactionClient,
  userId: string,
) {
  const user = await transaction.user.findUnique({
    where: { id: userId },
    select: { ledgerAdoptedAt: true },
  });
  return user?.ledgerAdoptedAt ?? null;
}

async function derivedPositions(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<PositionQuantity[]> {
  const sums = await transaction.assetMovement.groupBy({
    by: ["userAssetId"],
    where: { userId },
    _sum: { quantityDelta: true },
  });
  const positive = sums.filter(
    (row) => row._sum.quantityDelta?.greaterThan(0) ?? false,
  );
  if (positive.length === 0) return [];

  const positions = await transaction.userAsset.findMany({
    where: {
      userId,
      id: { in: positive.map(({ userAssetId }) => userAssetId) },
    },
  });
  const byId = new Map(positions.map((position) => [position.id, position]));
  return positive.flatMap((row) => {
    const position = byId.get(row.userAssetId);
    const quantity = row._sum.quantityDelta;
    return position && quantity ? [{ position, quantity }] : [];
  });
}

async function latestActivityByPosition(
  transaction: Prisma.TransactionClient,
  userId: string,
  userAssetIds: string[],
): Promise<Map<string, Date>> {
  if (userAssetIds.length === 0) return new Map();

  const events = await transaction.portfolioEvent.findMany({
    where: {
      userId,
      movements: {
        some: { userId, userAssetId: { in: userAssetIds } },
      },
    },
    select: {
      id: true,
      occurredAt: true,
      movements: {
        where: { userId, userAssetId: { in: userAssetIds } },
        select: { userAssetId: true },
      },
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
  });

  const latest = new Map<string, Date>();
  for (const event of events) {
    for (const movement of event.movements) {
      if (!latest.has(movement.userAssetId)) {
        latest.set(movement.userAssetId, event.occurredAt);
      }
    }
  }
  return latest;
}

export async function findOwnedAssetForRead(
  client: PrismaClient,
  userId: string,
  id: string,
): Promise<AssetReadModel | null> {
  return readConsistently(client, async (transaction) => {
    const [adoptedAt, position] = await Promise.all([
      ledgerAdoptedAt(transaction, userId),
      transaction.userAsset.findFirst({ where: { id, userId } }),
    ]);
    if (!position) return null;
    if (!adoptedAt) {
      return { ...position, amount: legacyAmountToPlain(position.amount) };
    }

    const balance = await transaction.assetMovement.aggregate({
      where: { userId, userAssetId: id },
      _sum: { quantityDelta: true },
    });
    const latestActivity = await latestActivityByPosition(transaction, userId, [
      id,
    ]);
    return {
      ...position,
      amount: balance._sum.quantityDelta
        ? databaseDecimalToPlain(balance._sum.quantityDelta)
        : "0",
      date: latestActivity.get(id) ?? position.date,
    };
  });
}

export async function readPortfolioHome(
  client: PrismaClient,
  userId: string,
  options: { page: number; pageSize: number; assetId?: string },
): Promise<PortfolioHomeReadModel> {
  return readConsistently(client, async (transaction) => {
    const adoptedAt = await ledgerAdoptedAt(transaction, userId);
    const where = {
      userId,
      ...(options.assetId ? { assetId: options.assetId } : {}),
    };

    if (!adoptedAt) {
      const [assets, total, coinRows, holdingRows] = await Promise.all([
        transaction.userAsset.findMany({
          where,
          select: {
            id: true,
            assetId: true,
            assetName: true,
            amount: true,
            date: true,
          },
          orderBy: { date: "desc" },
          take: options.pageSize,
          skip: (options.page - 1) * options.pageSize,
        }),
        transaction.userAsset.count({ where }),
        transaction.userAsset.findMany({
          where: { userId },
          distinct: ["assetId"],
          select: { assetId: true },
        }),
        transaction.userAsset.groupBy({
          by: ["assetId"],
          where: { userId },
          _sum: { amount: true },
        }),
      ]);
      return {
        assetsPage: {
          assets: assets.map((asset) => ({
            ...asset,
            amount: legacyAmountToPlain(asset.amount),
          })),
          total,
          ledgerAdopted: false,
        },
        coinIds: coinRows.map(({ assetId }) => assetId),
        holdings: holdingRows.map((row) => ({
          assetId: row.assetId,
          amount: legacyAmountToPlain(row._sum.amount ?? 0),
        })),
        ledgerAdoptedAt: null,
      };
    }

    const quantities = await derivedPositions(transaction, userId);
    const latestActivity = await latestActivityByPosition(
      transaction,
      userId,
      quantities.map(({ position }) => position.id),
    );
    quantities.sort(
      (left, right) =>
        (
          latestActivity.get(right.position.id) ?? right.position.date
        ).getTime() -
        (latestActivity.get(left.position.id) ?? left.position.date).getTime(),
    );

    const filtered = quantities.filter(
      ({ position }) =>
        !options.assetId || position.assetId === options.assetId,
    );
    const offset = (options.page - 1) * options.pageSize;
    const holdings = new Map<string, string>();
    for (const { position, quantity } of quantities) {
      holdings.set(
        position.assetId,
        addDecimals(
          holdings.get(position.assetId) ?? "0",
          databaseDecimalToPlain(quantity),
        ),
      );
    }

    return {
      assetsPage: {
        assets: filtered
          .slice(offset, offset + options.pageSize)
          .map(({ position, quantity }) => ({
            id: position.id,
            assetId: position.assetId,
            assetName: position.assetName,
            amount: databaseDecimalToPlain(quantity),
            date: latestActivity.get(position.id) ?? position.date,
          })),
        total: filtered.length,
        ledgerAdopted: true,
      },
      coinIds: Array.from(
        new Set(quantities.map(({ position }) => position.assetId)),
      ),
      holdings: Array.from(holdings, ([assetId, amount]) => ({
        assetId,
        amount,
      })),
      ledgerAdoptedAt: adoptedAt,
    };
  });
}

export async function listOwnedAssetHistoryForRead(
  client: PrismaClient,
  userId: string,
  userAssetId: string,
  pageSize: number,
  page: number,
): Promise<AssetHistoryPoint[]> {
  return readConsistently(client, async (transaction) => {
    const [adoptedAt, position] = await Promise.all([
      ledgerAdoptedAt(transaction, userId),
      transaction.userAsset.findFirst({
        where: { id: userAssetId, userId },
        select: { id: true },
      }),
    ]);
    if (!position) return [];
    if (!adoptedAt) {
      const rows = await transaction.assetArchive.findMany({
        where: { userAssetId, userAsset: { userId } },
        orderBy: { date: "asc" },
        take: pageSize,
        skip: (page - 1) * pageSize,
      });
      return rows.map((row) => ({
        ...row,
        amount: legacyAmountToPlain(row.amount),
      }));
    }

    const events = await transaction.portfolioEvent.findMany({
      where: {
        userId,
        movements: { some: { userAssetId, userId } },
      },
      select: {
        id: true,
        occurredAt: true,
        movements: {
          where: { userAssetId, userId },
          select: { quantityDelta: true },
        },
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });

    let balance = "0";
    const points: AssetHistoryPoint[] = [];
    for (let index = 0; index < events.length; ) {
      const timestamp = events[index].occurredAt.getTime();
      let boundaryDelta = "0";
      let lastId = events[index].id;
      while (
        index < events.length &&
        events[index].occurredAt.getTime() === timestamp
      ) {
        lastId = events[index].id;
        for (const movement of events[index].movements) {
          boundaryDelta = addDecimals(
            boundaryDelta,
            databaseDecimalToPlain(movement.quantityDelta),
          );
        }
        index += 1;
      }
      balance = addDecimals(balance, boundaryDelta);
      points.push({
        id: `ledger:${lastId}`,
        userAssetId,
        amount: balance,
        date: new Date(timestamp),
      });
    }
    const offset = (page - 1) * pageSize;
    return points.slice(offset, offset + pageSize);
  });
}

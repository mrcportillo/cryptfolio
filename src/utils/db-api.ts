import prisma from "@/services/prisma/client";
import type { AssetArchive, UserAsset } from "@prisma/client";

export type UserAssetSummary = Pick<
  UserAsset,
  "id" | "assetId" | "assetName" | "amount" | "date"
>;

export type UserAssetsPage = {
  assets: UserAssetSummary[];
  total: number;
};

export async function getAssetById(
  id: string,
  userId: string,
): Promise<UserAsset | null> {
  return prisma.userAsset.findFirst({
    where: {
      id,
      userId,
    },
  });
}

export async function getUserAssetsByUserId(
  userId: string,
  options: { page: number; pageSize: number; assetId?: string } = {
    page: 1,
    pageSize: 50,
  },
): Promise<UserAssetsPage> {
  const where = {
    userId,
    ...(options.assetId ? { assetId: options.assetId } : {}),
  };

  return prisma.$transaction(async (transaction) => {
    const [assets, total] = await Promise.all([
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
    ]);

    return { assets, total };
  });
}

export async function getUserAssetCoinIds(userId: string): Promise<string[]> {
  const rows = await prisma.userAsset.findMany({
    where: { userId },
    distinct: ["assetId"],
    select: { assetId: true },
  });

  return rows.map(({ assetId }) => assetId);
}

export async function getUserAssetHoldingsByCoin(
  userId: string,
): Promise<Array<{ assetId: string; amount: number }>> {
  const rows = await prisma.userAsset.groupBy({
    by: ["assetId"],
    where: { userId },
    _sum: { amount: true },
  });

  return rows.map((row) => ({
    assetId: row.assetId,
    amount: row._sum.amount ?? 0,
  }));
}

export async function getAssetArchiveByUserAssetId(
  userId: string,
  userAssetId: string,
  pageSize: number,
  page: number,
): Promise<AssetArchive[]> {
  return prisma.assetArchive.findMany({
    where: {
      userAssetId: userAssetId,
      userAsset: { userId },
    },
    orderBy: {
      date: "asc",
    },
    take: pageSize,
    skip: (page - 1) * pageSize,
  });
}

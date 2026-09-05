import prisma from "@/services/prisma/client";
import {
  findOwnedAssetForRead,
  listOwnedAssetHistoryForRead,
  readPortfolioHome,
  type AssetHistoryPoint,
  type AssetReadModel,
  type AssetSummaryReadModel,
} from "@/services/asset/cutover-queries";

export type UserAssetSummary = AssetSummaryReadModel;

export async function getAssetById(
  id: string,
  userId: string,
): Promise<AssetReadModel | null> {
  return findOwnedAssetForRead(prisma, userId, id);
}

export async function getPortfolioHomeData(
  userId: string,
  options: { page: number; pageSize: number; assetId?: string },
) {
  return readPortfolioHome(prisma, userId, options);
}

export async function getAssetArchiveByUserAssetId(
  userId: string,
  userAssetId: string,
  pageSize: number,
  page: number,
): Promise<AssetHistoryPoint[]> {
  return listOwnedAssetHistoryForRead(
    prisma,
    userId,
    userAssetId,
    pageSize,
    page,
  );
}

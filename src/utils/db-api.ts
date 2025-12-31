import prisma from "@/services/prisma/client";
import type { AssetArchive, UserAsset } from "@prisma/client";

export async function getAssetById(id: string): Promise<UserAsset | null> {
  return prisma.userAsset.findUnique({
    where: {
      id: id,
    },
  });
}

export async function getUserAssetsByUserId(
  userId: string,
): Promise<UserAsset[]> {
  return prisma.userAsset.findMany({
    where: {
      userId: userId,
    },
    orderBy: {
      date: "desc",
    },
  });
}

export async function getAssetArchiveByUserAssetId(
  userAssetId: string,
  pageSize: number,
  page: number,
): Promise<AssetArchive[]> {
  return prisma.assetArchive.findMany({
    where: {
      userAssetId: userAssetId,
    },
    orderBy: {
      date: "asc",
    },
    take: pageSize,
    skip: (page - 1) * pageSize,
  });
}

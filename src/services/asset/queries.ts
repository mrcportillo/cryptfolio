import type { AssetArchive, UserAsset } from "@prisma/client";

type OwnedAssetWhere = {
  id: string;
  userId: string;
};

type OwnedAssetArchiveWhere = {
  userAssetId: string;
  userAsset: {
    userId: string;
  };
};

export type AssetQueryClient = {
  userAsset: {
    findFirst(args: { where: OwnedAssetWhere }): Promise<UserAsset | null>;
  };
  assetArchive: {
    findMany(args: {
      where: OwnedAssetArchiveWhere;
      orderBy: { date: "asc" };
      take: number;
      skip: number;
    }): Promise<AssetArchive[]>;
  };
};

export function findOwnedAssetById(
  client: AssetQueryClient,
  id: string,
  userId: string,
) {
  return client.userAsset.findFirst({
    where: {
      id,
      userId,
    },
  });
}

export function findOwnedAssetArchives(
  client: AssetQueryClient,
  userId: string,
  userAssetId: string,
  pageSize: number,
  page: number,
) {
  return client.assetArchive.findMany({
    where: {
      userAssetId,
      userAsset: { userId },
    },
    orderBy: {
      date: "asc",
    },
    take: pageSize,
    skip: (page - 1) * pageSize,
  });
}

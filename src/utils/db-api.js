import prisma from "@/services/prisma/client";

export async function getAssetById(id) {
  return await prisma.userAsset.findUnique({
    where: {
      id: id,
    },
  });
}

export async function getUserAssetsByUserId(userId) {
  return await prisma.userAsset.findMany({
    where: {
      userId: userId,
    },
    orderBy: {
      date: "desc",
    },
  });
}

export async function getAssetArchiveByUserAssetId(
  userAssetId,
  pageSize,
  page,
) {
  return await prisma.assetArchive.findMany({
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

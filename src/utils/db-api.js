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
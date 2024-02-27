import prisma from "@/services/prisma/client";

export async function getAssetById(id) {
    return await prisma.userAsset.findUnique({
      where: {
        id: id,
      },
    });
  }
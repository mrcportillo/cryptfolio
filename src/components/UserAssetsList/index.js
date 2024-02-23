import prisma from "@/services/prisma/client";
import { getSession } from "@auth0/nextjs-auth0";
import AssetPill from "../AssetPill";

async function getUserAssets() {
  const { user } = await getSession();
  return await prisma.UserAsset.findMany({
    where: {
      userId: user.sub,
    },
    orderBy: {
      date: "desc",
    },
  });
}

export default async function UserAssetsList() {
  const assets = await getUserAssets();
  return (
    <div className="flex flex-wrap gap-4">
      {assets.map((asset) => (
        <AssetPill key={asset.id} asset={asset} />
      ))}
    </div>
  );
}

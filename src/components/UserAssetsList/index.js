import prisma from "@/services/prisma/client";
import { getSession } from "@auth0/nextjs-auth0";
import AssetPill from "../AssetPill";
import get from "@/services/coin/get";

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

async function getAssetPrices(assets) {
  const coinPriceMap = new Map();
  assets.forEach((asset) => {
    coinPriceMap.set(asset.assetId, 0);
  });
  const coinIds = Array.from(coinPriceMap.keys());
  await Promise.all(
    coinIds.map(async (coinId) => {
      const coin = await get(coinId);
      coinPriceMap.set(coinId, coin?.market_data?.current_price?.usd);
    }),
  );
  return assets.map((asset) => {
    return {
      ...asset,
      price: coinPriceMap.get(asset.assetId),
    };
  });
}

export default async function UserAssetsList() {
  const assets = await getUserAssets();
  const assetsWithPrice = await getAssetPrices(assets);

  return (
    <div className="flex flex-wrap gap-4">
      {assetsWithPrice.map((asset) => (
        <AssetPill key={asset.id} asset={asset} />
      ))}
    </div>
  );
}

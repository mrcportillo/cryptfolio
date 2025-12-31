import prisma from "@/services/prisma/client";
import { getSession } from "@auth0/nextjs-auth0";
import AssetPill from "../AssetPill";
import get from "@/services/coin/get";
import { getUserAssetsByUserId } from "@/utils/db-api";
import type { AssetWithPrice } from "@/types/asset";
import type { UserAsset } from "@prisma/client";

async function getUserAssets(): Promise<UserAsset[]> {
  const session = await getSession();
  const user = session?.user;
  if (!user?.sub) {
    return [];
  }
  return getUserAssetsByUserId(user.sub);
}

async function getAssetPrices(
  assets: UserAsset[],
): Promise<AssetWithPrice[]> {
  const coinPriceMap = new Map<string, number>();
  assets.forEach((asset) => {
    coinPriceMap.set(asset.assetId, 0);
  });
  const coinIds = Array.from(coinPriceMap.keys());
  await Promise.all(
    coinIds.map(async (coinId) => {
      const coin = await get(coinId);
      coinPriceMap.set(coinId, coin?.market_data?.current_price?.usd ?? 0);
    }),
  );
  return assets.map((asset) => ({
    ...asset,
    price: coinPriceMap.get(asset.assetId) ?? 0,
  }));
}

export default async function UserAssetsList() {
  const assets = await getUserAssets();
  const assetsWithPrice = await getAssetPrices(assets);
  const sortedAssets = [...assetsWithPrice].sort(
    (first, second) =>
      second.price * second.amount - first.price * first.amount,
  );

  return (
    <div className="flex flex-wrap gap-6">
      {sortedAssets.map((asset) => (
        <AssetPill key={asset.id} asset={asset} />
      ))}
    </div>
  );
}

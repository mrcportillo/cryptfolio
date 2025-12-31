import get from "@/services/coin/get";
import { getUserAssetsByUserId } from "@/utils/db-api";
import { formatNumber } from "@/utils/numbers";
import { getSession } from "@auth0/nextjs-auth0";
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

export default async function UserPortfolioValue() {
  const assets = await getUserAssets();
  const assetsWithPrice = await getAssetPrices(assets);
  const portfolioTotalValue = assetsWithPrice.reduce((acc, asset) => {
    return acc + asset.price * asset.amount;
  }, 0);

  return (
    <div className="mt-8 w-full max-w-max rounded-md bg-gradient-to-br from-amber-300 to-amber-700 px-4 py-2 shadow md:px-8 md:py-6">
      <div className="mb-2 text-primary-900">Portfolio total worth</div>
      <div className="text-6xl text-primary-100">
        ${formatNumber(portfolioTotalValue)}
      </div>
    </div>
  );
}

import get from "@/services/coin/get";
import { getUserAssetsByUserId } from "@/utils/db-api";
import { formatNumber } from "@/utils/numbers";
import { getSession } from "@auth0/nextjs-auth0";
import type { AssetWithPrice } from "@/types/asset";
import type { UserAsset } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
    <Card className="w-full border-0 bg-gradient-to-br from-primary-200 via-primary-400 to-primary-700 shadow-lg">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-primary-50/90">
          Portfolio total worth
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-5xl font-semibold text-white sm:text-6xl md:text-7xl">
          ${formatNumber(portfolioTotalValue)}
        </div>
      </CardContent>
    </Card>
  );
}

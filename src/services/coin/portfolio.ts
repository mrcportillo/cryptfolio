import type { UserAssetSummary } from "@/utils/db-api";
import type { AssetWithPrice } from "@/types/asset";
import type { CoinMarketItem } from "./types";

export function createMarketMap(markets: CoinMarketItem[]) {
  return new Map(markets.map((market) => [market.id, market]));
}

export function addMarketDataToAssets(
  assets: UserAssetSummary[],
  markets: CoinMarketItem[],
): AssetWithPrice[] {
  const marketMap = createMarketMap(markets);

  return assets.map((asset) => {
    const market = marketMap.get(asset.assetId);

    return {
      id: asset.id,
      assetId: asset.assetId,
      assetName: asset.assetName,
      amount: asset.amount,
      date: asset.date,
      coinName: market?.name ?? asset.assetId,
      price: market?.current_price ?? null,
    };
  });
}

export function calculatePortfolioValue(
  holdings: Array<{ assetId: string; amount: number }>,
  markets: CoinMarketItem[],
) {
  const marketMap = createMarketMap(markets);

  return holdings.reduce((total, holding) => {
    const price = marketMap.get(holding.assetId)?.current_price;
    return price == null ? total : total + price * holding.amount;
  }, 0);
}

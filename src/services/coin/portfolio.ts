import type { UserAssetSummary } from "@/utils/db-api";
import type { AssetWithPrice } from "@/types/asset";
import type { CoinMarketItem } from "./types";

export function createMarketMap(markets: CoinMarketItem[]) {
  return new Map(markets.map((market) => [market.id, market]));
}

/**
 * This is the portfolio UI's intentional precision boundary. Quantities remain
 * exact decimal strings everywhere else; CoinGecko prices and chart values are
 * IEEE-754 numbers, so display-only market math must be approximate.
 */
export function approximateDecimalForMarketDisplay(
  exactAmount: string,
): number | null {
  const approximateAmount = Number(exactAmount);
  return Number.isFinite(approximateAmount) ? approximateAmount : null;
}

export function approximateMarketValue(
  exactAmount: string,
  price: number | null | undefined,
): number | null {
  if (price == null) return null;
  const approximateAmount = approximateDecimalForMarketDisplay(exactAmount);
  if (approximateAmount == null) return null;
  const approximateValue = approximateAmount * price;
  return Number.isFinite(approximateValue) ? approximateValue : null;
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
      approximateMarketValue: approximateMarketValue(
        asset.amount,
        market?.current_price,
      ),
    };
  });
}

export function calculatePortfolioValue(
  holdings: Array<{ assetId: string; amount: string }>,
  markets: CoinMarketItem[],
) {
  const marketMap = createMarketMap(markets);

  return holdings.reduce((total, holding) => {
    const value = approximateMarketValue(
      holding.amount,
      marketMap.get(holding.assetId)?.current_price,
    );
    return value == null ? total : total + value;
  }, 0);
}

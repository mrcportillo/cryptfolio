import { getSession } from "@auth0/nextjs-auth0";
import get from "@/services/coin/get";
import list from "@/services/coin/list";
import UserAssetsListClient from "@/components/UserAssetsList/UserAssetsListClient";
import { getUserAssetsByUserId } from "@/utils/db-api";
import { update } from "@/app/actions/asset";
import type { AssetWithPrice } from "@/types/asset";
import type { CoinOption } from "@/types/coin";
import type { CoinListItem } from "@/services/coin/types";
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

async function getCoinOptions(): Promise<CoinOption[]> {
  const coinList: CoinListItem[] = await list(50);
  return coinList.map((coin: CoinListItem) => ({
    value: coin.id,
    label: coin.name,
  }));
}

export default async function UserAssetsList() {
  const assets = await getUserAssets();
  const assetsWithPrice = await getAssetPrices(assets);
  const sortedAssets = [...assetsWithPrice].sort(
    (first, second) =>
      second.price * second.amount - first.price * first.amount,
  );
  const coinOptions = assetsWithPrice.length ? await getCoinOptions() : [];

  return (
    <UserAssetsListClient
      assets={sortedAssets}
      coinOptions={coinOptions}
      updateAction={update}
    />
  );
}

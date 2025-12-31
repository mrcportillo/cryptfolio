import { Suspense } from "react";
import { getSession } from "@auth0/nextjs-auth0";
import { Plus } from "lucide-react";
import UserAssetsList from "@/components/UserAssetsList";
import UserPortfolioValue from "@/components/UserPortfolioValue";
import AssetsHeader from "@/app/home/AssetsHeader";
import { Button } from "@/components/ui/button";
import { getUserAssetsByUserId } from "@/utils/db-api";
import get from "@/services/coin/get";
import type { CoinOption } from "@/types/coin";
import type { UserAsset } from "@prisma/client";

async function getUserAssets(): Promise<UserAsset[]> {
  const session = await getSession();
  const user = session?.user;
  if (!user?.sub) {
    return [];
  }
  return getUserAssetsByUserId(user.sub);
}

async function getUniqueCoinOptions(
  assets: UserAsset[],
): Promise<CoinOption[]> {
  // Extract unique coin IDs from assets
  const uniqueCoinIds = Array.from(new Set(assets.map((asset) => asset.assetId)));

  // Fetch coin details for unique coin IDs
  const coinOptions = await Promise.all(
    uniqueCoinIds.map(async (coinId) => {
      try {
        const coin = await get(coinId);
        return {
          value: coin.id,
          label: coin.name,
        };
      } catch (error) {
        // Fallback to coin ID if fetch fails
        return {
          value: coinId,
          label: coinId,
        };
      }
    }),
  );

  // Sort by label for better UX
  return coinOptions.sort((a, b) => a.label.localeCompare(b.label));
}

type HomeProps = {
  searchParams: Promise<{ coin?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const assets = await getUserAssets();
  const coinOptions = assets.length ? await getUniqueCoinOptions(assets) : [];
  const params = await searchParams;
  const selectedCoinFilter = params.coin || "all";

  return (
    <div className="mx-2 my-4 flex flex-col sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
      <div className="mb-6">
        <UserPortfolioValue />
      </div>
      <Suspense
        fallback={
          <div className="mb-2 flex items-center gap-4">
            <h1 className="text-3xl font-semibold text-primary-950">Assets</h1>
            <div className="flex-1" />
            <div>
              <Button disabled>
                <Plus className="mr-2 h-4 w-4" />
                New asset
              </Button>
            </div>
          </div>
        }
      >
        <AssetsHeader coinOptions={coinOptions} />
      </Suspense>
      <div className="my-4">
        <UserAssetsList selectedCoinFilter={selectedCoinFilter} />
      </div>
    </div>
  );
}

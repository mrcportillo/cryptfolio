import { Suspense } from "react";
import { NotebookPen } from "lucide-react";
import { requireCurrentUser } from "@/lib/auth";
import { parsePagination } from "@/lib/pagination";
import { addMarketDataToAssets } from "@/services/coin/portfolio";
import { listMarketByIds } from "@/services/coin/market";
import AssetsHeader from "@/app/home/AssetsHeader";
import AssetPagination from "@/app/home/AssetPagination";
import UserAssetsList from "@/components/UserAssetsList";
import UserPortfolioValue from "@/components/UserPortfolioValue";
import { Button } from "@/components/ui/button";
import { getPortfolioHomeData } from "@/utils/db-api";
import type { CoinOption } from "@/types/coin";
import { calculateLivePortfolioWorth } from "@/services/portfolio-valuation/live";
import { createValuationMarketLoader } from "@/services/portfolio-valuation/market-cache";
import DailyPulse from "@/components/portfolio/DailyPulse";

const ASSET_PAGE_SIZE = 50;
const loadMarkets = createValuationMarketLoader(listMarketByIds);

type HomeProps = {
  searchParams: Promise<{ coin?: string; page?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const searchParamsForPagination = new URLSearchParams({
    ...(params.page ? { page: params.page } : {}),
    pageSize: String(ASSET_PAGE_SIZE),
  });
  const pagination = parsePagination(searchParamsForPagination);
  const selectedCoinFilter = params.coin || "all";
  const assetIdFilter =
    selectedCoinFilter === "all" ? undefined : selectedCoinFilter;

  const { assetsPage, coinIds, holdings } = await getPortfolioHomeData(
    user.id,
    {
      page: pagination.page,
      pageSize: pagination.pageSize,
      assetId: assetIdFilter,
    },
  );

  const marketIds = Array.from(
    new Set([
      ...assetsPage.assets.map((asset) => asset.assetId),
      ...coinIds,
      ...holdings.map((holding) => holding.assetId),
    ]),
  );
  const { markets, providerFailed, usedFallback } =
    await loadMarkets(marketIds);
  const valuation = calculateLivePortfolioWorth(holdings, markets, {
    providerFailed,
  });
  if (usedFallback && valuation.valuationStatus === "COMPLETE")
    valuation.valuationStatus = "STALE";

  const assets = addMarketDataToAssets(assetsPage.assets, markets);
  const marketMap = new Map(markets.map((market) => [market.id, market]));
  const coinOptions: CoinOption[] = coinIds
    .map((coinId) => ({
      value: coinId,
      label: marketMap.get(coinId)?.name ?? coinId,
    }))
    .sort((first, second) => first.label.localeCompare(second.label));

  return (
    <div className="mx-2 my-4 flex flex-col sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
      <div className="mb-6">
        <UserPortfolioValue valuation={valuation} />
      </div>
      {assetsPage.ledgerAdopted && (
        <Suspense
          fallback={
            <p role="status" className="mb-6 p-5 text-sm text-slate-600">
              Calculating daily performance…
            </p>
          }
        >
          <DailyPulse userId={user.id} />
        </Suspense>
      )}
      <Suspense
        fallback={
          <div className="mb-2 flex flex-wrap items-center gap-4">
            <h1 className="text-3xl font-semibold text-primary-950">Assets</h1>
            <div className="flex-1" />
            <Button disabled>
              <NotebookPen className="mr-2 h-4 w-4" />
              Portfolio action
            </Button>
          </div>
        }
      >
        <AssetsHeader
          coinOptions={coinOptions}
          ledgerAdopted={assetsPage.ledgerAdopted}
        />
      </Suspense>
      <div className="my-4">
        <UserAssetsList
          assets={assets}
          ledgerAdopted={assetsPage.ledgerAdopted}
          selectedCoinFilter={selectedCoinFilter}
        />
      </div>
      <AssetPagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={assetsPage.total}
        coin={selectedCoinFilter}
      />
    </div>
  );
}

import { getAssetArchiveByUserAssetId } from "@/utils/db-api";
import LazyLineChart from "../charts/LineChart/LazyLineChart";
import { requireCurrentUser } from "@/lib/auth";
import { Suspense } from "react";
import type { AssetHistoryPoint } from "@/services/asset/cutover-queries";
import { approximateDecimalForMarketDisplay } from "@/services/coin/portfolio";

type AssetEvolutionProps = {
  assetId: string;
  assetName: string;
  currentAmount: string;
};

const AssetEvolution = async ({
  assetId,
  assetName,
  currentAmount,
}: AssetEvolutionProps) => {
  const user = await requireCurrentUser();
  const data = await getAssetArchiveByUserAssetId(user.id, assetId, 100, 1);
  if (data.length === 0)
    return (
      <div className="text-sm text-muted-foreground" role="status">
        There is no historical data to show an evolution graph.
      </div>
    );

  const dataKeys = [assetName];
  const formatedDataForChart = data.flatMap((item: AssetHistoryPoint) => {
    const amount = approximateDecimalForMarketDisplay(item.amount);
    return amount == null ? [] : [{ date: item.date, [assetName]: amount }];
  });
  const approximateCurrentAmount =
    approximateDecimalForMarketDisplay(currentAmount);
  if (approximateCurrentAmount != null) {
    formatedDataForChart.push({
      date: new Date(),
      [assetName]: approximateCurrentAmount,
    });
  }

  return (
    <LazyLineChart
      data={formatedDataForChart}
      xKey="date"
      dataKeys={dataKeys}
      ariaLabel={`Holding evolution for ${assetName}`}
    />
  );
};

export default function AssetEvolutionGraph({
  assetId,
  assetName,
  currentAmount,
}: AssetEvolutionProps) {
  return (
    <div>
      <h2 className="text-xl text-primary-950">Holding evolution</h2>
      <div className="mt-3 w-full sm:w-1/2">
        <Suspense fallback={<div>Loading...</div>}>
          <AssetEvolution
            assetId={assetId}
            currentAmount={currentAmount}
            assetName={assetName}
          />
        </Suspense>
      </div>
    </div>
  );
}

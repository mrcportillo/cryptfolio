import { getAssetArchiveByUserAssetId } from "@/utils/db-api";
import LineChart from "../charts/LineChart";
import { Suspense } from "react";
import type { AssetArchive } from "@prisma/client";

type AssetEvolutionProps = {
  assetId: string;
  assetName: string;
  currentAmount: number;
};

const AssetEvolution = async ({
  assetId,
  assetName,
  currentAmount,
}: AssetEvolutionProps) => {
  const data = await getAssetArchiveByUserAssetId(assetId, 100, 1);
  if (data.length === 0)
    return <div>There is no historical data to show an evolution graph</div>;

  const dataKeys = [assetName];
  const formatedDataForChart = data.map((item: AssetArchive) => ({
    date: item.date,
    [assetName]: item.amount,
  }));
  formatedDataForChart.push({
    date: new Date(),
    [assetName]: currentAmount,
  });

  return (
    <LineChart data={formatedDataForChart} xKey="date" dataKeys={dataKeys} />
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

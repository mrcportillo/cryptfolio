import { remove } from "@/app/actions/asset";
import { getAssetById } from "@/utils/db-api";
import { formatNumber } from "@/utils/numbers";
import RemoveButton from "@/components/RemoveButton";
import get from "@/services/coin/get";
import Image from "next/image";
import Link from "next/link";
import AssetEvolutionGraph from "@/components/AssetEvolutionGraph";
import type { CoinDetail } from "@/services/coin/types";
import type { UserAsset } from "@prisma/client";
import type { PropsWithChildren } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type EvolutionDotProps = {
  evolutionValue?: number;
};

const EvolutionDot = ({ evolutionValue = 0 }: EvolutionDotProps) => (
  <div
    className={`h-2 w-2 self-center rounded-full ${evolutionValue > 0 ? "bg-green-600" : "bg-red-600"}`}
  />
);

const EvolutionItem = ({ children }: PropsWithChildren) => (
  <div className="flex space-x-2 align-middle">{children}</div>
);

type AssetPageProps = {
  params: {
    id: string;
  };
};

export default async function Asset({ params: { id } }: AssetPageProps) {
  const asset = (await getAssetById(id)) as UserAsset | null;
  if (!asset) {
    throw new Error("Asset not found");
  }
  const assetStatus: CoinDetail = await get(asset.assetId);

  const removeAsset = async () => {
    "use server";
    await remove(id);
  };

  return (
    <div className="mx-2 my-4 flex flex-col sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
      <div className="mb-2 flex items-center">
        <h1 className="text-3xl font-semibold text-primary-950">
          {asset.assetName || "Asset detail"}
        </h1>
        <div className="ml-auto sm:ml-8">
          <Button asChild>
            <Link href={`/assets/${id}/edit`}>Edit</Link>
          </Button>
        </div>
        <div className="ml-4">
          <RemoveButton remove={removeAsset}>Remove</RemoveButton>
        </div>
      </div>
      <div className="my-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          <Card className="w-full md:w-1/2">
            <CardHeader className="pb-3">
              <CardTitle>Current</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex">
                <div className="mr-8">
                  <Image
                    src={assetStatus.image.large}
                    alt={assetStatus.id}
                    width={130}
                    height={130}
                  />
                </div>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <div>
                    <span>Coin: </span>
                    <span className="text-foreground">{assetStatus.name}</span>
                  </div>
                  <div>
                    <span>Holding: </span>
                    <span className="text-foreground">{asset.amount}</span>
                  </div>
                  <div>
                    <span>Coin value: </span>
                    <span className="text-foreground">
                      $
                      {formatNumber(
                        assetStatus?.market_data?.current_price?.usd,
                      )}
                    </span>
                  </div>
                  <div>
                    <span>Holding value: </span>
                    <span className="text-foreground">
                      $
                      {formatNumber(
                        asset.amount *
                          assetStatus?.market_data?.current_price?.usd,
                      )}
                    </span>
                  </div>
                  <div>
                    <span>Last updated: </span>
                    <span className="text-foreground">
                      {new Date(asset.date).toDateString()}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="w-full sm:w-1/4">
            <CardHeader className="pb-3">
              <CardTitle>Coin evolution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <EvolutionItem>
                <EvolutionDot
                  evolutionValue={
                    assetStatus?.market_data?.price_change_percentage_24h
                  }
                />
                <span>24 hs:</span>
                <span>
                  {formatNumber(
                    assetStatus?.market_data?.price_change_percentage_24h,
                  )}
                  %
                </span>
              </EvolutionItem>
              <EvolutionItem>
                <EvolutionDot
                  evolutionValue={
                    assetStatus?.market_data?.price_change_percentage_7d
                  }
                />
                <span>7 days:</span>
                <span>
                  {formatNumber(
                    assetStatus?.market_data?.price_change_percentage_7d,
                  )}
                  %
                </span>
              </EvolutionItem>
              <EvolutionItem>
                <EvolutionDot
                  evolutionValue={
                    assetStatus?.market_data?.price_change_percentage_30d
                  }
                />
                <span>30 days:</span>
                <span>
                  {formatNumber(
                    assetStatus?.market_data?.price_change_percentage_30d,
                  )}
                  %
                </span>
              </EvolutionItem>
            </CardContent>
          </Card>
        </div>
        <div className="mt-4">
          <AssetEvolutionGraph
            assetId={id}
            currentAmount={asset.amount}
            assetName={asset.assetName}
          />
        </div>
      </div>
    </div>
  );
}

import { remove } from "@/app/actions/asset";
import { requireCurrentUser } from "@/lib/auth";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
} from "@/utils/numbers";
import { getAssetById } from "@/utils/db-api";
import RemoveButton from "@/components/RemoveButton";
import get from "@/services/coin/get";
import Image from "next/image";
import { notFound } from "next/navigation";
import AssetEvolutionGraph from "@/components/AssetEvolutionGraph";
import type { CoinDetail } from "@/services/coin/types";
import type { PropsWithChildren } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NotebookPen } from "lucide-react";
import Link from "next/link";
import { listOwnedTransactionPositions } from "@/services/portfolio-transactions/queries";
import prisma from "@/services/prisma/client";
import { formatExactDecimal } from "@/lib/portfolio-transaction-ui";
import { approximateMarketValue } from "@/services/coin/portfolio";

type EvolutionDotProps = {
  evolutionValue?: number;
};

const EvolutionDot = ({ evolutionValue = 0 }: EvolutionDotProps) => (
  <span
    className={`h-2 w-2 self-center rounded-full ${
      evolutionValue > 0
        ? "bg-green-600"
        : evolutionValue < 0
          ? "bg-red-600"
          : "bg-muted-foreground"
    }`}
    aria-hidden="true"
  />
);

const EvolutionItem = ({ children }: PropsWithChildren) => (
  <div className="flex space-x-2 align-middle">{children}</div>
);

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(date);
}

type AssetPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function Asset({ params }: AssetPageProps) {
  const { id } = await params;
  const user = await requireCurrentUser();
  const [asset, catalog] = await Promise.all([
    getAssetById(id, user.id),
    listOwnedTransactionPositions(prisma, user.id),
  ]);

  if (!asset) {
    notFound();
  }

  let assetStatus: CoinDetail | null = null;
  try {
    assetStatus = await get(asset.assetId);
  } catch {
    assetStatus = null;
  }

  const currentPrice = assetStatus?.market_data?.current_price?.usd;
  const currentValue = approximateMarketValue(asset.amount, currentPrice);
  const removeAsset = async () => {
    "use server";
    await remove(id);
  };

  return (
    <div className="mx-2 my-4 flex flex-col sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold text-primary-950">
          {asset.assetName || "Asset detail"}
        </h1>
        <div className="ml-auto">
          {catalog.ledgerAdopted ? (
            <Button asChild>
              <Link
                href={`/transactions/new?positionId=${encodeURIComponent(id)}`}
              >
                <NotebookPen className="mr-2 h-4 w-4" aria-hidden="true" />
                Record activity
              </Link>
            </Button>
          ) : (
            <RemoveButton remove={removeAsset}>Remove</RemoveButton>
          )}
        </div>
      </div>
      <div className="my-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          <Card className="w-full md:w-1/2">
            <CardHeader className="pb-3">
              <CardTitle>Current</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-6">
                {assetStatus?.image.large ? (
                  <Image
                    src={assetStatus.image.large}
                    alt={`${assetStatus.name} logo`}
                    width={130}
                    height={130}
                  />
                ) : (
                  <div className="flex h-[130px] w-[130px] items-center justify-center rounded-full bg-muted text-center text-sm text-muted-foreground">
                    No image
                  </div>
                )}
                <div className="space-y-1 text-sm text-muted-foreground">
                  <div>
                    <span>Coin: </span>
                    <span className="text-foreground">
                      {assetStatus?.name ?? asset.assetId}
                    </span>
                  </div>
                  <div>
                    <span>Holding: </span>
                    <span className="text-foreground">
                      {formatExactDecimal(asset.amount)}
                    </span>
                  </div>
                  <div>
                    <span>Coin price: </span>
                    <span className="text-foreground">
                      {currentPrice == null
                        ? "Unavailable"
                        : formatCurrency(currentPrice)}
                    </span>
                  </div>
                  <div>
                    <span>Holding value: </span>
                    <span className="text-foreground">
                      {currentValue == null
                        ? "Unavailable"
                        : formatCurrency(currentValue)}
                    </span>
                  </div>
                  <div>
                    <span>Holding updated: </span>
                    <span className="text-foreground">
                      {formatDate(new Date(asset.date))}
                    </span>
                  </div>
                </div>
              </div>
              {!assetStatus ? (
                <p className="mt-4 text-sm text-muted-foreground" role="status">
                  Live market data is temporarily unavailable.
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card className="w-full sm:w-1/4">
            <CardHeader className="pb-3">
              <CardTitle>Coin evolution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                [
                  "24 hours",
                  assetStatus?.market_data?.price_change_percentage_24h,
                ],
                [
                  "7 days",
                  assetStatus?.market_data?.price_change_percentage_7d,
                ],
                [
                  "30 days",
                  assetStatus?.market_data?.price_change_percentage_30d,
                ],
              ].map(([label, value]) => (
                <EvolutionItem key={label as string}>
                  <EvolutionDot evolutionValue={value as number | undefined} />
                  <span>{label}:</span>
                  <span>{formatPercentage(value as number | undefined)}</span>
                </EvolutionItem>
              ))}
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

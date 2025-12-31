"use client";
import { formatNumber } from "@/utils/numbers";
import { useRouter } from "next/navigation";
import type { AssetWithPrice } from "@/types/asset";
import type { MouseEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pencil } from "lucide-react";

type AssetNameProps = {
  name: string;
};

const AssetName = ({ name }: AssetNameProps) => (
  <CardTitle className="text-2xl font-semibold text-primary-50 md:text-3xl">
    {name}
  </CardTitle>
);

type AssetAttributeProps = {
  label: string;
  value: ReactNode;
};

const AssetAttribute = ({ label, value }: AssetAttributeProps) => (
  <div className="flex items-center justify-between text-sm">
    <div className="text-primary-100/80">{label}</div>
    <div className="font-medium text-primary-50">{value}</div>
  </div>
);

type AssetPillProps = {
  asset: AssetWithPrice;
};

export default function AssetPill({ asset }: AssetPillProps) {
  const router = useRouter();
  const totalValue = formatNumber(asset.amount * asset.price);

  const onEditNavigate = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    router.push(`/assets/${asset.id}/edit`);
  };

  return (
    <Card
      className="w-full cursor-pointer border-0 bg-gradient-to-br from-primary-200 via-primary-400 to-primary-700 text-primary-50 shadow-lg sm:w-[320px] lg:w-[360px]"
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/assets/${asset.id}`)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          if (event.key === " ") {
            event.preventDefault();
          }
          router.push(`/assets/${asset.id}`);
        }
      }}
    >
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <AssetName name={asset.assetName} />
            <div>
              <div className="text-xs uppercase tracking-wide text-primary-100/80">
                Total value
              </div>
              <div className="text-3xl font-semibold text-white md:text-4xl">
                ${totalValue}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-primary-50 hover:bg-primary-900/20 hover:text-white"
            onClick={onEditNavigate}
            aria-label="Edit asset"
            title="Edit asset"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <AssetAttribute label="Coin" value={asset.assetId} />
        <AssetAttribute label="Amount" value={asset.amount} />
        <AssetAttribute
          label="Asset value"
          value={`$${formatNumber(asset.price)}`}
        />
        <AssetAttribute
          label="Last updated"
          value={new Date(asset.date).toDateString()}
        />
      </CardContent>
    </Card>
  );
}

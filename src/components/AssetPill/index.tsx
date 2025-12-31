"use client";
import { formatNumber } from "@/utils/numbers";
import { useRouter } from "next/navigation";
import type { AssetWithPrice } from "@/types/asset";
import type { MouseEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AssetNameProps = {
  name: string;
};

const AssetName = ({ name }: AssetNameProps) => (
  <CardTitle className="text-xl font-semibold text-primary-950">
    {name}
  </CardTitle>
);

type AssetAttributeProps = {
  label: string;
  value: ReactNode;
};

const AssetAttribute = ({ label, value }: AssetAttributeProps) => (
  <div className="flex text-sm">
    <div className="mr-2 text-primary-200">{label}</div>
    <div className="text-primary-50">{value}</div>
  </div>
);

type AssetPillProps = {
  asset: AssetWithPrice;
};

export default function AssetPill({ asset }: AssetPillProps) {
  const router = useRouter();

  const onEditNavigate = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    router.push(`/assets/${asset.id}/edit`);
  };

  return (
    <Card
      className="cursor-pointer border-0 bg-gradient-to-br from-primary-300 to-primary-700 text-primary-50 shadow"
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
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <AssetName name={asset.assetName} />
        <Button
          variant="secondary"
          size="sm"
          className="h-8"
          onClick={onEditNavigate}
        >
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        <AssetAttribute label="Coin" value={asset.assetId} />
        <AssetAttribute label="Amount" value={asset.amount} />
        <AssetAttribute label="Asset value" value={asset.price} />
        <AssetAttribute
          label="$"
          value={formatNumber(asset.amount * asset.price)}
        />
        <AssetAttribute
          label="Last updated"
          value={new Date(asset.date).toDateString()}
        />
      </CardContent>
    </Card>
  );
}

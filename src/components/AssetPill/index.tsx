"use client";
import { formatNumber } from "@/utils/numbers";
import Link from "next/link";
import type { AssetWithPrice } from "@/types/asset";
import type { ReactNode } from "react";
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
  onEdit?: () => void;
};

export default function AssetPill({ asset, onEdit }: AssetPillProps) {
  const totalValue =
    asset.price == null ? "—" : formatNumber(asset.amount * asset.price, 2);

  return (
    <Card className="relative w-full border-0 bg-gradient-to-br from-primary-200 via-primary-400 to-primary-700 text-primary-50 shadow-lg sm:w-[320px] lg:w-[360px]">
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-4 top-4 z-10 h-9 w-9 text-primary-50 hover:bg-primary-900/20 hover:text-white"
        onClick={onEdit}
        disabled={!onEdit}
        aria-label={`Edit asset ${asset.assetName}`}
        title="Edit asset"
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Link
        href={`/assets/${asset.id}`}
        className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`View asset ${asset.assetName}`}
      >
        <CardHeader className="pb-4 pr-16">
          <div className="space-y-2">
            <AssetName name={asset.assetName} />
            <div>
              <div className="text-xs uppercase tracking-wide text-primary-100/80">
                Total value
              </div>
              <div className="text-3xl font-semibold text-white md:text-4xl">
                {totalValue === "—" ? totalValue : `$${totalValue}`}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <AssetAttribute label="Coin" value={asset.coinName} />
          <AssetAttribute label="Amount" value={formatNumber(asset.amount)} />
          <AssetAttribute
            label="Price per coin"
            value={asset.price == null ? "—" : `$${formatNumber(asset.price)}`}
          />
          <AssetAttribute
            label="Last updated"
            value={new Date(asset.date).toLocaleDateString()}
          />
        </CardContent>
      </Link>
    </Card>
  );
}

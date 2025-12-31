"use client";

import { useState, useMemo } from "react";
import AssetPill from "@/components/AssetPill";
import AssetEditPanel from "@/components/AssetEditPanel";
import type { AssetWithPrice } from "@/types/asset";
import type { CoinOption } from "@/types/coin";

type UserAssetsListClientProps = {
  assets: AssetWithPrice[];
  coinOptions: CoinOption[];
  updateAction: (formData: FormData) => void | Promise<void>;
  selectedCoinFilter?: string;
};

export default function UserAssetsListClient({
  assets,
  coinOptions,
  updateAction,
  selectedCoinFilter = "all",
}: UserAssetsListClientProps) {
  const [selectedAsset, setSelectedAsset] = useState<AssetWithPrice | null>(
    null,
  );
  const [open, setOpen] = useState(false);

  const handleEdit = (asset: AssetWithPrice) => {
    setSelectedAsset(asset);
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSelectedAsset(null);
    }
  };

  const filteredAssets = useMemo(() => {
    if (selectedCoinFilter === "all") {
      return assets;
    }
    return assets.filter((asset) => asset.assetId === selectedCoinFilter);
  }, [assets, selectedCoinFilter]);

  return (
    <>
      <div className="flex flex-wrap gap-6">
        {filteredAssets.map((asset) => (
          <AssetPill
            key={asset.id}
            asset={asset}
            onEdit={() => handleEdit(asset)}
          />
        ))}
      </div>
      {selectedAsset ? (
        <AssetEditPanel
          open={open}
          onOpenChange={handleOpenChange}
          assetId={selectedAsset.id}
          assetName={selectedAsset.assetName}
          coinId={selectedAsset.assetId}
          amount={selectedAsset.amount}
          coinOptions={coinOptions}
          formAction={updateAction}
        />
      ) : null}
    </>
  );
}

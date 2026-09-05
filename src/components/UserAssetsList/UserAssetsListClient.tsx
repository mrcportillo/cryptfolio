"use client";

import { useState, useMemo } from "react";
import AssetPill from "@/components/AssetPill";
import AssetEditPanel from "@/components/AssetEditPanel";
import { sortAssetsByValue } from "@/lib/assets";
import type { AssetWithPrice } from "@/types/asset";
import type { AssetActionState } from "@/types/action";

type UserAssetsListClientProps = {
  assets: AssetWithPrice[];
  updateAction: (
    previousState: AssetActionState,
    formData: FormData,
  ) => Promise<AssetActionState>;
  quantityEditable: boolean;
  selectedCoinFilter?: string;
};

export default function UserAssetsListClient({
  assets,
  updateAction,
  quantityEditable,
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
    const visibleAssets =
      selectedCoinFilter === "all"
        ? assets
        : assets.filter((asset) => asset.assetId === selectedCoinFilter);

    return sortAssetsByValue(visibleAssets);
  }, [assets, selectedCoinFilter]);

  return (
    <>
      <div className="flex flex-wrap gap-6">
        {filteredAssets.length > 0 ? (
          filteredAssets.map((asset) => (
            <AssetPill
              key={asset.id}
              asset={asset}
              onEdit={() => handleEdit(asset)}
            />
          ))
        ) : (
          <div className="w-full rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {selectedCoinFilter === "all"
              ? "No assets yet. Add your first asset to start tracking your portfolio."
              : "No assets match this coin filter."}
          </div>
        )}
      </div>
      {selectedAsset ? (
        <AssetEditPanel
          open={open}
          onOpenChange={handleOpenChange}
          assetId={selectedAsset.id}
          assetName={selectedAsset.assetName}
          coinId={selectedAsset.assetId}
          coinName={selectedAsset.coinName}
          amount={selectedAsset.amount}
          version={new Date(selectedAsset.date)}
          quantityEditable={quantityEditable}
          formAction={updateAction}
        />
      ) : null}
    </>
  );
}

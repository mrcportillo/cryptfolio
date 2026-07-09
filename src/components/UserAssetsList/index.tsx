import UserAssetsListClient from "@/components/UserAssetsList/UserAssetsListClient";
import { update } from "@/app/actions/asset";
import type { AssetWithPrice } from "@/types/asset";

type UserAssetsListProps = {
  assets: AssetWithPrice[];
  selectedCoinFilter?: string;
};

export default function UserAssetsList({
  assets,
  selectedCoinFilter = "all",
}: UserAssetsListProps) {
  return (
    <UserAssetsListClient
      assets={assets}
      updateAction={update}
      selectedCoinFilter={selectedCoinFilter}
    />
  );
}

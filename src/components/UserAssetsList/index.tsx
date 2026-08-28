import UserAssetsListClient from "@/components/UserAssetsList/UserAssetsListClient";
import { rename, update } from "@/app/actions/asset";
import type { AssetWithPrice } from "@/types/asset";

type UserAssetsListProps = {
  assets: AssetWithPrice[];
  ledgerAdopted: boolean;
  selectedCoinFilter?: string;
};

export default function UserAssetsList({
  assets,
  ledgerAdopted,
  selectedCoinFilter = "all",
}: UserAssetsListProps) {
  return (
    <UserAssetsListClient
      assets={assets}
      updateAction={ledgerAdopted ? rename : update}
      quantityEditable={!ledgerAdopted}
      selectedCoinFilter={selectedCoinFilter}
    />
  );
}

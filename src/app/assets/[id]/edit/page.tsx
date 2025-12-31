import { update } from "@/app/actions/asset";
import PageContainer from "@/components/pages/PageContainer";
import Buttons from "@/components/forms/Buttons";
import Dropdown from "@/components/forms/Dropdown";
import Input from "@/components/forms/Input";
import PageHeaeder from "@/components/pages/PageHeader";
import PageContent from "@/components/pages/PageContent";
import list from "@/services/coin/list";
import PageTitle from "@/components/pages/PageTitle";
import { getAssetById } from "@/utils/db-api";
import type { CoinListItem } from "@/services/coin/types";
import type { UserAsset } from "@prisma/client";

type CoinOption = {
  value: string;
  label: string;
};

async function getCoinOptions(): Promise<CoinOption[]> {
  const coinList: CoinListItem[] = await list(50);
  return coinList.map((coin: CoinListItem) => ({
    value: coin.id,
    label: coin.name,
  }));
}

type AssetPageProps = {
  params: {
    id: string;
  };
};

export default async function Asset({ params: { id } }: AssetPageProps) {
  const [asset, coinOptions] = await Promise.all([
    getAssetById(id),
    getCoinOptions(),
  ]);
  const assetRecord = asset as UserAsset | null;

  if (!assetRecord) {
    throw new Error("Asset not found");
  }

  return (
    <PageContainer>
      <div className="sm:w-full md:w-1/2">
        <PageHeaeder>
          <PageTitle>Edit asset</PageTitle>
        </PageHeaeder>
        <PageContent>
          <form className="flex flex-col" action={update}>
            <input type="hidden" name="id" value={id} />
            <Input
              name="name"
              type="text"
              label="Alias"
              required
              value={assetRecord.assetName}
            />
            <Dropdown
              readOnly
              name="coin"
              label="Coin"
              defaultValue={assetRecord.assetId}
              options={coinOptions}
            />
            <Input
              name="amount"
              type="d"
              label="Amount"
              required
              value={assetRecord.amount}
            />
            <Buttons cancelLabel={"Cancel"} confirmLabel={"Save"} />
          </form>
        </PageContent>
      </div>
    </PageContainer>
  );
}

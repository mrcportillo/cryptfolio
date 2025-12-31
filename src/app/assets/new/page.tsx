import { create } from "@/app/actions/asset";
import PageContainer from "@/components/pages/PageContainer";
import Buttons from "@/components/forms/Buttons";
import Dropdown from "@/components/forms/Dropdown";
import Input from "@/components/forms/Input";
import list from "@/services/coin/list";
import PageHeaeder from "@/components/pages/PageHeader";
import PageContent from "@/components/pages/PageContent";
import PageTitle from "@/components/pages/PageTitle";
import type { CoinListItem } from "@/services/coin/types";

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

export default async function NewAsset() {
  const coinOptions = await getCoinOptions();

  return (
    <PageContainer>
      <div className="sm:w-full md:w-1/2">
        <PageHeaeder>
          <PageTitle>New Asset</PageTitle>
        </PageHeaeder>
        <PageContent>
          <form className="flex flex-col" action={create}>
            <Input name="name" type="text" label="Alias" required />
            <Dropdown name="coin" label="Coin" options={coinOptions} />
            <Input name="amount" type="d" label="Amount" required />
            <Buttons cancelLabel={"Cancel"} confirmLabel={"Save"} />
          </form>
        </PageContent>
      </div>
    </PageContainer>
  );
}

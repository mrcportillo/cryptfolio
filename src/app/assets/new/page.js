import { create } from "@/app/actions/asset";
import PageContainer from "@/app/components/PageContainer";
import Buttons from "@/app/components/forms/Buttons";
import Dropdown from "@/app/components/forms/Dropdown";
import Input from "@/app/components/forms/Input";
import list from "@/services/coin/list";

async function getCoinOptions() {
  const coinList = await list(50);
  return coinList.map((coin) => ({
    value: coin.id,
    label: coin.name,
  }));
}

export default async function NewAsset() {
  const coinOptions = await getCoinOptions();

  return (
    <PageContainer>
      <div className="sm:w-full md:w-1/2">
        <h1 className="text-3xl">New Asset</h1>
        <form className="my-4 flex flex-col" action={create}>
          <Input name="name" type="text" label="Alias" required/>
          <Dropdown name="coin" label="Coin" options={coinOptions} />
          <Input name="amount" type="d" label="Amount" required/>
          <Buttons cancelLabel={"Cancel"} confirmLabel={"Save"} />
        </form>
      </div>
    </PageContainer>
  );
}

import PageContainer from "@/app/components/PageContainer";
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
        <form className="my-4 flex flex-col">
          <Input id="name" type="text" label="Alias" />
          <Dropdown id="coin" label="Coin" options={coinOptions} />
          <Input id="amount" type="number" label="Amount" />
          <div className="ml-auto mt-3">
            <button className=" w-40 rounded-md bg-red-800 p-2 text-white">
              Cancel
            </button>
            <button className="ml-2 w-40 rounded-md bg-green-800 p-2 text-white">
              Save
            </button>
          </div>
        </form>
      </div>
    </PageContainer>
  );
}

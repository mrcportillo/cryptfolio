import { update } from "@/app/actions/asset";
import PageContainer from "@/components/pages/PageContainer";
import Buttons from "@/components/forms/Buttons";
import Dropdown from "@/components/forms/Dropdown";
import Input from "@/components/forms/Input";
import PageHeaeder from "@/components/pages/PageHeader";
import PageContent from "@/components/pages/PageContent";
import prisma from "@/services/prisma/client";
import list from "@/services/coin/list";
import PageTitle from "@/components/pages/PageTitle";

async function getAssetById(id) {
  return await prisma.userAsset.findUnique({
    where: {
      id: id,
    },
  });
}

async function getCoinOptions() {
  const coinList = await list(50);
  return coinList.map((coin) => ({
    value: coin.id,
    label: coin.name,
  }));
}

export default async function Asset({ params: { id } }) {
  const [asset, coinOptions] = await Promise.all([
    getAssetById(id),
    getCoinOptions(),
  ]);

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
              value={asset.assetName}
            />
            <Dropdown
              readOnly
              name="coin"
              label="Coin"
              defaultValue={asset.assetId}
              options={coinOptions}
            />
            <Input
              name="amount"
              type="d"
              label="Amount"
              required
              value={asset.amount}
            />
            <Buttons cancelLabel={"Cancel"} confirmLabel={"Save"} />
          </form>
        </PageContent>
      </div>
    </PageContainer>
  );
}

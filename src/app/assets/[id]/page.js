import { getAssetById } from "@/app/util/db-api";
import { formatNumber } from "@/app/util/numbers";
import Button from "@/components/Button";
import PageContainer from "@/components/pages/PageContainer";
import PageContent from "@/components/pages/PageContent";
import PageHeaeder from "@/components/pages/PageHeader";
import PageTitle from "@/components/pages/PageTitle";
import get from "@/services/coin/get";
import Image from "next/image";
import Link from "next/link";

const BoxTitle = ({ children }) => (
  <div className="mb-4">
    <span className="text-xl font-bold">{children}</span>
  </div>
);

export default async function Asset({ params: { id } }) {
  const asset = await getAssetById(id);
  const assetStatus = await get(asset.assetId);
  return (
    <PageContainer>
      <div className="w-full">
        <PageHeaeder>
          <PageTitle>{asset.assetName}</PageTitle>
          <div className="ml-auto sm:ml-8">
            <Link href={`/assets/${id}/edit`}>
              <Button>Edit</Button>
            </Link>
          </div>
          <div className="ml-4">
            <Button outline>Remove</Button>
          </div>
        </PageHeaeder>
        <PageContent>
          <div className="flex gap-4">
            <div className="sm:w-full md:w-1/2">
              <div className="flex rounded border p-4">
                <div className="mr-8 ">
                  <div>
                    <Image
                      src={assetStatus.image.large}
                      alt={assetStatus.id}
                      width={130}
                      height={130}
                    />
                  </div>
                </div>
                <div>
                  <BoxTitle>Current</BoxTitle>
                  <div>
                    <span>Coin: </span>
                    <span>{assetStatus.name}</span>
                  </div>
                  <div>
                    <span>Holding: </span>
                    <span>{asset.amount}</span>
                  </div>
                  <div>
                    <span>Coin value: </span>
                    <span>
                      $
                      {formatNumber(
                        assetStatus?.market_data?.current_price?.usd,
                      )}
                    </span>
                  </div>
                  <div>
                    <span>Holding value: </span>
                    <span>
                      $
                      {formatNumber(
                        asset.amount *
                          assetStatus?.market_data?.current_price?.usd,
                      )}
                    </span>
                  </div>
                  <div>
                    <span>Last updated: </span>
                    <span>{new Date(asset.date).toDateString()}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="sm:w-full md:w-1/4">
              <div className="rounded border p-4">
                <BoxTitle>Evolution</BoxTitle>
                <div>
                  <span>24 hs: </span>
                  <span>
                    {assetStatus?.market_data?.price_change_percentage_24h}
                  </span>
                </div>
                <div>
                  <span>7 days: </span>
                  <span>
                    {assetStatus?.market_data?.price_change_percentage_7d}
                  </span>
                </div>
                <div>
                  <span>30 days: </span>
                  <span>
                    {assetStatus?.market_data?.price_change_percentage_30d}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </PageContent>
      </div>
    </PageContainer>
  );
}

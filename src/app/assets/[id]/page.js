import { remove } from "@/app/actions/asset";
import { getAssetById } from "@/utils/db-api";
import { formatNumber } from "@/utils/numbers";
import Button from "@/components/Button";
import RemoveButton from "@/components/RemoveButton";
import PageContainer from "@/components/pages/PageContainer";
import PageContent from "@/components/pages/PageContent";
import PageHeaeder from "@/components/pages/PageHeader";
import PageTitle from "@/components/pages/PageTitle";
import get from "@/services/coin/get";
import Image from "next/image";
import Link from "next/link";
import AssetEvolutionGraph from "@/components/AssetEvolutionGraph";

const BoxTitle = ({ children }) => (
  <div className="mb-4">
    <span className="text-xl font-bold">{children}</span>
  </div>
);

const EvolutionDot = ({ evolutionValue }) => (
  <div
    className={`h-2 w-2 self-center rounded-full ${evolutionValue > 0 ? "bg-green-600" : "bg-red-600"}`}
  />
);

const EvolutionItem = ({ children }) => (
  <div className="flex space-x-2 align-middle">{children}</div>
);

export default async function Asset({ params: { id } }) {
  const asset = await getAssetById(id);
  const assetStatus = await get(asset.assetId);

  const removeAsset = async () => {
    "use server";
    await remove(id);
  };

  return (
    <PageContainer>
      <div className="w-full">
        <PageHeaeder>
          <PageTitle>{asset.assetName || "Asset detail"}</PageTitle>
          <div className="ml-auto sm:ml-8">
            <Link href={`/assets/${id}/edit`}>
              <Button>Edit</Button>
            </Link>
          </div>
          <div className="ml-4">
            <RemoveButton remove={removeAsset}>Remove</RemoveButton>
          </div>
        </PageHeaeder>
        <PageContent>
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="w-full md:w-1/2">
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
            <div className="w-full sm:w-1/4">
              <div className="rounded border p-4">
                <BoxTitle>Coin evolution</BoxTitle>
                <EvolutionItem>
                  <EvolutionDot
                    evolutionValue={
                      assetStatus?.market_data?.price_change_percentage_24h
                    }
                  />
                  <span>24 hs:</span>
                  <span>
                    {formatNumber(
                      assetStatus?.market_data?.price_change_percentage_24h,
                    )}
                    %
                  </span>
                </EvolutionItem>
                <EvolutionItem>
                  <EvolutionDot
                    evolutionValue={
                      assetStatus?.market_data?.price_change_percentage_7d
                    }
                  />
                  <span>7 days:</span>
                  <span>
                    {formatNumber(
                      assetStatus?.market_data?.price_change_percentage_7d,
                    )}
                    %
                  </span>
                </EvolutionItem>
                <EvolutionItem>
                  <EvolutionDot
                    evolutionValue={
                      assetStatus?.market_data?.price_change_percentage_30d
                    }
                  />
                  <span>30 days:</span>
                  <span>
                    {formatNumber(
                      assetStatus?.market_data?.price_change_percentage_30d,
                    )}
                    %
                  </span>
                </EvolutionItem>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <AssetEvolutionGraph
              assetId={id}
              currentAmount={asset.amount}
              assetName={asset.assetName}
            />
          </div>
        </PageContent>
      </div>
    </PageContainer>
  );
}

"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";

const AssetName = ({ name }) => (
  <h1 className="mb-4 text-xl font-semibold text-primary-900">{name}</h1>
);

const AssetAttribute = ({ label, value }) => (
  <div className="flex">
    <div className="mr-2 text-primary-800">{label}</div>
    <div className="text-primary-50">{value}</div>
  </div>
);

export default function AssetPill({ asset }) {
  const router = useRouter();

  const onEditNavigate = (event) => {
    event.preventDefault();
    router.push(`/assets/${asset.id}/edit`);
  };

  return (
    <div className="cursor-pointer  rounded-md bg-gradient-to-br from-primary-300 to-primary-700 p-4 shadow">
      <Link href={`/assets/${asset.id}`}>
        <div className="flex justify-between">
          <AssetName name={asset.assetName} />
          <div className="text-primary-200" onClick={onEditNavigate}>
            Edit
          </div>
        </div>
        <AssetAttribute label="Coin" value={asset.assetId} />
        <AssetAttribute label="Amount" value={asset.amount} />
        <AssetAttribute label="Asset value" value={asset.price} />
        <AssetAttribute label="$" value={asset.amount * asset.price} />
        <AssetAttribute
          label="Last updated"
          value={new Date(asset.date).toDateString()}
        />
      </Link>
    </div>
  );
}

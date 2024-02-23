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
  return (
    <div className="rounded-md  bg-gradient-to-br from-primary-300 to-primary-700 p-4 shadow">
      <div className="flex justify-between">
        <AssetName name={asset.assetName} />
        <a href={`/assets/${asset.id}`} className="text-primary-200">Edit</a>
      </div>
      <AssetAttribute label="Coin" value={asset.assetId} />
      <AssetAttribute label="Amount" value={asset.amount} />
      <AssetAttribute
        label="Last updated"
        value={new Date(asset.date).toDateString()}
      />
    </div>
  );
}

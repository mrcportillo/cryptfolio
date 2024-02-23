const AssetName = ({ name }) => (
  <h1 className="text-primary-900 mb-4 text-xl font-semibold">{name}</h1>
);

const AssetAttribute = ({ label, value }) => (
  <div className="flex">
    <div className="text-primary-800 mr-2">{label}</div>
    <div className="text-primary-50">{value}</div>
  </div>
);

export default function AssetPill({ asset }) {
  return (
    <div className="from-primary-300  to-primary-700 rounded-md bg-gradient-to-br p-4 shadow">
      <div className="flex justify-between">
        <AssetName name={asset.assetName} />
        <a href={`/assets/${asset.id}`} className="text-primary-200">
          Edit
        </a>
      </div>
      <AssetAttribute label="Coin" value={asset.assetId} />
      <AssetAttribute label="Amount" value={asset.amount} />
      <AssetAttribute label="Asset value" value={asset.price} />
      <AssetAttribute label="$" value={asset.amount * asset.price} />
      <AssetAttribute
        label="Last updated"
        value={new Date(asset.date).toDateString()}
      />
    </div>
  );
}

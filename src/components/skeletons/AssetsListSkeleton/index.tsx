import AssetPillSkeleton from "../AssetPillSkeleton";

export default async function AssetsListSkeleton() {
  return (
    <div className="flex flex-wrap gap-4">
      {[...Array(4).keys()].map((value) => (
        <AssetPillSkeleton key={value} />
      ))}
    </div>
  );
}

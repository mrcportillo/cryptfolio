
export default function AssetPillSkeleton() {
  return (
    <div className="flex h-50 w-70 animate-pulse cursor-pointer  rounded-md bg-primary-400 bg-gradient-to-br p-4 shadow">
      <div className="flex justify-between">
        <div className="t mb-4 h-6 w-28 rounded bg-primary-500" />
      </div>
      <div className="ml-auto mt-10 ">
        <div className="t mb-2 h-4 w-28 rounded bg-primary-500" />
        <div className="t mb-2 h-4 w-16 rounded bg-primary-500" />
        <div className="t mb-2 h-4 w-20 rounded bg-primary-500" />
        <div className="t mb-2 h-4 w-10 rounded bg-primary-500" />
        <div className="t mb-2 h-4 w-24 rounded bg-primary-500" />
      </div>
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingTransactions() {
  return (
    <div
      className="mx-2 my-6 space-y-6 sm:mx-4 md:mx-8 md:my-10 lg:mx-20"
      role="status"
      aria-label="Loading transactions"
    >
      <div className="space-y-3 border-b pb-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      {[0, 1, 2].map((item) => (
        <Skeleton key={item} className="h-28 w-full rounded-lg" />
      ))}
      <span className="sr-only">Loading transaction journal…</span>
    </div>
  );
}

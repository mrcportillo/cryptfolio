import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingTransaction() {
  return (
    <div
      className="mx-2 my-6 grid gap-7 sm:mx-4 md:mx-8 md:my-10 lg:mx-20 xl:grid-cols-[minmax(0,1fr)_22rem]"
      role="status"
      aria-label="Loading transaction"
    >
      <Skeleton className="h-[36rem] w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <span className="sr-only">Loading transaction…</span>
    </div>
  );
}
